"""RPC tests for the Roadmaps execution mutation handlers."""

from __future__ import annotations

from pathlib import Path

import json

from hermes_cli import projects_db, roadmaps_writer
from tui_gateway import server


def seed(path: Path) -> None:
    conn = projects_db.connect(path)
    conn.execute("INSERT INTO projects(id, slug, name, created_at) VALUES ('p', 'p', 'P', 1)")
    conn.execute(
        "INSERT INTO roadmaps VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("profile", "p", "r", "Roadmap", None, "in_progress", 1, "a", "a", 1, 1),
    )
    conn.execute(
        "INSERT INTO roadmap_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("profile", "p", "r", 1, "validated", "src", None, "a", 1, None),
    )
    conn.execute(
        "INSERT INTO roadmap_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("profile", "p", "r", 1, "n-ready", None, "step", "Ready", None, "ready", 0, None, None, 1, 1),
    )
    conn.execute(
        "INSERT INTO roadmap_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("profile", "p", "r", 1, "n-planned", None, "step", "Planned", None, "planned", 0, None, None, 1, 1),
    )
    conn.execute(
        "INSERT INTO roadmap_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("profile", "p", "r", 1, "n-running", None, "step", "Running", None, "in_progress", 10, "agent", None, 1, 1),
    )
    conn.execute(
        "INSERT INTO roadmap_todos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("profile", "p", "r", 1, "t-open", None, "Todo open", "open", 0, 1, 1),
    )
    conn.commit()
    conn.close()


def _prepare(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "projects.db"
    seed(path)
    monkeypatch.setattr(projects_db, "projects_db_path", lambda: path)
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    monkeypatch.setattr(server, "_current_profile_name", lambda: "profile")
    return path


MUTATION_METHODS = {
    "roadmaps.claim_node",
    "roadmaps.advance_node",
    "roadmaps.update_progress",
    "roadmaps.complete_node",
    "roadmaps.block_node",
    "roadmaps.unblock_node",
}


def test_mutation_rpc_handlers_are_registered(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    assert MUTATION_METHODS.issubset(server._methods)


def test_claim_node_rpc_round_trip(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.claim_node"](
        "1",
        {
            "profile": "profile",
            "project_id": "p",
            "roadmap_id": "r",
            "node_id": "n-ready",
            "actor": "agent-b",
            "expected_version": 1,
        },
    )
    assert response["result"]["success"] is True
    assert response["result"]["node"]["state"] == "in_progress"
    assert response["result"]["node"]["owner_agent"] == "agent-b"

    snapshot = server._methods["roadmaps.snapshot"](
        "2", {"profile": "profile", "project_id": "p", "roadmap_id": "r"}
    )
    nodes = {
        n["node_id"]: n
        for v in snapshot["result"]["roadmap"]["versions"]
        for n in v["nodes"]
    }
    assert nodes["n-ready"]["state"] == "in_progress"


def test_block_node_rpc_requires_reason(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.block_node"](
        "1",
        {
            "profile": "profile",
            "project_id": "p",
            "roadmap_id": "r",
            "node_id": "n-running",
            "actor": "agent",
            "expected_version": 1,
        },
    )
    assert response["error"]["code"] == 5063
    assert response["error"]["message"] == "reason required"


def test_advance_node_rpc_round_trip(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.advance_node"](
        "1",
        {
            "profile": "profile",
            "project_id": "p",
            "roadmap_id": "r",
            "node_id": "n-planned",
            "actor": "agent",
            "expected_version": 1,
        },
    )
    assert response["result"]["success"] is True
    assert response["result"]["node"]["state"] == "ready"

    snapshot = server._methods["roadmaps.snapshot"](
        "2", {"profile": "profile", "project_id": "p", "roadmap_id": "r"}
    )
    nodes = {
        n["node_id"]: n
        for v in snapshot["result"]["roadmap"]["versions"]
        for n in v["nodes"]
    }
    assert nodes["n-planned"]["state"] == "ready"


def test_advance_node_rpc_rejects_transition_from_ready(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.advance_node"](
        "1",
        {
            "profile": "profile",
            "project_id": "p",
            "roadmap_id": "r",
            "node_id": "n-ready",
            "actor": "agent",
            "expected_version": 1,
        },
    )
    assert response["error"]["code"] == 5066


def test_stale_version_returns_structured_5064(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.claim_node"](
        "1",
        {
            "profile": "profile",
            "project_id": "p",
            "roadmap_id": "r",
            "node_id": "n-ready",
            "actor": "agent",
            "expected_version": 42,
        },
    )
    assert response["error"]["code"] == 5064


def test_missing_node_returns_structured_5065(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.claim_node"](
        "1",
        {
            "profile": "profile",
            "project_id": "p",
            "roadmap_id": "r",
            "node_id": "n-missing",
            "actor": "agent",
            "expected_version": 1,
        },
    )
    assert response["error"]["code"] == 5065


def test_invalid_transition_returns_structured_5066(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    # A running node cannot be claimed again (in_progress -> in_progress).
    response = server._methods["roadmaps.claim_node"](
        "1",
        {
            "profile": "profile",
            "project_id": "p",
            "roadmap_id": "r",
            "node_id": "n-running",
            "actor": "agent",
            "expected_version": 1,
        },
    )
    assert response["error"]["code"] == 5066


def test_progress_rpc_round_trip(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.update_progress"](
        "1",
        {
            "profile": "profile",
            "project_id": "p",
            "roadmap_id": "r",
            "node_id": "n-running",
            "actor": "agent",
            "expected_version": 1,
            "progress": 70,
        },
    )
    assert response["result"]["node"]["progress"] == 70

    bad = server._methods["roadmaps.update_progress"](
        "2",
        {
            "profile": "profile",
            "project_id": "p",
            "roadmap_id": "r",
            "node_id": "n-running",
            "actor": "agent",
            "expected_version": 1,
            "progress": "half",
        },
    )
    assert bad["error"]["code"] == 5063


def test_unknown_profile_scope_is_rejected(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.claim_node"](
        "1",
        {
            "profile": "intruder",
            "project_id": "p",
            "roadmap_id": "r",
            "node_id": "n-ready",
            "actor": "agent",
            "expected_version": 1,
        },
    )
    assert response["error"]["code"] == 5063


def test_update_todo_rpc_without_node_id_succeeds(tmp_path, monkeypatch):
    # update_todo targets todo_id only — node_id is never forwarded to the
    # writer, so it must not be required by the mutation scope.
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.update_todo"](
        "1",
        {
            "profile": "profile",
            "project_id": "p",
            "roadmap_id": "r",
            "todo_id": "t-open",
            "actor": "agent",
            "state": "done",
            "expected_version": 1,
        },
    )
    assert response["result"]["success"] is True
    assert response["result"]["todo"]["todo_id"] == "t-open"
    assert response["result"]["todo"]["state"] == "done"


def test_update_todo_rpc_with_node_id_still_accepted(tmp_path, monkeypatch):
    # Backward compatibility: callers that still pass node_id keep working;
    # the writer ignores it (update_todo keys on todo_id only).
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.update_todo"](
        "1",
        {
            "profile": "profile",
            "project_id": "p",
            "roadmap_id": "r",
            "node_id": "n-ready",
            "todo_id": "t-open",
            "actor": "agent",
            "state": "in_progress",
            "expected_version": 1,
        },
    )
    assert response["result"]["success"] is True
    assert response["result"]["todo"]["state"] == "in_progress"


def test_roadmap_session_rpc_round_trip_uses_only_durable_id(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    attached = server._methods["roadmaps.attach_session"](
        "1",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "stored_session_id": "stored-vision", "kind": "vision",
            "actor": "pierre", "expected_version": 1,
        },
    )
    assert attached["result"]["session"]["stored_session_id"] == "stored-vision"

    listing = server._methods["roadmaps.sessions"](
        "2", {"profile": "profile", "project_id": "p", "roadmap_id": "r"}
    )
    assert listing["result"]["scope"] == {
        "profile_id": "profile", "project_id": "p", "roadmap_id": "r",
    }
    assert listing["result"]["sessions"][0]["stored_session_id"] == "stored-vision"
    assert "runtime_session_id" not in json.dumps(attached)
    assert "runtime_session_id" not in json.dumps(listing)


def test_roadmap_session_rpc_handlers_have_long_handler_parity():
    methods = {"roadmaps.attach_session", "roadmaps.sessions"}
    assert methods.issubset(server._methods)
    assert methods.issubset(server._LONG_HANDLERS)


def test_attach_session_rpc_stale_version_is_generic_and_rolls_back(tmp_path, monkeypatch):
    path = _prepare(tmp_path, monkeypatch)
    base = {
        "profile": "profile", "project_id": "p", "roadmap_id": "r",
        "kind": "vision", "actor": "pierre",
    }
    server._methods["roadmaps.attach_session"](
        "1", {**base, "stored_session_id": "stored-old", "expected_version": 1}
    )

    stale = server._methods["roadmaps.attach_session"](
        "2", {**base, "stored_session_id": "stored-new", "expected_version": 99}
    )

    assert stale["error"] == {
        "code": 5064, "message": "roadmap version is stale",
    }
    conn = projects_db.connect(path)
    rows = conn.execute(
        "SELECT stored_session_id, state FROM roadmap_sessions"
    ).fetchall()
    conn.close()
    assert [(row["stored_session_id"], row["state"]) for row in rows] == [
        ("stored-old", "active")
    ]


def test_attach_session_rpc_unknown_scope_has_generic_not_found(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.attach_session"](
        "1",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "missing",
            "stored_session_id": "stored", "actor": "pierre", "expected_version": 1,
        },
    )
    assert response["error"] == {
        "code": 5065, "message": "roadmap scope not found",
    }


def test_attach_session_rpc_rejects_runtime_session_id(tmp_path, monkeypatch):
    path = _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.attach_session"](
        "1",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "stored_session_id": "stored", "runtime_session_id": "runtime-transient",
            "actor": "pierre", "expected_version": 1,
        },
    )
    assert response["error"] == {
        "code": 5063, "message": "runtime_session_id is not accepted",
    }
    conn = projects_db.connect(path)
    assert conn.execute("SELECT COUNT(*) FROM roadmap_sessions").fetchone()[0] == 0
    conn.close()


def test_list_sessions_rpc_rejects_runtime_session_id(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.sessions"](
        "1",
        {
            "profile": "profile",
            "project_id": "p",
            "roadmap_id": "r",
            "runtime_session_id": "runtime-transient",
        },
    )
    assert response["error"] == {
        "code": 5063,
        "message": "runtime_session_id is not accepted",
    }


def test_attach_session_rpc_unexpected_error_is_generic(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)

    def explode(*args, **kwargs):
        raise RuntimeError("secret internal session detail")

    monkeypatch.setattr(roadmaps_writer.RoadmapsWriter, "attach_session", explode)
    response = server._methods["roadmaps.attach_session"](
        "1",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "stored_session_id": "stored", "actor": "pierre", "expected_version": 1,
        },
    )
    assert response["error"] == {"code": 5061, "message": "roadmaps unavailable"}
    assert "secret" not in response["error"]["message"]
