"""Read-only Roadmaps JSON-RPC handlers plus execution and governance mutations."""
from .method_ctx import HandlerRegistry

_registry = HandlerRegistry()
method = _registry.method
_profile_scoped = _registry.profile_scoped


def _required(value, name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    value = value.strip()
    if not value or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError(f"{name} required")
    if len(value) > 128:
        raise ValueError(f"{name} must be at most 128 characters")
    return value


def _resolve_profile(value) -> str:
    if value is None:
        raise ValueError("profile_id required")
    profile = _required(value, "profile_id")
    # Security: validate the profile NAME format before any path resolution.
    # get_profile_dir() only normalizes (lower()), it does NOT validate — a
    # traversal payload like "../skills" would otherwise resolve to an
    # arbitrary existing directory under ~/.hermes, and the WRITE path
    # (RoadmapsWriter → projects_db.connect) would seed a fresh projects.db
    # there. validate_profile_name enforces ^[a-z0-9][a-z0-9_-]{0,63}$ and
    # rejects reserved names (defense in depth at the new RPC surface).
    from hermes_cli.profiles import validate_profile_name

    try:
        validate_profile_name(profile)
    except ValueError as exc:
        raise ValueError(f"invalid profile scope: {profile!r}") from exc
    if profile != _server_module._current_profile_name() and _server_module._profile_home(profile) is None:
        raise ValueError("profile scope unavailable")
    return profile


def _scope(params: dict, *, roadmap: bool = False) -> tuple[str, str | None, str | None]:
    if not isinstance(params, dict):
        raise ValueError("params must be an object")
    profile = _resolve_profile(params.get("profile"))
    project = _required(params["project_id"], "project_id") if "project_id" in params else None
    roadmap_id = _required(params["roadmap_id"], "roadmap_id") if "roadmap_id" in params else None
    if roadmap and project is None:
        raise ValueError("project_id required")
    if roadmap and roadmap_id is None:
        raise ValueError("roadmap_id required")
    return profile, project, roadmap_id


def _service(profile: str):
    from hermes_cli.roadmaps_service import RoadmapsService
    home = _server_module._profile_home(profile)
    return RoadmapsService((_server_module._hermes_home if home is None else home) / "projects.db")


def _writer(profile: str):
    from hermes_cli.roadmaps_writer import RoadmapsWriter
    home = _server_module._profile_home(profile)
    return RoadmapsWriter((_server_module._hermes_home if home is None else home) / "projects.db")


def _handle(rid, params, *, operation: str, roadmap: bool = False):
    try:
        profile, project, roadmap_id = _scope(params, roadmap=roadmap)
        service = _service(profile)
        if operation == "list":
            result = service.list(profile, project)
        elif operation == "get":
            result = service.get(profile, project, roadmap_id)
        else:
            result = service.snapshot(profile, project, roadmap_id)
        return _ok(rid, result)
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception:
        logger.exception("roadmaps.%s failed", operation)
        return _err(rid, 5061, "roadmaps unavailable")


@method("roadmaps.list")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_handle(rid, params, operation="list")


@method("roadmaps.get")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_handle(rid, params, operation="get", roadmap=True)


@method("roadmaps.snapshot")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_handle(rid, params, operation="snapshot", roadmap=True)


# ── execution mutations ─────────────────────────────────────────────────────
# Structured error codes: 5063 validation/scope, 5064 stale expected_version,
# 5065 roadmap/node not found, 5066 invalid transition, 5061 unavailable.

def _mutation_scope(
    params: dict, *, require_node: bool = True
) -> tuple[str, str | None, str, str | None, str, int]:
    if not isinstance(params, dict):
        raise ValueError("params must be an object")
    profile, project, roadmap_id = _scope(params, roadmap=True)
    # _scope(roadmap=True) already rejects None; narrow for the type checker.
    # (No assert: asserts vanish under python -O; the guard below is real.)
    # node_id is required for node-targeted mutations (claim/progress/
    # complete/block/unblock) but not for update_todo: the writer's
    # update_todo keys on todo_id only and never receives node_id.
    if require_node and "node_id" not in params:
        raise ValueError("node_id required")
    if "actor" not in params:
        raise ValueError("actor required")
    node_id = _required(params["node_id"], "node_id") if require_node else None
    actor = _required(params["actor"], "actor")
    expected = params.get("expected_version")
    if isinstance(expected, bool) or not isinstance(expected, int):
        raise ValueError("expected_version must be an integer")
    if project is None or roadmap_id is None:
        raise ValueError("project_id and roadmap_id required")
    return profile, project, roadmap_id, node_id, actor, expected


def _mutation_error_code(exc: Exception) -> int:
    from hermes_cli.roadmaps_writer import (
        InvalidRoadmapPlanTransitionError,
        InvalidRoadmapTodoTransitionError,
        InvalidRoadmapTransitionError,
        PlanBatteryFailedError,
        RoadmapExistsError,
        RoadmapNodeNotFoundError,
        RoadmapNotFoundError,
        RoadmapProjectNotFoundError,
        RoadmapTodoNotFoundError,
        RoadmapVersionExistsError,
        RoadmapVersionNotFoundError,
        StaleRoadmapVersionError,
    )

    if isinstance(exc, StaleRoadmapVersionError):
        return 5064
    if isinstance(exc, PlanBatteryFailedError):
        return 5063
    if isinstance(exc, (RoadmapNotFoundError, RoadmapProjectNotFoundError,
                        RoadmapNodeNotFoundError, RoadmapTodoNotFoundError,
                        RoadmapVersionNotFoundError)):
        return 5065
    if isinstance(exc, (InvalidRoadmapTransitionError,
                        InvalidRoadmapTodoTransitionError,
                        InvalidRoadmapPlanTransitionError)):
        return 5066
    if isinstance(exc, (RoadmapVersionExistsError, RoadmapExistsError)):
        return 5067
    return 5061


def _mutation_handle(rid, params, *, operation: str, **extra):
    try:
        # update_todo keys on todo_id only (the writer never receives
        # node_id), so it is exempt from the node_id requirement.
        require_node = operation != "update_todo"
        profile, project, roadmap_id, node_id, actor, expected = _mutation_scope(
            params, require_node=require_node
        )
        # _mutation_scope already rejects missing/blank scope ids and, for
        # node-targeted operations, a missing node_id; narrow for the type
        # checker. (No assert: asserts vanish under python -O; the guard
        # below is real.)
        if project is None or roadmap_id is None or (require_node and node_id is None):
            raise ValueError("project_id, roadmap_id, and node_id required")
        writer = _writer(profile)
        if operation == "claim_node":
            result = writer.claim_node(profile, project, roadmap_id, node_id, actor, expected)
        elif operation == "advance_node":
            result = writer.advance_node(profile, project, roadmap_id, node_id, actor, expected)
        elif operation == "update_progress":
            progress = params.get("progress")
            if isinstance(progress, bool) or not isinstance(progress, int):
                raise ValueError("progress must be an integer")
            result = writer.update_progress(profile, project, roadmap_id, node_id, actor, progress, expected)
        elif operation == "complete_node":
            result = writer.complete_node(profile, project, roadmap_id, node_id, actor, expected)
        elif operation == "block_node":
            reason = params.get("reason")
            if not isinstance(reason, str) or not reason.strip():
                raise ValueError("reason required")
            result = writer.block_node(profile, project, roadmap_id, node_id, actor, reason.strip(), expected)
        elif operation == "update_todo":
            todo_id = _required(params.get("todo_id"), "todo_id")
            state = _required(params.get("state"), "state")
            result = writer.update_todo(profile, project, roadmap_id, todo_id, actor, state, expected)
        else:
            result = writer.unblock_node(profile, project, roadmap_id, node_id, actor, expected)
        return _ok(rid, result)
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception as exc:
        from hermes_cli.roadmaps_writer import RoadmapsWriteError

        if isinstance(exc, RoadmapsWriteError):
            return _err(rid, _mutation_error_code(exc), str(exc))
        logger.exception("roadmaps.%s failed", operation)
        return _err(rid, 5061, "roadmaps unavailable")


@method("roadmaps.claim_node")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_mutation_handle(rid, params, operation="claim_node")


@method("roadmaps.advance_node")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_mutation_handle(rid, params, operation="advance_node")


@method("roadmaps.update_progress")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_mutation_handle(rid, params, operation="update_progress")


@method("roadmaps.complete_node")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_mutation_handle(rid, params, operation="complete_node")


@method("roadmaps.block_node")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_mutation_handle(rid, params, operation="block_node")


@method("roadmaps.unblock_node")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_mutation_handle(rid, params, operation="unblock_node")


@method("roadmaps.update_todo")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_mutation_handle(rid, params, operation="update_todo")


# ── durable Vision session links ────────────────────────────────────────────

def _sessions_handle(rid, params: dict, *, attach: bool = False) -> dict:
    try:
        profile, project, roadmap_id = _scope(params, roadmap=True)
        if project is None or roadmap_id is None:
            raise ValueError("project_id and roadmap_id required")
        if "runtime_session_id" in params:
            raise ValueError("runtime_session_id is not accepted")
        if attach:
            result = _writer(profile).attach_session(
                profile,
                project,
                roadmap_id,
                _required(params.get("stored_session_id"), "stored_session_id"),
                _required(params.get("actor"), "actor"),
                _expected(params),
                kind=params.get("kind", "vision"),
                plan_version=params.get("plan_version"),
            )
        else:
            result = _service(profile).list_sessions(profile, project, roadmap_id)
        return _ok(rid, result)
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception as exc:
        from hermes_cli.roadmaps_writer import RoadmapsWriteError

        if isinstance(exc, RoadmapsWriteError):
            code = _mutation_error_code(exc)
            messages = {
                5064: "roadmap version is stale",
                5065: "roadmap scope not found",
                5066: "invalid roadmap transition",
                5067: "roadmap conflict",
            }
            return _err(rid, code, messages.get(code, "roadmaps unavailable"))
        logger.exception("roadmaps.%s failed", "attach_session" if attach else "sessions")
        return _err(rid, 5061, "roadmaps unavailable")


@method("roadmaps.attach_session")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_sessions_handle(rid, params, attach=True)


@method("roadmaps.sessions")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_sessions_handle(rid, params)


# ── roadmap CRUD + plan governance (T5b) ────────────────────────────────────
# Error codes: 5063 validation/scope, 5064 stale expected_version,
# 5065 not found, 5066 invalid transition, 5067 conflict (version/id exists),
# 5061 unavailable.  Only designed messages ever reach the client; unexpected
# exceptions are logged server-side and mapped to the generic 5061.

def _admin_scope(params: dict, *, create: bool = False) -> tuple[str, str | None, str | None]:
    """Scope for the admin surface: profile + project, plus roadmap_id
    except for ``roadmaps.create`` (where it is optional and generated)."""
    if not isinstance(params, dict):
        raise ValueError("params must be an object")
    profile = _resolve_profile(params.get("profile"))
    project = _required(params["project_id"], "project_id") if "project_id" in params else None
    roadmap_id = _required(params["roadmap_id"], "roadmap_id") if "roadmap_id" in params else None
    if project is None:
        raise ValueError("project_id required")
    if not create and roadmap_id is None:
        raise ValueError("roadmap_id required")
    return profile, project, roadmap_id


def _expected(params: dict) -> int | None:
    expected = params.get("expected_version")
    if isinstance(expected, bool) or not isinstance(expected, int):
        raise ValueError("expected_version must be an integer")
    return expected


def _admin_handle(rid, params: dict, *, operation: str) -> dict:
    try:
        create = operation == "roadmaps.create"
        profile, project, roadmap_id = _admin_scope(params, create=create)
        # _admin_scope already rejects these; narrow for the type checker.
        # (No assert: asserts vanish under python -O; the guard below is real.)
        if project is None or (not create and roadmap_id is None):
            raise ValueError("project_id and roadmap_id required")
        actor = _required(params.get("actor"), "actor")
        writer = _writer(profile)
        if operation == "roadmaps.create":
            result = writer.create_roadmap(
                profile, project, params.get("title"), actor,
                roadmap_id=roadmap_id, purpose=params.get("purpose"),
                lifecycle_state=params.get("lifecycle_state"),
            )
        elif operation == "roadmaps.update":
            result = writer.update_roadmap(
                profile, project, roadmap_id, actor, _expected(params),
                title=params.get("title"), purpose=params.get("purpose"),
                lifecycle_state=params.get("lifecycle_state"),
            )
        elif operation == "roadmaps.archive":
            result = writer.archive_roadmap(
                profile, project, roadmap_id, actor, _expected(params)
            )
        elif operation == "plans.create":
            result = writer.create_plan(
                profile, project, roadmap_id, actor,
                version=params.get("version"), nodes=params.get("nodes"),
                relations=params.get("relations"), todos=params.get("todos"),
                source=params.get("source"), reason=params.get("reason"),
            )
        elif operation == "plans.activate":
            result = writer.activate_plan(
                profile, project, roadmap_id, params.get("version"),
                actor, _expected(params),
            )
        elif operation == "plans.validate":
            result = writer.validate_plan(
                profile, project, roadmap_id, params.get("version"),
                actor, _expected(params),
            )
        elif operation == "roadmaps.spawn_kanban":
            result = writer.spawn_kanban_cards(
                profile, project, roadmap_id, params.get("version"),
                params.get("node_id"), actor,
                board_slug=params.get("board_slug"),
            )
        elif operation == "team.set":
            result = writer.set_team(
                profile, project, roadmap_id, params.get("version"),
                actor,
                workers=params.get("workers"),
                assignments=params.get("assignments"),
            )
        elif operation == "readiness.set":
            result = writer.set_readiness(
                profile, project, roadmap_id, params.get("version"),
                actor,
                items=params.get("items"),
            )
        else:
            raise ValueError(f"unknown roadmaps admin operation {operation!r}")
        return _ok(rid, result)
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception as exc:
        from hermes_cli.roadmaps_writer import RoadmapsWriteError

        if isinstance(exc, RoadmapsWriteError):
            return _err(rid, _mutation_error_code(exc), str(exc))
        logger.exception("roadmaps.%s failed", operation)
        return _err(rid, 5061, "roadmaps unavailable")


def _plans_read_handle(rid, params: dict, *, operation: str) -> dict:
    try:
        profile, project, roadmap_id = _scope(params, roadmap=True)
        # _scope(roadmap=True) already rejects None; narrow for the type checker.
        if project is None or roadmap_id is None:
            raise ValueError("project_id and roadmap_id required")
        service = _service(profile)
        if operation == "plans.list":
            result = service.list_plans(profile, project, roadmap_id)
        else:
            version = params.get("version")
            if isinstance(version, bool) or not isinstance(version, int):
                raise ValueError("version must be an integer")
            result = service.get_plan(profile, project, roadmap_id, version)
        return _ok(rid, result)
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception:
        logger.exception("roadmaps.%s failed", operation)
        return _err(rid, 5061, "roadmaps unavailable")


@method("roadmaps.create")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_admin_handle(rid, params, operation="roadmaps.create")


@method("roadmaps.update")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_admin_handle(rid, params, operation="roadmaps.update")


@method("roadmaps.archive")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_admin_handle(rid, params, operation="roadmaps.archive")


@method("plans.create")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_admin_handle(rid, params, operation="plans.create")


@method("plans.activate")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_admin_handle(rid, params, operation="plans.activate")


@method("plans.validate")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_admin_handle(rid, params, operation="plans.validate")


@method("roadmaps.spawn_kanban")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_admin_handle(rid, params, operation="roadmaps.spawn_kanban")


@method("team.set")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_admin_handle(rid, params, operation="team.set")


@method("readiness.set")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_admin_handle(rid, params, operation="readiness.set")


@method("plans.list")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_plans_read_handle(rid, params, operation="plans.list")


@method("plans.get")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_plans_read_handle(rid, params, operation="plans.get")


def _plans_check_handle(rid, params: dict) -> dict:
    try:
        profile, project, roadmap_id = _scope(params, roadmap=True)
        if project is None or roadmap_id is None:
            raise ValueError("project_id and roadmap_id required")
        version = params.get("version")
        if isinstance(version, bool) or not isinstance(version, int):
            raise ValueError("version must be an integer")
        result = _service(profile).check_battery(profile, project, roadmap_id, version)
        return _ok(rid, result)
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception:
        logger.exception("plans.check failed")
        return _err(rid, 5061, "roadmaps unavailable")


@method("plans.check")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_plans_check_handle(rid, params)


def _kanban_links_handle(rid, params: dict) -> dict:
    try:
        profile, project, roadmap_id = _scope(params, roadmap=True)
        if project is None or roadmap_id is None:
            raise ValueError("project_id and roadmap_id required")
        version = params.get("version")
        if version is not None and (isinstance(version, bool) or not isinstance(version, int)):
            raise ValueError("version must be an integer")
        result = _service(profile).list_kanban_links(profile, project, roadmap_id, version)
        return _ok(rid, result)
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception:
        logger.exception("roadmaps.kanban_links failed")
        return _err(rid, 5061, "roadmaps unavailable")


@method("roadmaps.kanban_links")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_kanban_links_handle(rid, params)


def _team_check_handle(rid, params: dict) -> dict:
    try:
        profile, project, roadmap_id = _scope(params, roadmap=True)
        if project is None or roadmap_id is None:
            raise ValueError("project_id and roadmap_id required")
        version = params.get("version")
        if isinstance(version, bool) or not isinstance(version, int):
            raise ValueError("version must be an integer")
        result = _service(profile).check_team_battery(profile, project, roadmap_id, version)
        return _ok(rid, result)
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception:
        logger.exception("team.check failed")
        return _err(rid, 5061, "roadmaps unavailable")


@method("team.check")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_team_check_handle(rid, params)


def _readiness_check_handle(rid, params: dict) -> dict:
    try:
        profile, project, roadmap_id = _scope(params, roadmap=True)
        if project is None or roadmap_id is None:
            raise ValueError("project_id and roadmap_id required")
        version = params.get("version")
        if isinstance(version, bool) or not isinstance(version, int):
            raise ValueError("version must be an integer")
        result = _service(profile).check_readiness_battery(profile, project, roadmap_id, version)
        return _ok(rid, result)
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception:
        logger.exception("readiness.check failed")
        return _err(rid, 5061, "roadmaps unavailable")


@method("readiness.check")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_readiness_check_handle(rid, params)


def _team_list_handle(rid, params: dict) -> dict:
    try:
        profile, project, roadmap_id = _scope(params, roadmap=True)
        if project is None or roadmap_id is None:
            raise ValueError("project_id and roadmap_id required")
        version = params.get("version")
        if version is not None and (isinstance(version, bool) or not isinstance(version, int)):
            raise ValueError("version must be an integer")
        result = _service(profile).list_team(profile, project, roadmap_id, version)
        return _ok(rid, result)
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception:
        logger.exception("team.list failed")
        return _err(rid, 5061, "roadmaps unavailable")


@method("team.list")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_team_list_handle(rid, params)


def _readiness_list_handle(rid, params: dict) -> dict:
    try:
        profile, project, roadmap_id = _scope(params, roadmap=True)
        if project is None or roadmap_id is None:
            raise ValueError("project_id and roadmap_id required")
        version = params.get("version")
        if version is not None and (isinstance(version, bool) or not isinstance(version, int)):
            raise ValueError("version must be an integer")
        result = _service(profile).list_readiness(profile, project, roadmap_id, version)
        return _ok(rid, result)
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception:
        logger.exception("readiness.list failed")
        return _err(rid, 5061, "roadmaps unavailable")


@method("readiness.list")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_readiness_list_handle(rid, params)


def _board_handle(rid, params: dict) -> dict:
    try:
        profile, project, roadmap_id = _scope(params, roadmap=True)
        if project is None or roadmap_id is None:
            raise ValueError("project_id and roadmap_id required")
        version = params.get("version")
        if version is not None and (isinstance(version, bool) or not isinstance(version, int)):
            raise ValueError("version must be an integer")
        result = _service(profile).board(profile, project, roadmap_id, version)
        return _ok(rid, result)
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception:
        logger.exception("roadmaps.board failed")
        return _err(rid, 5061, "roadmaps unavailable")


@method("roadmaps.board")
@_profile_scoped
def _(rid, params: dict) -> dict:
    return _roadmaps_board_handle(rid, params)


# ── roadmaps.planning_rules (T5c: versioned Vision planning rules) ──────────
# Read-only, GLOBAL rules: no profile/project/roadmap scope required.  The
# payload is the versioned system prompt the Vision session agent receives.
# Unknown version → 5063; unexpected backend failure → 5061 generic (the raw
# exception is logged server-side, never surfaced to the plugin).


def _planning_rules_handle(rid, params: dict) -> dict:
    try:
        if not isinstance(params, dict):
            raise ValueError("params must be an object")
        version = params.get("version")
        if version is not None and not isinstance(version, str):
            raise ValueError("version must be a string")
        from hermes_cli.roadmaps_planning_rules import get_planning_rules

        rules = get_planning_rules(version)
        return _ok(rid, {"version": rules["version"], "rules": rules})
    except ValueError as exc:
        return _err(rid, 5063, str(exc))
    except Exception:
        logger.exception("roadmaps.planning_rules failed")
        return _err(rid, 5061, "roadmaps unavailable")


@method("roadmaps.planning_rules")
def _(rid, params: dict) -> dict:
    return _planning_rules_handle(rid, params)


def register(server) -> None:
    # HandlerRegistry rebinds handler globals to server.py. Expose the small
    # shared dispatchers there too, while retaining this module's helper globals.
    _handle.__globals__.update(vars(server))
    _handle.__globals__["_server_module"] = server
    server._roadmaps_handle = _handle
    _mutation_handle.__globals__.update(vars(server))
    _mutation_handle.__globals__["_server_module"] = server
    server._roadmaps_mutation_handle = _mutation_handle
    _admin_handle.__globals__.update(vars(server))
    _admin_handle.__globals__["_server_module"] = server
    server._roadmaps_admin_handle = _admin_handle
    _plans_read_handle.__globals__.update(vars(server))
    _plans_read_handle.__globals__["_server_module"] = server
    server._roadmaps_plans_read_handle = _plans_read_handle
    _planning_rules_handle.__globals__.update(vars(server))
    _planning_rules_handle.__globals__["_server_module"] = server
    server._planning_rules_handle = _planning_rules_handle
    _sessions_handle.__globals__.update(vars(server))
    _sessions_handle.__globals__["_server_module"] = server
    server._roadmaps_sessions_handle = _sessions_handle
    _plans_check_handle.__globals__.update(vars(server))
    _plans_check_handle.__globals__["_server_module"] = server
    server._roadmaps_plans_check_handle = _plans_check_handle
    _kanban_links_handle.__globals__.update(vars(server))
    _kanban_links_handle.__globals__["_server_module"] = server
    server._roadmaps_kanban_links_handle = _kanban_links_handle
    _team_check_handle.__globals__.update(vars(server))
    _team_check_handle.__globals__["_server_module"] = server
    server._roadmaps_team_check_handle = _team_check_handle
    _team_list_handle.__globals__.update(vars(server))
    _team_list_handle.__globals__["_server_module"] = server
    server._roadmaps_team_list_handle = _team_list_handle
    _readiness_check_handle.__globals__.update(vars(server))
    _readiness_check_handle.__globals__["_server_module"] = server
    server._roadmaps_readiness_check_handle = _readiness_check_handle
    _readiness_list_handle.__globals__.update(vars(server))
    _readiness_list_handle.__globals__["_server_module"] = server
    server._roadmaps_readiness_list_handle = _readiness_list_handle
    _board_handle.__globals__.update(vars(server))
    _board_handle.__globals__["_server_module"] = server
    server._roadmaps_board_handle = _board_handle
    _registry.install(server)
