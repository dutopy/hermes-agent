"""Kanban ``kanban.*`` JSON-RPC handlers for the TUI gateway.

Phase 2 of the kanban RPC surface build. Phase 1 extracted shared
presentation/estimate helpers out of the dashboard's HTTP plugin
(``plugins/kanban/dashboard/plugin_api.py``) into ``hermes_cli.kanban_present``
and ``hermes_cli.kanban_estimate``. This module gives the gateway (and any
other JSON-RPC client, e.g. the Desktop app) a way to drive the exact same
Kanban board over the SAME connection used for ``session.*``/``projects.*``,
without needing HTTP access to the dashboard's FastAPI plugin.

Every handler here re-implements the business logic plugin_api.py's route
functions perform, calling the same canonical layer
(``hermes_cli.kanban_db``, ``hermes_cli.kanban_present``,
``hermes_cli.kanban_estimate``, ``hermes_cli.kanban_specify``,
``hermes_cli.kanban_decompose``, ``hermes_cli.profiles``,
``hermes_cli.profile_describer``, ``hermes_cli.config``) that plugin_api.py
itself wraps — plugin_api.py is read here purely as a *spec*, never
imported (it's loaded dynamically by the dashboard's plugin system, not a
normal importable package; importing it from core gateway code would be an
architectural layering violation).

Kanban boards are a first-class, explicitly cross-profile primitive (see
``hermes_cli/kanban_db.py``'s module docstring) — every handler below scopes
by ``board``, not by ``profile`` the way ``session.*``/``projects.*`` do.

Scope gap (documented, not an oversight): the dashboard's ``/events``
WebSocket (a server-push tail of ``task_events``) has no JSON-RPC method
here. Request/response RPC is a fundamentally different transport than a
server-push tail; a client that wants live updates should poll
``kanban.board.get``/``kanban.task.get`` or (if it also has HTTP access)
use the dashboard's WebSocket directly.

Error code convention
----------------------
RPC error codes for this module live in the 5200-5299 range (5063 was the
highest previously used elsewhere in the codebase at the time this was
written). Codes are assigned per handler, grouped by failure category:

  * 5200-5209: board resolution (malformed slug / unknown board)
  * 5210-5219: task not found / bad task input
  * 5220-5229: status-transition conflicts (409-equivalent)
  * 5230-5239: attachment errors (not found / bad payload / oversize)
  * 5240-5249: run / worker errors
  * 5250-5259: board CRUD errors
  * 5260-5269: link errors
  * 5290-5299: catch-all unexpected errors (mirrors methods_config.py's
    ``_err(rid, 5061, str(e))`` style local catch-all, scoped per handler)

This is intentionally a per-handler local convention, not a global
registry — see methods_config.py for the precedent (5001/5013/5016/5031/
5061/5063 are similarly locally-assigned, not centrally allocated).
"""

from __future__ import annotations

import base64
import binascii
import contextlib
import logging
from typing import Any, Optional

from .method_ctx import HandlerRegistry

from hermes_cli import kanban_db
from hermes_cli import kanban_present
from hermes_cli.kanban_estimate import estimate_text as _run_estimate

log = logging.getLogger(__name__)

_registry = HandlerRegistry()
method = _registry.method


# ---------------------------------------------------------------------------
# Shared helpers — mirrors plugin_api.py's ``_resolve_board`` / ``_conn``.
# ---------------------------------------------------------------------------

class _KanbanRpcError(Exception):
    """Internal control-flow exception carrying an RPC error code+message."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _resolve_kanban_board(board: Optional[str]) -> Optional[str]:
    """Validate and normalise a board slug.

    Raises :class:`_KanbanRpcError` (5200 malformed slug, 5201 unknown
    board) so callers can turn it into an ``_err`` response. Returns the
    normalised slug, or ``None`` when the caller omitted it (falls through
    to the active board inside ``kanban_db.connect()``).
    """
    if board is None or board == "":
        return None
    try:
        normed = kanban_db._normalize_board_slug(board)
    except ValueError as exc:
        raise _KanbanRpcError(5200, str(exc))
    if normed and normed != kanban_db.DEFAULT_BOARD and not kanban_db.board_exists(normed):
        raise _KanbanRpcError(5201, f"board {normed!r} does not exist")
    return normed


@contextlib.contextmanager
def _kanban_conn(board: Optional[str] = None):
    """Open a kanban_db connection, creating the schema on first use.

    Mirrors plugin_api.py's ``_conn()`` but as a context manager so
    handlers can ``with _kanban_conn(board) as conn:`` and always close.
    ``init_db`` failures are logged and swallowed (best-effort self-heal,
    matching plugin_api.py) rather than surfaced as an RPC error.
    """
    try:
        kanban_db.init_db(board=board)
    except Exception as exc:
        log.warning("kanban init_db failed: %s", exc)
    conn = kanban_db.connect(board=board)
    try:
        yield conn
    finally:
        conn.close()


def _board_param(params: dict) -> Optional[str]:
    raw = params.get("board")
    return (raw or "").strip() or None


def _configured_home_channels() -> list[dict]:
    """Return every platform that has a home_channel set, fully hydrated."""
    try:
        from gateway.config import load_gateway_config
    except Exception:
        return []
    try:
        gw_cfg = load_gateway_config()
    except Exception:
        return []
    result: list[dict] = []
    for platform, pcfg in gw_cfg.platforms.items():
        if not pcfg or not pcfg.home_channel:
            continue
        hc = pcfg.home_channel
        result.append({
            "platform": platform.value,
            "chat_id": hc.chat_id,
            "thread_id": hc.thread_id or "",
            "name": hc.name or "Home",
        })
    result.sort(key=lambda r: r["platform"])
    return result


def _active_profile_name() -> str:
    try:
        from hermes_cli.profiles import get_active_profile_name
        return get_active_profile_name() or "default"
    except Exception:
        return "default"


def _get_orchestration_settings() -> dict:
    try:
        from hermes_cli.config import load_config
        cfg = load_config() or {}
    except Exception:
        cfg = {}
    kanban_cfg = (cfg.get("kanban") or {}) if isinstance(cfg, dict) else {}
    explicit_orch = (kanban_cfg.get("orchestrator_profile") or "").strip()
    explicit_default = (kanban_cfg.get("default_assignee") or "").strip()
    auto_decompose = bool(kanban_cfg.get("auto_decompose", True))
    auto_promote_children = bool(kanban_cfg.get("auto_promote_children", True))

    resolved_orch = explicit_orch
    resolved_default = explicit_default
    try:
        from hermes_cli import profiles as profiles_mod
        active_default = profiles_mod.get_active_profile_name() or "default"
        if not resolved_orch or not profiles_mod.profile_exists(resolved_orch):
            resolved_orch = active_default
        if not resolved_default or not profiles_mod.profile_exists(resolved_default):
            resolved_default = active_default
    except Exception:
        active_default = "default"
        if not resolved_orch:
            resolved_orch = active_default
        if not resolved_default:
            resolved_default = active_default

    return {
        "orchestrator_profile": explicit_orch,
        "default_assignee": explicit_default,
        "auto_decompose": auto_decompose,
        "auto_promote_children": auto_promote_children,
        "resolved_orchestrator_profile": resolved_orch,
        "resolved_default_assignee": resolved_default,
        "active_profile": active_default,
    }


# ---------------------------------------------------------------------------
# Handler-local default-argument bridge
# ---------------------------------------------------------------------------
#
# ``HandlerRegistry.install()`` (see method_ctx.py) rebinds each
# ``@method``-decorated function's ``__globals__`` to server.py's own module
# namespace before installing it into ``server._methods`` — a trick built for
# *verbatim-moved* handler bodies (methods_config.py/methods_session.py/etc.)
# whose free names already live in server.py. This module's handler bodies
# are NEW code that references names defined HERE (kanban_db, kanban_present,
# the helpers above), which do NOT exist in server.py's namespace. Rebinding
# would turn every such reference into a ``NameError`` at call time.
#
# ``types.FunctionType`` preserves ``__defaults__``/``__kwdefaults__`` across
# the rebind, so every handler below re-declares the module-level names its
# body already uses as keyword-only parameters defaulting to themselves —
# e.g. ``kanban_db=kanban_db``. Each default is evaluated once, at module
# import time, against THIS module's own globals (which are correct then —
# rebinding happens later, at ``register()`` time). The handler bodies are
# unchanged text; the extra keyword-only parameters just shadow what would
# otherwise be a missing global lookup after rebind. Unused defaults on a
# given handler are harmless — they're just extra keyword slots nobody
# passes a value for.


# ---------------------------------------------------------------------------
# 1. kanban.board.get
# ---------------------------------------------------------------------------

@method("kanban.board.get")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    tenant = params.get("tenant")
    include_archived = bool(params.get("include_archived", False))
    workflow_template_id = params.get("workflow_template_id")
    current_step_key = params.get("current_step_key")
    try:
        with _kanban_conn(board) as conn:
            tasks = kanban_db.list_tasks(
                conn,
                tenant=tenant,
                include_archived=include_archived,
                workflow_template_id=workflow_template_id,
                current_step_key=current_step_key,
            )
            link_counts: dict[str, dict[str, int]] = {}
            for row in conn.execute(
                "SELECT parent_id, child_id FROM task_links"
            ).fetchall():
                link_counts.setdefault(row["parent_id"], {"parents": 0, "children": 0})[
                    "children"
                ] += 1
                link_counts.setdefault(row["child_id"], {"parents": 0, "children": 0})[
                    "parents"
                ] += 1

            comment_counts: dict[str, int] = {
                r["task_id"]: r["n"]
                for r in conn.execute(
                    "SELECT task_id, COUNT(*) AS n FROM task_comments GROUP BY task_id"
                )
            }

            progress: dict[str, dict[str, int]] = {}
            for row in conn.execute(
                "SELECT l.parent_id AS pid, t.status AS cstatus "
                "FROM task_links l JOIN tasks t ON t.id = l.child_id"
            ).fetchall():
                p = progress.setdefault(row["pid"], {"done": 0, "total": 0})
                p["total"] += 1
                if row["cstatus"] == "done":
                    p["done"] += 1

            diagnostics_per_task = kanban_present.compute_task_diagnostics(conn, task_ids=None)

            latest_event_id = conn.execute(
                "SELECT COALESCE(MAX(id), 0) AS m FROM task_events"
            ).fetchone()["m"]

            columns: dict[str, list[dict]] = {c: [] for c in kanban_present.BOARD_COLUMNS}
            if include_archived:
                columns["archived"] = []

            summary_map = kanban_db.latest_summaries(conn, [t.id for t in tasks])

            for t in tasks:
                full = summary_map.get(t.id)
                preview = full[: kanban_present.CARD_SUMMARY_PREVIEW_CHARS] if full else None
                d = kanban_present.task_dict(t, latest_summary=preview)
                d["link_counts"] = link_counts.get(t.id, {"parents": 0, "children": 0})
                d["comment_count"] = comment_counts.get(t.id, 0)
                d["progress"] = progress.get(t.id)
                diags = diagnostics_per_task.get(t.id)
                if diags:
                    d["diagnostics"] = diags
                    d["warnings"] = kanban_present.warnings_summary_from_diagnostics(diags)
                col = t.status if t.status in columns else "todo"
                columns[col].append(d)

            tenants = [
                r["tenant"]
                for r in conn.execute(
                    "SELECT DISTINCT tenant FROM tasks WHERE tenant IS NOT NULL ORDER BY tenant"
                )
            ]
            assignees = [
                r["assignee"]
                for r in conn.execute(
                    "SELECT DISTINCT assignee FROM tasks WHERE assignee IS NOT NULL "
                    "AND status != 'archived' ORDER BY assignee"
                )
            ]

            import time as _time

            return _ok(
                rid,
                {
                    "columns": [
                        {"name": name, "tasks": columns[name]} for name in columns.keys()
                    ],
                    "tenants": tenants,
                    "assignees": assignees,
                    "latest_event_id": int(latest_event_id),
                    "now": int(_time.time()),
                },
            )
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 2. kanban.task.get
# ---------------------------------------------------------------------------

@method("kanban.task.get")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    if not task_id:
        return _err(rid, 5210, "task_id is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)

    run_state_type = params.get("run_state_type")
    run_state_name = params.get("run_state_name")
    if (run_state_type is None) ^ (run_state_name is None):
        return _err(
            rid, 5211,
            "run_state_type and run_state_name must be passed together or omitted",
        )
    if run_state_type is not None and run_state_type not in ("status", "outcome"):
        return _err(rid, 5211, "run_state_type must be 'status' or 'outcome'")

    try:
        with _kanban_conn(board) as conn:
            task = kanban_db.get_task(conn, task_id)
            if task is None:
                return _err(rid, 5212, f"task {task_id} not found")
            full_summary = kanban_db.latest_summary(conn, task_id)
            task_d = kanban_present.task_dict(task, latest_summary=full_summary)
            links = kanban_present.links_for(conn, task_id)
            child_ids = links["children"]
            child_summaries = kanban_db.latest_summaries(conn, child_ids)
            child_results = []
            for child_id in child_ids:
                child = kanban_db.get_task(conn, child_id)
                if child is None:
                    continue
                child_results.append({
                    "id": child.id,
                    "title": child.title,
                    "status": child.status,
                    "latest_summary": child_summaries.get(child.id),
                    "result": child.result,
                })
            diags = kanban_present.compute_task_diagnostics(conn, task_ids=[task_id])
            diag_list = diags.get(task_id) or []
            if diag_list:
                task_d["diagnostics"] = diag_list
                task_d["warnings"] = kanban_present.warnings_summary_from_diagnostics(diag_list)
            return _ok(
                rid,
                {
                    "task": task_d,
                    "comments": [
                        kanban_present.comment_dict(c)
                        for c in kanban_db.list_comments(conn, task_id)
                    ],
                    "events": [
                        kanban_present.event_dict(e)
                        for e in kanban_db.list_events(conn, task_id)
                    ],
                    "attachments": [
                        kanban_present.attachment_dict(a)
                        for a in kanban_db.list_attachments(conn, task_id)
                    ],
                    "links": links,
                    "child_results": child_results,
                    "runs": [
                        kanban_present.run_dict(r)
                        for r in kanban_db.list_runs(
                            conn, task_id,
                            state_type=run_state_type, state_name=run_state_name,
                        )
                    ],
                },
            )
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 3. kanban.task.create
# ---------------------------------------------------------------------------

@method("kanban.task.create")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    title = str(params.get("title") or "")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            task_id = kanban_db.create_task(
                conn,
                title=title,
                body=params.get("body"),
                assignee=params.get("assignee"),
                created_by="rpc",
                workspace_kind=params.get("workspace_kind") or "scratch",
                workspace_path=params.get("workspace_path"),
                tenant=params.get("tenant"),
                priority=int(params.get("priority") or 0),
                parents=params.get("parents") or [],
                triage=bool(params.get("triage", False)),
                idempotency_key=params.get("idempotency_key"),
                max_runtime_seconds=params.get("max_runtime_seconds"),
                skills=params.get("skills"),
                goal_mode=bool(params.get("goal_mode", False)),
                goal_max_turns=params.get("goal_max_turns"),
                model_override=params.get("model_override"),
                provider_override=params.get("provider_override"),
                reasoning_effort=params.get("reasoning_effort"),
                project_id=params.get("project_id"),
                board=board,
            )
            task = kanban_db.get_task(conn, task_id)
            result: dict[str, Any] = {
                "task": kanban_present.task_dict(task) if task else None,
            }
            if task and task.status == "ready" and task.assignee:
                try:
                    from hermes_cli.kanban import _check_dispatcher_presence
                    from hermes_constants import get_hermes_home

                    running, message = _check_dispatcher_presence(
                        hermes_home=get_hermes_home()
                    )
                    if not running and message:
                        result["warning"] = message
                except Exception:
                    pass
            return _ok(rid, result)
    except ValueError as e:
        return _err(rid, 5213, str(e))
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 4. kanban.task.update
# ---------------------------------------------------------------------------

_UPDATE_TASK_FIELDS = (
    "status", "assignee", "priority", "title", "body", "result", "block_reason",
    "summary", "metadata", "model_override", "provider_override",
    "clear_model_override", "reasoning_effort", "clear_reasoning_effort",
)


@method("kanban.task.update")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    if not task_id:
        return _err(rid, 5210, "task_id is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)

    import json as _json
    import time as _time

    try:
        with _kanban_conn(board) as conn:
            task = kanban_db.get_task(conn, task_id)
            if task is None:
                return _err(rid, 5212, f"task {task_id} not found")

            assignee = params.get("assignee")
            status = params.get("status")
            priority = params.get("priority")
            title = params.get("title")
            body = params.get("body")
            result = params.get("result")
            block_reason = params.get("block_reason")
            summary = params.get("summary")
            metadata = params.get("metadata")
            model_override = params.get("model_override")
            provider_override = params.get("provider_override")
            clear_model_override = bool(params.get("clear_model_override", False))
            reasoning_effort = params.get("reasoning_effort")
            clear_reasoning_effort = bool(params.get("clear_reasoning_effort", False))

            # --- assignee ----------------------------------------------------
            if assignee is not None:
                try:
                    ok = kanban_db.assign_task(conn, task_id, assignee or None)
                except RuntimeError as e:
                    return _err(rid, 5220, str(e))
                if not ok:
                    return _err(rid, 5212, "task not found")

            # --- status -------------------------------------------------------
            if status is not None:
                s = status
                ok = True
                if s == "done":
                    ok = kanban_db.complete_task(
                        conn, task_id, result=result, summary=summary, metadata=metadata,
                    )
                elif s == "blocked":
                    ok = kanban_db.block_task(conn, task_id, reason=block_reason)
                elif s == "scheduled":
                    ok = kanban_db.schedule_task(conn, task_id, reason=block_reason)
                elif s == "ready":
                    current = kanban_db.get_task(conn, task_id)
                    if current and current.status in ("blocked", "scheduled"):
                        ok = kanban_db.unblock_task(conn, task_id)
                    else:
                        ok = kanban_present.set_status_direct(conn, task_id, "ready")
                elif s == "archived":
                    ok = kanban_db.archive_task(conn, task_id)
                elif s == "running":
                    return _err(
                        rid, 5221,
                        "Cannot set status to 'running' directly; use the dispatcher/claim path",
                    )
                elif s in ("todo", "triage", "scheduled"):
                    ok = kanban_present.set_status_direct(conn, task_id, s)
                else:
                    return _err(rid, 5211, f"unknown status: {s}")
                if not ok:
                    if s == "ready":
                        blockers = kanban_present.parents_blocking_ready(conn, task_id)
                        if blockers:
                            names = ", ".join(
                                f"{p['title']!r} ({p['id']}, status={p['status']})"
                                for p in blockers
                            )
                            return _err(
                                rid, 5222,
                                f"Cannot move to 'ready': blocked by parent(s) "
                                f"not done — {names}",
                            )
                    return _err(
                        rid, 5222,
                        f"status transition to {s!r} not valid from current state",
                    )

            # --- model/provider override ---------------------------------------
            if clear_model_override or model_override is not None:
                new_model = (
                    None if clear_model_override
                    else (model_override or "").strip() or None
                )
                try:
                    ok = kanban_db.set_model_override(
                        conn, task_id, new_model, provider=provider_override,
                    )
                except (ValueError, RuntimeError) as e:
                    return _err(rid, 5213, str(e))
                if not ok:
                    return _err(rid, 5212, "task not found")

            # --- reasoning effort ----------------------------------------------
            if clear_reasoning_effort or reasoning_effort is not None:
                new_effort = None if clear_reasoning_effort else reasoning_effort
                try:
                    ok = kanban_db.set_reasoning_effort(conn, task_id, new_effort)
                except (ValueError, RuntimeError) as e:
                    return _err(rid, 5213, str(e))
                if not ok:
                    return _err(rid, 5212, "task not found")

            # --- priority -----------------------------------------------------
            if priority is not None:
                with kanban_db.write_txn(conn):
                    conn.execute(
                        "UPDATE tasks SET priority = ? WHERE id = ?",
                        (int(priority), task_id),
                    )
                    conn.execute(
                        "INSERT INTO task_events (task_id, kind, payload, created_at) "
                        "VALUES (?, 'reprioritized', ?, ?)",
                        (task_id, _json.dumps({"priority": int(priority)}), int(_time.time())),
                    )

            # --- title / body -------------------------------------------------
            if title is not None or body is not None:
                with kanban_db.write_txn(conn):
                    sets, vals = [], []
                    if title is not None:
                        if not str(title).strip():
                            return _err(rid, 5211, "title cannot be empty")
                        sets.append("title = ?")
                        vals.append(str(title).strip())
                    if body is not None:
                        sets.append("body = ?")
                        vals.append(body)
                    vals.append(task_id)
                    conn.execute(
                        f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", vals,
                    )
                    conn.execute(
                        "INSERT INTO task_events (task_id, kind, payload, created_at) "
                        "VALUES (?, 'edited', NULL, ?)",
                        (task_id, int(_time.time())),
                    )

            updated = kanban_db.get_task(conn, task_id)
            return _ok(rid, {"task": kanban_present.task_dict(updated) if updated else None})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 5. kanban.task.delete
# ---------------------------------------------------------------------------

@method("kanban.task.delete")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    if not task_id:
        return _err(rid, 5210, "task_id is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            ok = kanban_db.delete_task(conn, task_id)
            if not ok:
                return _err(rid, 5212, f"task {task_id} not found")
            return _ok(rid, {"deleted": True, "task_id": task_id})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 6. kanban.task.attachments.list
# ---------------------------------------------------------------------------

@method("kanban.task.attachments.list")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    if not task_id:
        return _err(rid, 5210, "task_id is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            if kanban_db.get_task(conn, task_id) is None:
                return _err(rid, 5212, f"task {task_id} not found")
            return _ok(
                rid,
                {
                    "attachments": [
                        kanban_present.attachment_dict(a)
                        for a in kanban_db.list_attachments(conn, task_id)
                    ]
                },
            )
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 7. kanban.task.attachments.upload
# ---------------------------------------------------------------------------

@method("kanban.task.attachments.upload")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    """Base64 upload — JSON-RPC has no multipart equivalent to plugin_api's
    ``UploadFile`` route, so this accepts the whole file as one base64 blob
    (validated against ``KANBAN_ATTACHMENT_MAX_BYTES`` before writing).
    """
    task_id = str(params.get("task_id") or "")
    filename = str(params.get("filename") or "")
    content_b64 = params.get("content_b64")
    if not task_id:
        return _err(rid, 5210, "task_id is required")
    if not filename:
        return _err(rid, 5230, "filename is required")
    if not content_b64:
        return _err(rid, 5230, "content_b64 is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)

    try:
        data = base64.b64decode(content_b64, validate=True)
    except (binascii.Error, ValueError) as e:
        return _err(rid, 5231, f"invalid base64 content: {e}")

    if len(data) > kanban_db.KANBAN_ATTACHMENT_MAX_BYTES:
        return _err(
            rid, 5232,
            f"attachment exceeds "
            f"{kanban_db.KANBAN_ATTACHMENT_MAX_BYTES // (1024 * 1024)} MB limit",
        )

    try:
        with _kanban_conn(board) as conn:
            if kanban_db.get_task(conn, task_id) is None:
                return _err(rid, 5212, f"task {task_id} not found")

            try:
                safe_name = kanban_db._safe_attachment_name(filename)
            except ValueError as e:
                return _err(rid, 5231, str(e))

            dest_dir = kanban_db.task_attachments_dir(task_id, board=board)
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest_path = kanban_db._collision_free_path(dest_dir, safe_name)
            candidate = dest_path.name

            try:
                dest_path.write_bytes(data)
            except OSError as e:
                return _err(rid, 5233, f"failed to store attachment: {e}")

            att_id = kanban_db.add_attachment(
                conn,
                task_id,
                filename=candidate,
                stored_path=str(dest_path.resolve()),
                content_type=params.get("content_type"),
                size=len(data),
                uploaded_by=(params.get("uploaded_by") or "rpc"),
            )
            att = kanban_db.get_attachment(conn, att_id)
            return _ok(rid, {"attachment": kanban_present.attachment_dict(att) if att else None})
    except ValueError as e:
        return _err(rid, 5231, str(e))
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 8. kanban.attachment.download
# ---------------------------------------------------------------------------

@method("kanban.attachment.download")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    """Base64 download. Deliberate scope decision (not an oversight): unlike
    plugin_api's ``FileResponse`` streaming route, RPC responses aren't a
    good fit for huge files — this rejects (doesn't silently truncate) any
    attachment larger than ``KANBAN_ATTACHMENT_MAX_BYTES``.
    """
    attachment_id = params.get("attachment_id")
    if attachment_id is None:
        return _err(rid, 5210, "attachment_id is required")
    try:
        attachment_id = int(attachment_id)
    except (TypeError, ValueError):
        return _err(rid, 5211, "attachment_id must be an integer")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)

    from pathlib import Path

    try:
        with _kanban_conn(board) as conn:
            att = kanban_db.get_attachment(conn, attachment_id)
            if att is None:
                return _err(rid, 5234, "attachment not found")
            root = kanban_db.attachments_root(board=board).resolve()
            try:
                stored = Path(att.stored_path).resolve()
                stored.relative_to(root)
            except (ValueError, OSError):
                return _err(rid, 5234, "attachment file unavailable")
            if not stored.is_file():
                return _err(rid, 5234, "attachment file missing on disk")
            size = stored.stat().st_size
            if size > kanban_db.KANBAN_ATTACHMENT_MAX_BYTES:
                return _err(
                    rid, 5235,
                    f"attachment exceeds "
                    f"{kanban_db.KANBAN_ATTACHMENT_MAX_BYTES // (1024 * 1024)} MB "
                    "RPC download limit; not available over this transport",
                )
            content_b64 = base64.b64encode(stored.read_bytes()).decode("ascii")
            return _ok(
                rid,
                {
                    "filename": att.filename,
                    "content_type": att.content_type or "application/octet-stream",
                    "content_b64": content_b64,
                },
            )
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 9. kanban.attachment.delete
# ---------------------------------------------------------------------------

@method("kanban.attachment.delete")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    attachment_id = params.get("attachment_id")
    if attachment_id is None:
        return _err(rid, 5210, "attachment_id is required")
    try:
        attachment_id = int(attachment_id)
    except (TypeError, ValueError):
        return _err(rid, 5211, "attachment_id must be an integer")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            att = kanban_db.delete_attachment(conn, attachment_id)
            if att is None:
                return _err(rid, 5234, "attachment not found")
            return _ok(rid, {"ok": True, "id": attachment_id})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 10. kanban.task.comment.add
# ---------------------------------------------------------------------------

@method("kanban.task.comment.add")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    body = str(params.get("body") or "")
    if not task_id:
        return _err(rid, 5210, "task_id is required")
    if not body.strip():
        return _err(rid, 5211, "body is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            if kanban_db.get_task(conn, task_id) is None:
                return _err(rid, 5212, f"task {task_id} not found")
            kanban_db.add_comment(
                conn, task_id, author=(params.get("author") or "rpc"), body=body,
            )
            return _ok(rid, {"ok": True})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 11. kanban.link.add
# ---------------------------------------------------------------------------

@method("kanban.link.add")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    parent_id = str(params.get("parent_id") or "")
    child_id = str(params.get("child_id") or "")
    if not parent_id or not child_id:
        return _err(rid, 5210, "parent_id and child_id are required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            kanban_db.link_tasks(conn, parent_id, child_id)
            return _ok(rid, {"ok": True})
    except ValueError as e:
        return _err(rid, 5260, str(e))
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 12. kanban.link.delete
# ---------------------------------------------------------------------------

@method("kanban.link.delete")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    parent_id = str(params.get("parent_id") or "")
    child_id = str(params.get("child_id") or "")
    if not parent_id or not child_id:
        return _err(rid, 5210, "parent_id and child_id are required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            ok = kanban_db.unlink_tasks(conn, parent_id, child_id)
            return _ok(rid, {"ok": bool(ok)})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 13. kanban.task.bulk_update
# ---------------------------------------------------------------------------

@method("kanban.task.bulk_update")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    ids = [i for i in (params.get("ids") or []) if i]
    if not ids:
        return _err(rid, 5210, "ids is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)

    import json as _json
    import time as _time

    status = params.get("status")
    assignee = params.get("assignee")
    priority = params.get("priority")
    archive = bool(params.get("archive", False))
    result = params.get("result")
    summary = params.get("summary")
    metadata = params.get("metadata")
    reclaim_first = bool(params.get("reclaim_first", False))
    model_override = params.get("model_override")
    provider_override = params.get("provider_override")
    clear_model_override = bool(params.get("clear_model_override", False))
    reasoning_effort = params.get("reasoning_effort")
    clear_reasoning_effort = bool(params.get("clear_reasoning_effort", False))

    results: list[dict] = []
    try:
        with _kanban_conn(board) as conn:
            for tid in ids:
                entry: dict[str, Any] = {"id": tid, "ok": True}
                try:
                    task = kanban_db.get_task(conn, tid)
                    if task is None:
                        entry.update(ok=False, error="not found")
                        results.append(entry)
                        continue
                    if archive:
                        if not kanban_db.archive_task(conn, tid):
                            entry.update(ok=False, error="archive refused")
                    if status is not None and not archive:
                        s = status
                        if s == "done":
                            ok = kanban_db.complete_task(
                                conn, tid, result=result, summary=summary, metadata=metadata,
                            )
                        elif s == "blocked":
                            ok = kanban_db.block_task(conn, tid)
                        elif s == "ready":
                            cur = kanban_db.get_task(conn, tid)
                            if cur and cur.status in ("blocked", "scheduled"):
                                ok = kanban_db.unblock_task(conn, tid)
                            else:
                                ok = kanban_present.set_status_direct(conn, tid, "ready")
                        elif s == "running":
                            entry.update(
                                ok=False,
                                error=(
                                    "Cannot set status to 'running' directly; "
                                    "use the dispatcher/claim path"
                                ),
                            )
                            results.append(entry)
                            continue
                        elif s == "scheduled":
                            ok = kanban_db.schedule_task(conn, tid)
                        elif s in {"todo", "triage"}:
                            ok = kanban_present.set_status_direct(conn, tid, s)
                        else:
                            entry.update(ok=False, error=f"unknown status {s!r}")
                            results.append(entry)
                            continue
                        if not ok:
                            entry.update(ok=False, error=f"transition to {s!r} refused")
                    if assignee is not None:
                        try:
                            if reclaim_first:
                                ok = kanban_db.reassign_task(
                                    conn, tid, assignee or None, reclaim_first=True,
                                )
                            else:
                                ok = kanban_db.assign_task(conn, tid, assignee or None)
                            if not ok:
                                entry.update(ok=False, error="assign refused")
                        except RuntimeError as e:
                            entry.update(ok=False, error=str(e))
                    if priority is not None:
                        with kanban_db.write_txn(conn):
                            conn.execute(
                                "UPDATE tasks SET priority = ? WHERE id = ?",
                                (int(priority), tid),
                            )
                            conn.execute(
                                "INSERT INTO task_events (task_id, kind, payload, created_at) "
                                "VALUES (?, 'reprioritized', ?, ?)",
                                (tid, _json.dumps({"priority": int(priority)}), int(_time.time())),
                            )
                    if clear_model_override or model_override is not None:
                        new_model = (
                            None if clear_model_override
                            else (model_override or "").strip() or None
                        )
                        try:
                            ok = kanban_db.set_model_override(
                                conn, tid, new_model, provider=provider_override,
                            )
                            if not ok:
                                entry.update(ok=False, error="model override refused")
                        except (ValueError, RuntimeError) as e:
                            entry.update(ok=False, error=str(e))
                    if clear_reasoning_effort or reasoning_effort is not None:
                        new_effort = None if clear_reasoning_effort else reasoning_effort
                        try:
                            ok = kanban_db.set_reasoning_effort(conn, tid, new_effort)
                            if not ok:
                                entry.update(ok=False, error="reasoning override refused")
                        except (ValueError, RuntimeError) as e:
                            entry.update(ok=False, error=str(e))
                except Exception as e:  # one bad id shouldn't kill the batch
                    entry.update(ok=False, error=str(e))
                results.append(entry)
            return _ok(rid, {"results": results})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 14. kanban.diagnostics.list
# ---------------------------------------------------------------------------

@method("kanban.diagnostics.list")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    severity = params.get("severity")
    try:
        with _kanban_conn(board) as conn:
            diags_by_task = kanban_present.compute_task_diagnostics(conn, task_ids=None)
            if not diags_by_task:
                return _ok(rid, {"diagnostics": [], "count": 0})

            from hermes_cli import kanban_diagnostics as kd

            if severity:
                filtered: dict[str, list[dict]] = {}
                for tid, dl in diags_by_task.items():
                    keep = [
                        d for d in dl
                        if kd.severity_at_or_above(d.get("severity"), severity)
                    ]
                    if keep:
                        filtered[tid] = keep
                diags_by_task = filtered
                if not diags_by_task:
                    return _ok(rid, {"diagnostics": [], "count": 0})

            ids = list(diags_by_task.keys())
            placeholders = ",".join(["?"] * len(ids))
            rows = {
                r["id"]: r
                for r in conn.execute(
                    f"SELECT id, title, status, assignee FROM tasks WHERE id IN ({placeholders})",
                    tuple(ids),
                ).fetchall()
            }

            out = []
            for tid, dl in diags_by_task.items():
                r = rows.get(tid)
                out.append({
                    "task_id": tid,
                    "task_title": r["title"] if r else None,
                    "task_status": r["status"] if r else None,
                    "task_assignee": r["assignee"] if r else None,
                    "diagnostics": dl,
                })

            sev_idx = {s: i for i, s in enumerate(kd.SEVERITY_ORDER)}

            def _sort_key(row):
                top = row["diagnostics"][0]
                return (
                    -sev_idx.get(top.get("severity"), -1),
                    -(top.get("last_seen_at") or 0),
                )

            out.sort(key=_sort_key)

            return _ok(
                rid,
                {"diagnostics": out, "count": sum(len(d["diagnostics"]) for d in out)},
            )
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 15. kanban.workers.active
# ---------------------------------------------------------------------------

@method("kanban.workers.active")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    import time as _time

    try:
        with _kanban_conn(board) as conn:
            rows = conn.execute(
                """
                SELECT
                    r.id          AS run_id,
                    r.task_id,
                    t.title       AS task_title,
                    t.status      AS task_status,
                    t.assignee    AS task_assignee,
                    r.profile,
                    r.worker_pid,
                    r.started_at,
                    r.claim_lock,
                    r.claim_expires,
                    r.last_heartbeat_at,
                    r.max_runtime_seconds
                FROM task_runs r
                JOIN tasks t ON t.id = r.task_id
                WHERE r.ended_at IS NULL
                  AND r.worker_pid IS NOT NULL
                  AND t.status = 'running'
                ORDER BY r.started_at ASC
                """,
            ).fetchall()
            workers = [
                {
                    "run_id": row["run_id"],
                    "task_id": row["task_id"],
                    "task_title": row["task_title"],
                    "task_status": row["task_status"],
                    "task_assignee": row["task_assignee"],
                    "profile": row["profile"],
                    "worker_pid": row["worker_pid"],
                    "started_at": row["started_at"],
                    "claim_lock": row["claim_lock"],
                    "claim_expires": row["claim_expires"],
                    "last_heartbeat_at": row["last_heartbeat_at"],
                    "max_runtime_seconds": row["max_runtime_seconds"],
                }
                for row in rows
            ]
            return _ok(
                rid, {"workers": workers, "count": len(workers), "checked_at": int(_time.time())},
            )
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 16. kanban.run.get
# ---------------------------------------------------------------------------

@method("kanban.run.get")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    run_id = params.get("run_id")
    if run_id is None:
        return _err(rid, 5210, "run_id is required")
    try:
        run_id = int(run_id)
    except (TypeError, ValueError):
        return _err(rid, 5211, "run_id must be an integer")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            r = kanban_db.get_run(conn, run_id)
            if r is None:
                return _err(rid, 5240, f"run {run_id} not found")
            return _ok(rid, {"run": kanban_present.run_dict(r)})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 17. kanban.run.inspect
# ---------------------------------------------------------------------------

@method("kanban.run.inspect")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    run_id = params.get("run_id")
    if run_id is None:
        return _err(rid, 5210, "run_id is required")
    try:
        run_id = int(run_id)
    except (TypeError, ValueError):
        return _err(rid, 5211, "run_id must be an integer")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            r = kanban_db.get_run(conn, run_id)
            if r is None:
                return _err(rid, 5240, f"run {run_id} not found")
    except Exception as e:
        return _err(rid, 5290, str(e))

    if r.ended_at is not None:
        return _ok(rid, {"run_id": run_id, "alive": False, "reason": "run already ended"})
    if r.worker_pid is None:
        return _ok(rid, {"run_id": run_id, "alive": False, "reason": "no worker_pid recorded"})

    pid = r.worker_pid
    try:
        import psutil as _psutil
    except ImportError:
        _psutil = None  # type: ignore[assignment]

    if _psutil is None:
        return _ok(
            rid, {"run_id": run_id, "alive": False, "pid": pid, "reason": "psutil not available"},
        )

    try:
        proc = _psutil.Process(pid)
        info = proc.as_dict(attrs=[
            "cpu_percent", "memory_info", "num_threads", "status", "create_time", "cmdline",
        ])
        try:
            num_fds = proc.num_fds()
        except AttributeError:
            num_fds = None
        mem = info.get("memory_info")
        return _ok(
            rid,
            {
                "run_id": run_id,
                "alive": True,
                "pid": pid,
                "cpu_percent": info.get("cpu_percent"),
                "memory_rss_bytes": mem.rss if mem else None,
                "memory_vms_bytes": mem.vms if mem else None,
                "num_threads": info.get("num_threads"),
                "num_fds": num_fds,
                "status": info.get("status"),
                "create_time": info.get("create_time"),
                "cmdline": info.get("cmdline"),
            },
        )
    except _psutil.NoSuchProcess:
        return _ok(rid, {"run_id": run_id, "alive": False, "pid": pid, "reason": "process not found"})
    except _psutil.AccessDenied:
        return _ok(rid, {"run_id": run_id, "alive": True, "pid": pid, "error": "access denied"})


# ---------------------------------------------------------------------------
# 18. kanban.run.terminate
# ---------------------------------------------------------------------------

@method("kanban.run.terminate")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    run_id = params.get("run_id")
    if run_id is None:
        return _err(rid, 5210, "run_id is required")
    try:
        run_id = int(run_id)
    except (TypeError, ValueError):
        return _err(rid, 5211, "run_id must be an integer")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    reason = params.get("reason")
    try:
        with _kanban_conn(board) as conn:
            r = kanban_db.get_run(conn, run_id)
            if r is None:
                return _err(rid, 5240, f"run {run_id} not found")
            if r.ended_at is not None:
                return _err(rid, 5241, f"run {run_id} already ended")
            ok = kanban_db.reclaim_task(conn, r.task_id, reason=reason)
            if not ok:
                return _err(
                    rid, 5241,
                    f"cannot terminate run {run_id}: task {r.task_id} is no "
                    "longer in a reclaimable state",
                )
            return _ok(rid, {"ok": True, "run_id": run_id, "task_id": r.task_id})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 19. kanban.task.reclaim
# ---------------------------------------------------------------------------

@method("kanban.task.reclaim")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    if not task_id:
        return _err(rid, 5210, "task_id is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            ok = kanban_db.reclaim_task(conn, task_id, reason=params.get("reason"))
            if not ok:
                return _err(
                    rid, 5241,
                    f"cannot reclaim {task_id}: not in a claimable state "
                    "(not running, or unknown id)",
                )
            return _ok(rid, {"ok": True, "task_id": task_id})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 20. kanban.task.specify
# ---------------------------------------------------------------------------

@method("kanban.task.specify")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    if not task_id:
        return _err(rid, 5210, "task_id is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with kanban_db.scoped_current_board(board or kanban_db.DEFAULT_BOARD):
            from hermes_cli import kanban_specify

            outcome = kanban_specify.specify_task(
                task_id, author=(params.get("author") or None),
            )
        return _ok(
            rid,
            {
                "ok": bool(outcome.ok),
                "task_id": outcome.task_id,
                "reason": outcome.reason,
                "new_title": outcome.new_title,
            },
        )
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 21. kanban.task.reassign
# ---------------------------------------------------------------------------

@method("kanban.task.reassign")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    if not task_id:
        return _err(rid, 5210, "task_id is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    profile = params.get("profile")
    try:
        with _kanban_conn(board) as conn:
            ok = kanban_db.reassign_task(
                conn, task_id, profile or None,
                reclaim_first=bool(params.get("reclaim_first", False)),
                reason=params.get("reason"),
            )
            if not ok:
                return _err(
                    rid, 5241,
                    f"cannot reassign {task_id}: unknown id, or still "
                    "running (pass reclaim_first=true to release the claim first)",
                )
            return _ok(rid, {"ok": True, "task_id": task_id, "assignee": profile or None})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 22. kanban.estimate.text
# ---------------------------------------------------------------------------

@method("kanban.estimate.text")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    return _ok(rid, _run_estimate(params.get("title") or "", params.get("body")))


# ---------------------------------------------------------------------------
# 23. kanban.task.estimate
# ---------------------------------------------------------------------------

@method("kanban.task.estimate")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    if not task_id:
        return _err(rid, 5210, "task_id is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            task = kanban_db.get_task(conn, task_id)
    except Exception as e:
        return _err(rid, 5290, str(e))
    if task is None:
        return _err(rid, 5212, f"task {task_id} not found")
    return _ok(rid, _run_estimate(task.title, task.body))


# ---------------------------------------------------------------------------
# 24. kanban.config.get
# ---------------------------------------------------------------------------

@method("kanban.config.get")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    try:
        from hermes_cli.config import load_config
        cfg = load_config() or {}
    except Exception:
        cfg = {}
    dash_cfg = cfg.get("dashboard") or {}
    k_cfg = dash_cfg.get("kanban") or {}
    return _ok(
        rid,
        {
            "default_tenant": k_cfg.get("default_tenant") or "",
            "lane_by_profile": bool(k_cfg.get("lane_by_profile", True)),
            "include_archived_by_default": bool(k_cfg.get("include_archived_by_default", False)),
            "render_markdown": bool(k_cfg.get("render_markdown", True)),
        },
    )


# ---------------------------------------------------------------------------
# 25. kanban.home_channels.list
# ---------------------------------------------------------------------------

@method("kanban.home_channels.list")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = params.get("task_id")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    homes = _configured_home_channels()
    subscribed_homes: set[tuple[str, str, str]] = set()
    if task_id:
        try:
            with _kanban_conn(board) as conn:
                subs = kanban_db.list_notify_subs(conn, task_id)
        except Exception as e:
            return _err(rid, 5290, str(e))
        for sub in subs:
            key = (
                str(sub.get("platform") or ""),
                str(sub.get("chat_id") or ""),
                str(sub.get("thread_id") or ""),
            )
            subscribed_homes.add(key)
    result = []
    for home in homes:
        key = (home["platform"], home["chat_id"], home["thread_id"])
        result.append({**home, "subscribed": key in subscribed_homes})
    return _ok(rid, {"home_channels": result})


# ---------------------------------------------------------------------------
# 26. kanban.task.home_subscribe
# ---------------------------------------------------------------------------

@method("kanban.task.home_subscribe")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    platform = str(params.get("platform") or "")
    if not task_id or not platform:
        return _err(rid, 5210, "task_id and platform are required")
    homes = _configured_home_channels()
    home = next((h for h in homes if h["platform"] == platform), None)
    if not home:
        return _err(
            rid, 5212,
            f"No home channel configured for platform {platform!r}. "
            f"Set one from the messenger via /sethome, or configure "
            f"gateway.platforms.{platform}.home_channel in config.yaml.",
        )
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            task = kanban_db.get_task(conn, task_id)
            if task is None:
                return _err(rid, 5212, f"task {task_id} not found")
            kanban_db.add_notify_sub(
                conn, task_id=task_id, platform=platform,
                chat_id=home["chat_id"], thread_id=home["thread_id"] or None,
                notifier_profile=_active_profile_name(),
            )
            return _ok(rid, {"ok": True, "task_id": task_id, "home_channel": home})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 27. kanban.task.home_unsubscribe
# ---------------------------------------------------------------------------

@method("kanban.task.home_unsubscribe")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    platform = str(params.get("platform") or "")
    if not task_id or not platform:
        return _err(rid, 5210, "task_id and platform are required")
    homes = _configured_home_channels()
    home = next((h for h in homes if h["platform"] == platform), None)
    if not home:
        return _err(rid, 5212, f"No home channel configured for platform {platform!r}.")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            kanban_db.remove_notify_sub(
                conn, task_id=task_id, platform=platform,
                chat_id=home["chat_id"], thread_id=home["thread_id"] or None,
            )
            return _ok(rid, {"ok": True, "task_id": task_id, "home_channel": home})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 28. kanban.stats.get
# ---------------------------------------------------------------------------

@method("kanban.stats.get")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            return _ok(rid, kanban_db.board_stats(conn))
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 29. kanban.assignees.list
# ---------------------------------------------------------------------------

@method("kanban.assignees.list")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with _kanban_conn(board) as conn:
            return _ok(rid, {"assignees": kanban_db.known_assignees(conn)})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 30. kanban.task.log.get
# ---------------------------------------------------------------------------

@method("kanban.task.log.get")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    if not task_id:
        return _err(rid, 5210, "task_id is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    tail = params.get("tail")
    try:
        with _kanban_conn(board) as conn:
            task = kanban_db.get_task(conn, task_id)
    except Exception as e:
        return _err(rid, 5290, str(e))
    if task is None:
        return _err(rid, 5212, f"task {task_id} not found")
    try:
        content = kanban_db.read_worker_log(task_id, tail_bytes=tail, board=board)
        log_path = kanban_db.worker_log_path(task_id, board=board)
        size = log_path.stat().st_size if log_path.exists() else 0
        return _ok(
            rid,
            {
                "task_id": task_id,
                "path": str(log_path),
                "exists": content is not None,
                "size_bytes": size,
                "content": content or "",
                "truncated": bool(tail and size > tail),
            },
        )
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 31. kanban.dispatch
# ---------------------------------------------------------------------------

@method("kanban.dispatch")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    dry_run = bool(params.get("dry_run", False))
    max_n = params.get("max", params.get("max_n", 8))
    try:
        max_n = int(max_n)
    except (TypeError, ValueError):
        max_n = 8
    try:
        with _kanban_conn(board) as conn:
            result = kanban_db.dispatch_once(conn, dry_run=dry_run, max_spawn=max_n, board=board)
            from dataclasses import asdict as _asdict
            try:
                return _ok(rid, _asdict(result))
            except TypeError:
                return _ok(rid, {"result": str(result)})
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 32. kanban.model_options.list
# ---------------------------------------------------------------------------

@method("kanban.model_options.list")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    try:
        from hermes_cli.inventory import build_models_payload, load_picker_context

        payload = build_models_payload(
            load_picker_context(), explicit_only=True, canonical_order=True,
            probe_custom_providers=False,
        )
        return _ok(
            rid,
            {
                "providers": [
                    {
                        "slug": row.get("slug", ""),
                        "label": row.get("label") or row.get("slug", ""),
                        "models": list(row.get("models") or []),
                    }
                    for row in payload.get("providers", [])
                    if row.get("models")
                ],
            },
        )
    except Exception:
        log.exception("kanban model-options failed")
        return _ok(rid, {"providers": []})


# ---------------------------------------------------------------------------
# 33. kanban.projects.list
# ---------------------------------------------------------------------------

@method("kanban.projects.list")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    try:
        from hermes_cli import projects_db as pdb
        with pdb.connect_closing() as pconn:
            projects = pdb.list_projects(pconn, include_archived=False)
    except Exception as exc:
        return _err(rid, 5290, f"failed to list projects: {exc}")
    return _ok(
        rid,
        {
            "projects": [
                {
                    "id": p.id,
                    "slug": p.slug,
                    "name": p.name,
                    "primary_path": p.primary_path or "",
                    "icon": p.icon or "",
                    "color": p.color or "",
                }
                for p in projects
            ]
        },
    )


# ---------------------------------------------------------------------------
# 34. kanban.boards.list
# ---------------------------------------------------------------------------

@method("kanban.boards.list")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    include_archived = bool(params.get("include_archived", False))
    boards = kanban_db.list_boards(include_archived=include_archived)
    current = kanban_db.get_current_board()
    proj_map = kanban_present.projects_by_id()
    for b in boards:
        b["is_current"] = (b["slug"] == current)
        b["counts"] = kanban_present.board_counts(b["slug"])
        b["total"] = sum(n for status, n in b["counts"].items() if status != "archived")
        b["default_workspace_kind"] = kanban_present.default_workspace_kind(b)
        pid = b.get("project_id") or None
        b["project_id"] = pid
        proj = proj_map.get(pid) if pid else None
        b["project_name"] = proj.name if proj else None
    return _ok(rid, {"boards": boards, "current": current})


# ---------------------------------------------------------------------------
# 35. kanban.boards.create
# ---------------------------------------------------------------------------

@method("kanban.boards.create")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    slug = str(params.get("slug") or "")
    if not slug:
        return _err(rid, 5210, "slug is required")
    default_workdir = None
    if params.get("default_workdir"):
        try:
            default_workdir = kanban_present.validate_workdir(params["default_workdir"])
        except ValueError as e:
            return _err(rid, 5250, str(e))
    try:
        project_id, _pname, primary_path = kanban_present.resolve_project(params.get("project_id"))
    except ValueError as e:
        return _err(rid, 5250, str(e))
    if primary_path and not default_workdir:
        default_workdir = primary_path
    try:
        meta = kanban_db.create_board(
            slug,
            name=params.get("name"),
            description=params.get("description"),
            icon=params.get("icon"),
            color=params.get("color"),
            default_workdir=default_workdir,
            project_id=project_id,
        )
    except ValueError as e:
        return _err(rid, 5250, str(e))
    if bool(params.get("switch", False)):
        try:
            kanban_db.set_current_board(meta["slug"])
        except ValueError as e:
            return _err(rid, 5250, str(e))
    meta["default_workspace_kind"] = kanban_present.default_workspace_kind(meta)
    try:
        _, meta["project_name"], _ = kanban_present.resolve_project(meta.get("project_id"))
    except ValueError:
        meta["project_name"] = None
    return _ok(rid, {"board": meta, "current": kanban_db.get_current_board()})


# ---------------------------------------------------------------------------
# 36. kanban.boards.update
# ---------------------------------------------------------------------------

@method("kanban.boards.update")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    slug = str(params.get("slug") or "")
    if not slug:
        return _err(rid, 5210, "slug is required")
    try:
        normed = kanban_db._normalize_board_slug(slug)
    except ValueError as e:
        return _err(rid, 5200, str(e))
    if not normed or not kanban_db.board_exists(normed):
        return _err(rid, 5201, f"board {slug!r} does not exist")

    default_workdir: Optional[str] = None
    if params.get("default_workdir") is not None:
        raw = str(params["default_workdir"]).strip()
        if raw:
            try:
                default_workdir = kanban_present.validate_workdir(raw)
            except ValueError as e:
                return _err(rid, 5250, str(e))
        else:
            default_workdir = ""

    project_id: Optional[str] = None
    project_name: Optional[str] = None
    if params.get("project_id") is not None:
        pid_raw = str(params["project_id"]).strip()
        if pid_raw:
            try:
                project_id, project_name, primary_path = kanban_present.resolve_project(pid_raw)
            except ValueError as e:
                return _err(rid, 5250, str(e))
            if primary_path and default_workdir is None:
                default_workdir = primary_path
        else:
            project_id = ""

    meta = kanban_db.write_board_metadata(
        normed,
        name=params.get("name"),
        description=params.get("description"),
        icon=params.get("icon"),
        color=params.get("color"),
        default_workdir=default_workdir,
        project_id=project_id,
    )
    meta["default_workspace_kind"] = kanban_present.default_workspace_kind(meta)
    try:
        _, meta["project_name"], _ = kanban_present.resolve_project(meta.get("project_id"))
    except ValueError:
        meta["project_name"] = None
    return _ok(rid, {"board": meta})


# ---------------------------------------------------------------------------
# 37. kanban.boards.delete
# ---------------------------------------------------------------------------

@method("kanban.boards.delete")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    slug = str(params.get("slug") or "")
    if not slug:
        return _err(rid, 5210, "slug is required")
    try:
        res = kanban_db.remove_board(slug, archive=not bool(params.get("delete", False)))
    except ValueError as e:
        return _err(rid, 5250, str(e))
    return _ok(rid, {"result": res, "current": kanban_db.get_current_board()})


# ---------------------------------------------------------------------------
# 38. kanban.boards.switch
# ---------------------------------------------------------------------------

@method("kanban.boards.switch")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    slug = str(params.get("slug") or "")
    if not slug:
        return _err(rid, 5210, "slug is required")
    try:
        normed = kanban_db._normalize_board_slug(slug)
    except ValueError as e:
        return _err(rid, 5200, str(e))
    if not normed or not kanban_db.board_exists(normed):
        return _err(rid, 5201, f"board {slug!r} does not exist")
    kanban_db.set_current_board(normed)
    return _ok(rid, {"current": normed})


# ---------------------------------------------------------------------------
# 39. kanban.profiles.list
# ---------------------------------------------------------------------------

@method("kanban.profiles.list")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    try:
        from hermes_cli import profiles as profiles_mod
        profiles = profiles_mod.list_profiles()
    except Exception as exc:
        return _err(rid, 5290, f"failed to list profiles: {exc}")
    return _ok(
        rid,
        {
            "profiles": [
                {
                    "name": p.name,
                    "is_default": bool(p.is_default),
                    "model": p.model or "",
                    "provider": p.provider or "",
                    "description": p.description or "",
                    "description_auto": bool(p.description_auto),
                    "skill_count": int(p.skill_count or 0),
                }
                for p in profiles
            ],
        },
    )


# ---------------------------------------------------------------------------
# 40. kanban.profiles.update_description
# ---------------------------------------------------------------------------

@method("kanban.profiles.update_description")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    profile_name = str(params.get("profile_name") or "")
    if not profile_name:
        return _err(rid, 5210, "profile_name is required")
    try:
        from hermes_cli import profiles as profiles_mod
        canon = profiles_mod.normalize_profile_name(profile_name)
        if canon == "default":
            from hermes_constants import get_hermes_home
            from pathlib import Path as _Path
            profile_dir = _Path(get_hermes_home())
        else:
            profile_dir = profiles_mod.get_profile_dir(canon)
        if not profile_dir.is_dir():
            return _err(rid, 5212, f"profile '{profile_name}' not found")
        text = str(params.get("description") or "").strip()
        profiles_mod.write_profile_meta(profile_dir, description=text, description_auto=False)
    except Exception as exc:
        return _err(rid, 5290, f"failed to update profile: {exc}")
    return _ok(rid, {"ok": True, "profile": canon, "description": text})


# ---------------------------------------------------------------------------
# 41. kanban.profiles.describe_auto
# ---------------------------------------------------------------------------

@method("kanban.profiles.describe_auto")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    profile_name = str(params.get("profile_name") or "")
    if not profile_name:
        return _err(rid, 5210, "profile_name is required")
    try:
        from hermes_cli import profile_describer
        outcome = profile_describer.describe_profile(
            profile_name, overwrite=bool(params.get("overwrite", False)),
        )
    except Exception as exc:
        return _err(rid, 5290, f"describer crashed: {exc}")
    return _ok(
        rid,
        {
            "ok": bool(outcome.ok),
            "profile": outcome.profile_name,
            "reason": outcome.reason,
            "description": outcome.description,
        },
    )


# ---------------------------------------------------------------------------
# 42. kanban.task.decompose
# ---------------------------------------------------------------------------

@method("kanban.task.decompose")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    task_id = str(params.get("task_id") or "")
    if not task_id:
        return _err(rid, 5210, "task_id is required")
    try:
        board = _resolve_kanban_board(_board_param(params))
    except _KanbanRpcError as e:
        return _err(rid, e.code, e.message)
    try:
        with kanban_db.scoped_current_board(board or kanban_db.DEFAULT_BOARD):
            from hermes_cli import kanban_decompose

            outcome = kanban_decompose.decompose_task(
                task_id, author=(params.get("author") or None),
            )
        return _ok(
            rid,
            {
                "ok": bool(outcome.ok),
                "task_id": outcome.task_id,
                "reason": outcome.reason,
                "fanout": bool(outcome.fanout),
                "child_ids": outcome.child_ids or [],
                "new_title": outcome.new_title,
            },
        )
    except Exception as e:
        return _err(rid, 5290, str(e))


# ---------------------------------------------------------------------------
# 43. kanban.orchestration.get
# ---------------------------------------------------------------------------

@method("kanban.orchestration.get")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    return _ok(rid, _get_orchestration_settings())


# ---------------------------------------------------------------------------
# 44. kanban.orchestration.set
# ---------------------------------------------------------------------------

@method("kanban.orchestration.set")
def _(
    rid, params: dict, *,
    kanban_db=kanban_db, kanban_present=kanban_present,
    _resolve_kanban_board=_resolve_kanban_board, _kanban_conn=_kanban_conn,
    _KanbanRpcError=_KanbanRpcError, _run_estimate=_run_estimate, log=log,
    _board_param=_board_param,
    _configured_home_channels=_configured_home_channels,
    _active_profile_name=_active_profile_name,
    _get_orchestration_settings=_get_orchestration_settings,
    base64=base64, binascii=binascii,
) -> dict:
    try:
        from hermes_cli.config import load_config, save_config
        cfg = load_config() or {}
    except Exception as exc:
        return _err(rid, 5290, f"failed to load config: {exc}")

    kanban_section = cfg.setdefault("kanban", {})
    if not isinstance(kanban_section, dict):
        kanban_section = {}
        cfg["kanban"] = kanban_section

    try:
        from hermes_cli import profiles as profiles_mod
    except Exception:
        profiles_mod = None  # type: ignore

    orchestrator_profile = params.get("orchestrator_profile")
    default_assignee = params.get("default_assignee")
    auto_decompose = params.get("auto_decompose")
    auto_promote_children = params.get("auto_promote_children")

    if orchestrator_profile is not None:
        name = str(orchestrator_profile or "").strip()
        if name and profiles_mod is not None:
            try:
                if not profiles_mod.profile_exists(name):
                    return _err(rid, 5250, f"profile '{name}' does not exist")
            except Exception:
                pass
        kanban_section["orchestrator_profile"] = name

    if default_assignee is not None:
        name = str(default_assignee or "").strip()
        if name and profiles_mod is not None:
            try:
                if not profiles_mod.profile_exists(name):
                    return _err(rid, 5250, f"profile '{name}' does not exist")
            except Exception:
                pass
        kanban_section["default_assignee"] = name

    if auto_decompose is not None:
        kanban_section["auto_decompose"] = bool(auto_decompose)

    if auto_promote_children is not None:
        kanban_section["auto_promote_children"] = bool(auto_promote_children)

    try:
        save_config(cfg)
    except Exception as exc:
        return _err(rid, 5290, f"failed to save config: {exc}")

    return _ok(rid, _get_orchestration_settings())


def register(server) -> None:
    """Bind this module's handlers onto ``server``'s globals and registry."""
    _registry.install(server)
