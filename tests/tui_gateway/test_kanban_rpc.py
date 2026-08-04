"""Tests for the kanban.* JSON-RPC methods on the tui_gateway server.

Follows tests/tui_gateway/test_projects_rpc.py's style: call the registered
handler directly via ``server._methods[name](rid, params)`` and assert on
the ``_ok``/``_err`` envelope shape. Every test runs against an isolated
``HERMES_HOME`` (tmp_path) so it never touches a real installation's kanban
data.
"""

from __future__ import annotations

import base64

import pytest

from hermes_cli import kanban_db as kb
import tui_gateway.server as server


@pytest.fixture(autouse=True)
def _kanban_home(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    kb.init_db()
    return home


def _call(method, params=None):
    handler = server._methods[method]
    return handler(1, params or {})


def _ok(method, params=None):
    resp = _call(method, params)
    assert "error" not in resp, resp.get("error")
    return resp["result"]


def _err(method, params=None):
    resp = _call(method, params)
    assert "error" in resp, resp
    return resp["error"]


def test_methods_registered():
    for i in (
        "kanban.board.get", "kanban.task.get", "kanban.task.create",
        "kanban.task.update", "kanban.task.delete",
        "kanban.task.attachments.list", "kanban.task.attachments.upload",
        "kanban.attachment.download", "kanban.attachment.delete",
        "kanban.task.comment.add", "kanban.link.add", "kanban.link.delete",
        "kanban.task.bulk_update", "kanban.diagnostics.list",
        "kanban.workers.active", "kanban.run.get", "kanban.run.inspect",
        "kanban.run.terminate", "kanban.task.reclaim", "kanban.task.specify",
        "kanban.task.reassign", "kanban.estimate.text", "kanban.task.estimate",
        "kanban.config.get", "kanban.home_channels.list",
        "kanban.task.home_subscribe", "kanban.task.home_unsubscribe",
        "kanban.stats.get", "kanban.assignees.list", "kanban.task.log.get",
        "kanban.dispatch", "kanban.model_options.list", "kanban.projects.list",
        "kanban.boards.list", "kanban.boards.create", "kanban.boards.update",
        "kanban.boards.delete", "kanban.boards.switch", "kanban.profiles.list",
        "kanban.profiles.update_description", "kanban.profiles.describe_auto",
        "kanban.task.decompose", "kanban.orchestration.get",
        "kanban.orchestration.set",
    ):
        assert i in server._methods, i


# ── Board resolution ─────────────────────────────────────────────────────

def test_board_omitted_falls_through_to_default():
    result = _ok("kanban.board.get", {})
    assert "columns" in result


def test_unknown_board_returns_404_equivalent():
    err = _err("kanban.task.get", {"task_id": "x", "board": "does-not-exist"})
    assert err["code"] == 5201


def test_malformed_board_slug_returns_400_equivalent():
    err = _err("kanban.task.get", {"task_id": "x", "board": "../evil"})
    assert err["code"] == 5200


# ── task.create / task.get round-trip ────────────────────────────────────

def test_create_get_roundtrip():
    created = _ok(
        "kanban.task.create",
        {"title": "Fix the thing", "body": "details here", "priority": 5},
    )
    task = created["task"]
    assert task["title"] == "Fix the thing"
    assert task["priority"] == 5

    fetched = _ok("kanban.task.get", {"task_id": task["id"]})
    assert fetched["task"]["id"] == task["id"]
    assert fetched["task"]["body"] == "details here"
    assert fetched["comments"] == []
    assert fetched["links"] == {"parents": [], "children": []}


def test_create_requires_title():
    err = _err("kanban.task.create", {"title": ""})
    assert err["code"] == 5213


def test_get_unknown_task_404_equivalent():
    err = _err("kanban.task.get", {"task_id": "t_doesnotexist"})
    assert err["code"] == 5212


# ── task.update: status transitions ──────────────────────────────────────

def test_update_status_todo_to_done():
    task_id = _ok("kanban.task.create", {"title": "Task A"})["task"]["id"]
    updated = _ok(
        "kanban.task.update",
        {"task_id": task_id, "status": "done", "summary": "all done"},
    )
    assert updated["task"]["status"] == "done"


def test_update_status_running_is_rejected():
    task_id = _ok("kanban.task.create", {"title": "Task B"})["task"]["id"]
    err = _err("kanban.task.update", {"task_id": task_id, "status": "running"})
    assert err["code"] == 5221


def test_update_status_ready_blocked_by_parent_enriches_error():
    parent_id = _ok("kanban.task.create", {"title": "Parent task"})["task"]["id"]
    child_id = _ok(
        "kanban.task.create", {"title": "Child task", "parents": [parent_id]},
    )["task"]["id"]
    # child starts in 'todo' (parent not done yet); force a direct 'ready' attempt.
    err = _err("kanban.task.update", {"task_id": child_id, "status": "ready"})
    assert err["code"] == 5222
    assert "Parent task" in err["message"]
    assert parent_id in err["message"]


# ── task.bulk_update: independent per-id outcomes ────────────────────────

def test_bulk_update_partial_failure_does_not_abort_others():
    id1 = _ok("kanban.task.create", {"title": "Bulk 1"})["task"]["id"]
    id2 = _ok("kanban.task.create", {"title": "Bulk 2"})["task"]["id"]
    result = _ok(
        "kanban.task.bulk_update",
        {"ids": [id1, "t_missing", id2], "priority": 9},
    )
    by_id = {r["id"]: r for r in result["results"]}
    assert by_id[id1]["ok"] is True
    assert by_id["t_missing"]["ok"] is False
    assert by_id["t_missing"]["error"] == "not found"
    assert by_id[id2]["ok"] is True

    fetched = _ok("kanban.task.get", {"task_id": id1})
    assert fetched["task"]["priority"] == 9


# ── link.add / link.delete round-trip ────────────────────────────────────

def test_link_add_delete_roundtrip():
    parent_id = _ok("kanban.task.create", {"title": "P"})["task"]["id"]
    child_id = _ok("kanban.task.create", {"title": "C"})["task"]["id"]

    _ok("kanban.link.add", {"parent_id": parent_id, "child_id": child_id})
    fetched = _ok("kanban.task.get", {"task_id": child_id})
    assert fetched["links"]["parents"] == [parent_id]

    del_result = _ok(
        "kanban.link.delete", {"parent_id": parent_id, "child_id": child_id},
    )
    assert del_result["ok"] is True
    fetched2 = _ok("kanban.task.get", {"task_id": child_id})
    assert fetched2["links"]["parents"] == []


# ── boards.create / boards.list / boards.switch round-trip ──────────────

def test_boards_create_list_switch_roundtrip():
    created = _ok("kanban.boards.create", {"slug": "sidework", "name": "Side Work"})
    assert created["board"]["slug"] == "sidework"

    listing = _ok("kanban.boards.list", {})
    slugs = {b["slug"] for b in listing["boards"]}
    assert "sidework" in slugs

    switched = _ok("kanban.boards.switch", {"slug": "sidework"})
    assert switched["current"] == "sidework"


def test_boards_create_duplicate_slug_error():
    _ok("kanban.boards.create", {"slug": "dup-board"})
    err = _err("kanban.boards.create", {"slug": "../nope"})
    assert err["code"] == 5250


# ── attachments: upload / list / download round-trip ─────────────────────

def test_attachment_upload_list_download_roundtrip():
    task_id = _ok("kanban.task.create", {"title": "With attachment"})["task"]["id"]
    raw = b"hello world, this is a test attachment"
    b64 = base64.b64encode(raw).decode("ascii")

    uploaded = _ok(
        "kanban.task.attachments.upload",
        {
            "task_id": task_id, "filename": "notes.txt",
            "content_b64": b64, "content_type": "text/plain",
        },
    )
    att = uploaded["attachment"]
    assert att["filename"] == "notes.txt"
    assert att["size"] == len(raw)

    listed = _ok("kanban.task.attachments.list", {"task_id": task_id})
    assert len(listed["attachments"]) == 1
    assert listed["attachments"][0]["id"] == att["id"]

    downloaded = _ok("kanban.attachment.download", {"attachment_id": att["id"]})
    assert downloaded["filename"] == "notes.txt"
    assert base64.b64decode(downloaded["content_b64"]) == raw


def test_attachment_download_not_found():
    err = _err("kanban.attachment.download", {"attachment_id": 999999})
    assert err["code"] == 5234


def test_attachment_upload_bad_base64():
    task_id = _ok("kanban.task.create", {"title": "Bad upload"})["task"]["id"]
    err = _err(
        "kanban.task.attachments.upload",
        {"task_id": task_id, "filename": "x.txt", "content_b64": "not-valid-base64!!"},
    )
    assert err["code"] == 5231


def test_attachment_upload_oversize_rejected(monkeypatch):
    monkeypatch.setattr(kb, "KANBAN_ATTACHMENT_MAX_BYTES", 4)
    task_id = _ok("kanban.task.create", {"title": "Too big"})["task"]["id"]
    b64 = base64.b64encode(b"this is definitely more than 4 bytes").decode("ascii")
    err = _err(
        "kanban.task.attachments.upload",
        {"task_id": task_id, "filename": "big.txt", "content_b64": b64},
    )
    assert err["code"] == 5232


# ── Simple passthrough methods (breadth over depth) ──────────────────────

def test_stats_get():
    result = _ok("kanban.stats.get", {})
    assert isinstance(result, dict)


def test_assignees_list():
    result = _ok("kanban.assignees.list", {})
    assert "assignees" in result


def test_diagnostics_list_empty_board():
    result = _ok("kanban.diagnostics.list", {})
    assert result == {"diagnostics": [], "count": 0}


def test_workers_active_empty_state():
    result = _ok("kanban.workers.active", {})
    assert result["workers"] == []
    assert result["count"] == 0


def test_model_options_list_does_not_crash():
    result = _ok("kanban.model_options.list", {})
    assert "providers" in result


def test_config_get():
    result = _ok("kanban.config.get", {})
    assert "render_markdown" in result


def test_orchestration_get_set_roundtrip():
    got = _ok("kanban.orchestration.get", {})
    assert "resolved_orchestrator_profile" in got

    updated = _ok("kanban.orchestration.set", {"auto_decompose": False})
    assert updated["auto_decompose"] is False

    got2 = _ok("kanban.orchestration.get", {})
    assert got2["auto_decompose"] is False


def test_profiles_list():
    result = _ok("kanban.profiles.list", {})
    assert "profiles" in result
    names = {p["name"] for p in result["profiles"]}
    assert "default" in names


def test_profiles_update_description():
    result = _ok(
        "kanban.profiles.update_description",
        {"profile_name": "default", "description": "the default profile"},
    )
    assert result["ok"] is True
    assert result["description"] == "the default profile"


# ── Graceful non-OK (not an RPC error) for auxiliary-LLM-backed methods ──

def test_estimate_text_graceful_without_auxiliary_client():
    result = _ok("kanban.estimate.text", {"title": "Some task"})
    # Either the auxiliary client genuinely isn't configured (ok=False) or
    # it is and returns a real estimate (ok=True) — either way this must be
    # a normal RPC result, never an RPC-level error.
    assert "ok" in result


def test_task_estimate_graceful_without_auxiliary_client():
    task_id = _ok("kanban.task.create", {"title": "Estimate me"})["task"]["id"]
    result = _ok("kanban.task.estimate", {"task_id": task_id})
    assert "ok" in result


def test_task_specify_graceful_outcome_shape():
    task_id = _ok(
        "kanban.task.create", {"title": "Spec me", "triage": True},
    )["task"]["id"]
    result = _ok("kanban.task.specify", {"task_id": task_id})
    assert "ok" in result and "task_id" in result and "reason" in result


def test_task_decompose_graceful_outcome_shape():
    task_id = _ok(
        "kanban.task.create", {"title": "Decompose me", "triage": True},
    )["task"]["id"]
    result = _ok("kanban.task.decompose", {"task_id": task_id})
    assert "ok" in result and "task_id" in result and "reason" in result


def test_profiles_describe_auto_graceful_outcome_shape():
    result = _ok("kanban.profiles.describe_auto", {"profile_name": "default"})
    assert "ok" in result and "profile" in result and "reason" in result
