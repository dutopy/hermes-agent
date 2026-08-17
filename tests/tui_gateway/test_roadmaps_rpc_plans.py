"""RPC tests for roadmap CRUD + plans governance handlers (T5b)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hermes_cli import projects_db, roadmaps_writer
from tui_gateway import server


def seed(path: Path) -> None:
    conn = projects_db.connect(path)
    conn.execute("INSERT INTO projects(id, slug, name, created_at) VALUES ('p', 'p', 'P', 1)")
    conn.execute(
        "INSERT INTO roadmaps VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("profile", "p", "r", "Roadmap", None, "draft", None, "a", "a", 1, 1),
    )
    conn.execute(
        "INSERT INTO roadmap_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("profile", "p", "r", 1, "draft", None, "seed", None, "a", 1, None),
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


ADMIN_METHODS = {
    "roadmaps.create", "roadmaps.update", "roadmaps.archive",
    "roadmaps.spawn_kanban", "roadmaps.kanban_links",
    "plans.create", "plans.list", "plans.get", "plans.activate",
    "plans.validate",
    "team.set", "team.check", "team.list",
    "readiness.set", "readiness.check", "readiness.list",
    "roadmaps.board",
}


def test_roadmap_admin_rpc_handlers_are_registered(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    assert ADMIN_METHODS.issubset(server._methods)


def test_roadmaps_create_rpc_round_trip(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.create"](
        "1",
        {"profile": "profile", "project_id": "p", "title": "My roadmap",
         "actor": "pierre"},
    )
    assert response["result"]["success"] is True
    roadmap_id = response["result"]["roadmap_id"]
    assert roadmap_id.startswith("r_")
    assert response["result"]["version"] == 1
    snapshot = server._methods["roadmaps.snapshot"](
        "2", {"profile": "profile", "project_id": "p", "roadmap_id": roadmap_id}
    )
    assert snapshot["result"]["roadmap"]["title"] == "My roadmap"
    assert snapshot["result"]["roadmap"]["lifecycle_state"] == "draft"


def test_roadmaps_create_rpc_rejects_blank_title(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.create"](
        "1",
        {"profile": "profile", "project_id": "p", "title": "   ", "actor": "pierre"},
    )
    assert response["error"]["code"] == 5063
    assert response["error"]["message"] == "title required"


@pytest.mark.parametrize("state", ["validated", "completed", "archived"])
def test_roadmaps_create_rpc_rejects_non_draft_lifecycle_state(
    tmp_path, monkeypatch, state
):
    # The lifecycle machine is strict: a roadmap is born 'draft'. Asking for
    # a later state via create would bypass plans.validate / plans.activate
    # / roadmaps.archive, so it is rejected with 5063 before any insert.
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.create"](
        "1",
        {"profile": "profile", "project_id": "p", "title": "T", "actor": "pierre",
         "lifecycle_state": state},
    )
    assert response["error"]["code"] == 5063
    assert "lifecycle_state" in response["error"]["message"]


def test_roadmaps_create_rpc_accepts_explicit_draft_lifecycle_state(
    tmp_path, monkeypatch
):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.create"](
        "1",
        {"profile": "profile", "project_id": "p", "title": "T", "actor": "pierre",
         "lifecycle_state": "draft"},
    )
    assert response["result"]["success"] is True
    roadmap_id = response["result"]["roadmap_id"]
    snapshot = server._methods["roadmaps.snapshot"](
        "2", {"profile": "profile", "project_id": "p", "roadmap_id": roadmap_id}
    )
    assert snapshot["result"]["roadmap"]["lifecycle_state"] == "draft"


def test_roadmaps_update_rpc_rejects_lifecycle_state(tmp_path, monkeypatch):
    # lifecycle_state is not writable through roadmaps.update: transitions
    # belong to plans.validate / plans.activate / roadmaps.archive.
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.update"](
        "1",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r",
         "actor": "pierre", "expected_version": 0,
         "lifecycle_state": "completed"},
    )
    assert response["error"]["code"] == 5063
    assert "lifecycle_state" in response["error"]["message"]
    snapshot = server._methods["roadmaps.snapshot"](
        "2", {"profile": "profile", "project_id": "p", "roadmap_id": "r"}
    )
    assert snapshot["result"]["roadmap"]["lifecycle_state"] == "draft"


def test_roadmaps_plans_rpc_methods_run_off_the_ws_reader_thread():
    # Every roadmaps/plans RPC (reads AND writes) must be in _LONG_HANDLERS:
    # they open the per-profile projects.db (schema validation + WAL setup)
    # and the writes take an IMMEDIATE txn — inline they would freeze the WS
    # reader thread under GIL pressure (approval.respond / session.interrupt
    # queue behind them).
    roadmaps_plans_methods = {
        "plans.activate", "plans.create", "plans.get", "plans.list",
        "plans.validate",
        "roadmaps.archive", "roadmaps.block_node", "roadmaps.claim_node",
        "roadmaps.complete_node", "roadmaps.create", "roadmaps.get",
        "roadmaps.list", "roadmaps.snapshot", "roadmaps.unblock_node",
        "roadmaps.update", "roadmaps.update_progress", "roadmaps.update_todo",
    }
    assert roadmaps_plans_methods.issubset(server._LONG_HANDLERS)


def test_roadmaps_create_rpc_unknown_profile_scope(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.create"](
        "1",
        {"profile": "intruder", "project_id": "p", "title": "T", "actor": "pierre"},
    )
    assert response["error"]["code"] == 5063


def test_roadmaps_update_and_archive_rpc_round_trip(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    updated = server._methods["roadmaps.update"](
        "1",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r",
         "actor": "pierre", "expected_version": 0, "title": "Renamed"},
    )
    assert updated["result"]["roadmap"]["title"] == "Renamed"
    archived = server._methods["roadmaps.archive"](
        "2",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r",
         "actor": "pierre", "expected_version": 0},
    )
    assert archived["result"]["roadmap"]["lifecycle_state"] == "archived"
    again = server._methods["roadmaps.archive"](
        "3",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r",
         "actor": "pierre", "expected_version": 0},
    )
    assert again["error"]["code"] == 5066


def test_roadmaps_update_rpc_stale_version_5064(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.update"](
        "1",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r",
         "actor": "pierre", "expected_version": 42, "title": "X"},
    )
    assert response["error"]["code"] == 5064


def test_plans_create_rpc_round_trip(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["plans.create"](
        "1",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "actor": "agent-a", "version": 2,
            "nodes": [
                {"node_id": "obj", "kind": "objective", "title": "Objective"},
                {"node_id": "s1", "kind": "phase", "title": "Step 1",
                 "parent_node_id": "obj"},
            ],
            "relations": [
                {"relation_id": "rel1", "from_node_id": "s1", "to_node_id": "obj",
                 "kind": "depends_on"},
            ],
            "todos": [{"todo_id": "t1", "node_id": "s1", "title": "Do"}],
        },
    )
    assert response["result"]["success"] is True
    assert response["result"]["version"] == 2
    assert response["result"]["state"] == "proposed"
    plan = server._methods["plans.get"](
        "2",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r", "version": 2},
    )
    assert plan["result"]["found"] is True
    assert len(plan["result"]["plan"]["nodes"]) == 2


def test_plans_create_rpc_invalid_payload_5063_no_raw_message(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["plans.create"](
        "1",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "actor": "agent-a", "version": 2,
            "nodes": [{"node_id": "obj", "kind": "bogus", "title": "Objective"}],
            "relations": [], "todos": [],
        },
    )
    assert response["error"]["code"] == 5063
    assert "kind" in response["error"]["message"]


def test_plans_create_rpc_duplicate_version_5067(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    params = {
        "profile": "profile", "project_id": "p", "roadmap_id": "r",
        "actor": "agent-a", "version": 1,
        "nodes": [{"node_id": "obj", "kind": "objective", "title": "Objective"}],
        "relations": [], "todos": [],
    }
    response = server._methods["plans.create"]("1", params)
    assert response["error"]["code"] == 5067


def test_plans_activate_rpc_non_validated_5066(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    server._methods["plans.create"](
        "1",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "actor": "agent-a", "version": 2,
            "nodes": [{"node_id": "obj", "kind": "objective", "title": "Objective"}],
            "relations": [], "todos": [],
        },
    )
    response = server._methods["plans.activate"](
        "2",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r",
         "actor": "pierre", "expected_version": 0, "version": 2},
    )
    assert response["error"]["code"] == 5066


def test_plans_validate_activate_rpc_round_trip(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    server._methods["plans.create"](
        "0",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "actor": "agent-a", "version": 2,
            "nodes": [
                {"node_id": "obj", "kind": "objective", "title": "Objective",
                 "description": "Outcome and success criteria"},
                {"node_id": "ms-1", "kind": "milestone", "title": "Milestone 1",
                 "parent_node_id": "obj"},
                {"node_id": "ph-1", "kind": "phase", "title": "Phase 1",
                 "parent_node_id": "ms-1"},
            ],
            "relations": [],
            "todos": [
                {"todo_id": "t1", "node_id": "ph-1", "title": "Do it",
                 "acceptance": "Visible outcome"},
            ],
        },
    )
    validated = server._methods["plans.validate"](
        "1",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r",
         "actor": "pierre", "expected_version": 0, "version": 2},
    )
    assert validated["result"]["state"] == "validated"
    activated = server._methods["plans.activate"](
        "2",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r",
         "actor": "pierre", "expected_version": 0, "version": 2},
    )
    assert activated["result"]["active_version"] == 2


def test_roadmaps_spawn_kanban_and_links_rpc_round_trip(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    monkeypatch.setenv("HERMES_KANBAN_DB", str(tmp_path / "kanban.db"))
    server._methods["plans.create"](
        "0",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "actor": "agent-a", "version": 2,
            "nodes": [
                {"node_id": "obj", "kind": "objective", "title": "Objective",
                 "description": "Outcome and success criteria"},
                {"node_id": "ms-1", "kind": "milestone", "title": "Milestone 1",
                 "parent_node_id": "obj"},
                {"node_id": "ph-1", "kind": "phase", "title": "Phase 1",
                 "parent_node_id": "ms-1"},
            ],
            "relations": [],
            "todos": [
                {"todo_id": "t1", "node_id": "ph-1", "title": "Do it",
                 "acceptance": "Visible outcome"},
            ],
        },
    )
    spawned = server._methods["roadmaps.spawn_kanban"](
        "1",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r",
         "actor": "pierre", "version": 2, "node_id": "ms-1", "board_slug": "default"},
    )
    assert spawned["result"]["success"] is True
    assert spawned["result"]["spawned"] == 1
    task_id = spawned["result"]["links"][0]["task_id"]

    links = server._methods["roadmaps.kanban_links"](
        "2",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r", "version": 2},
    )
    assert len(links["result"]["links"]) == 1
    link = links["result"]["links"][0]
    assert link["todo_id"] == "t1"
    assert link["task_id"] == task_id
    assert link["card"]["found"] is True


def test_plans_check_rpc_returns_battery(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    server._methods["plans.create"](
        "0",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "actor": "agent-a", "version": 2,
            "nodes": [
                {"node_id": "obj", "kind": "objective", "title": "Objective",
                 "description": "Outcome and success criteria"},
                {"node_id": "ms-1", "kind": "milestone", "title": "Milestone 1",
                 "parent_node_id": "obj"},
                {"node_id": "ph-1", "kind": "phase", "title": "Phase 1",
                 "parent_node_id": "ms-1"},
            ],
            "relations": [],
            "todos": [
                {"todo_id": "t1", "node_id": "ph-1", "title": "Do it",
                 "acceptance": "Visible outcome"},
            ],
        },
    )
    response = server._methods["plans.check"](
        "1",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r", "version": 2},
    )
    assert response["result"]["ok"] is True
    assert response["result"]["failures"] == []


def test_team_set_check_list_rpc_round_trip(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    server._methods["plans.create"](
        "0",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "actor": "agent-a", "version": 2,
            "nodes": [
                {"node_id": "obj", "kind": "objective", "title": "Objective",
                 "description": "Outcome and success criteria"},
                {"node_id": "ms-1", "kind": "milestone", "title": "Milestone 1",
                 "parent_node_id": "obj"},
                {"node_id": "ph-1", "kind": "phase", "title": "Phase 1",
                 "parent_node_id": "ms-1"},
            ],
            "relations": [],
            "todos": [
                {"todo_id": "t1", "node_id": "ph-1", "title": "Do it",
                 "acceptance": "Visible outcome"},
            ],
        },
    )
    set_result = server._methods["team.set"](
        "1",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "actor": "pierre", "version": 2,
            "workers": [
                {"worker_id": "w1", "lane": "backend", "model": "gpt-5.6",
                 "provider": "codex", "thinking_level": "high",
                 "toolsets": ["terminal"], "skills": ["roadmaps"]},
            ],
            "assignments": [{"todo_id": "t1", "worker_id": "w1"}],
        },
    )
    assert set_result["result"]["workers"] == 1
    assert set_result["result"]["assigned"] == 1

    check = server._methods["team.check"](
        "2",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r", "version": 2},
    )
    assert check["result"] == {"ok": True, "failures": []}

    listing = server._methods["team.list"](
        "3",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r", "version": 2},
    )
    assert [w["worker_id"] for w in listing["result"]["workers"]] == ["w1"]
    assert listing["result"]["assignments"] == [{"todo_id": "t1", "worker_id": "w1"}]


def test_readiness_set_check_list_rpc_round_trip(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    server._methods["plans.create"](
        "0",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "actor": "agent-a", "version": 2,
            "nodes": [
                {"node_id": "obj", "kind": "objective", "title": "Objective",
                 "description": "Outcome and success criteria"},
                {"node_id": "ms-1", "kind": "milestone", "title": "Milestone 1",
                 "parent_node_id": "obj"},
                {"node_id": "ph-1", "kind": "phase", "title": "Phase 1",
                 "parent_node_id": "ms-1"},
            ],
            "relations": [],
            "todos": [
                {"todo_id": "t1", "node_id": "ph-1", "title": "Do it",
                 "acceptance": "Visible outcome"},
            ],
        },
    )
    set_result = server._methods["readiness.set"](
        "1",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "actor": "pierre", "version": 2,
            "items": [
                {"item_id": "blk-1", "kind": "blocker", "title": "Rate limit",
                 "detail": "Pre-provision", "status": "resolved"},
                {"item_id": "secret-1", "kind": "authorization", "subtype": "secret",
                 "title": "GitHub token", "status": "verified"},
            ],
        },
    )
    assert set_result["result"]["items"] == 2

    check = server._methods["readiness.check"](
        "2",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r", "version": 2},
    )
    assert check["result"] == {"ok": True, "failures": []}

    listing = server._methods["readiness.list"](
        "3",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r", "version": 2},
    )
    assert {i["item_id"] for i in listing["result"]["items"]} == {"blk-1", "secret-1"}


def test_board_rpc_round_trip(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    server._methods["plans.create"](
        "0",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r",
            "actor": "agent-a", "version": 2,
            "nodes": [
                {"node_id": "obj", "kind": "objective", "title": "Objective",
                 "description": "Outcome and success criteria"},
                {"node_id": "ms-1", "kind": "milestone", "title": "Milestone 1",
                 "parent_node_id": "obj"},
                {"node_id": "ph-1", "kind": "phase", "title": "Phase 1",
                 "parent_node_id": "ms-1"},
            ],
            "relations": [],
            "todos": [
                {"todo_id": "t1", "node_id": "ph-1", "title": "Do it",
                 "acceptance": "Visible outcome"},
            ],
        },
    )
    board = server._methods["roadmaps.board"](
        "1",
        {"profile": "profile", "project_id": "p", "roadmap_id": "r", "version": 2},
    )
    assert board["result"]["found"] is True
    assert [m["milestone"]["node_id"] for m in board["result"]["milestones"]] == ["ms-1"]
    todo = board["result"]["milestones"][0]["phases"][0]["todos"][0]
    assert todo["todo"]["todo_id"] == "t1"


def test_plans_list_rpc_round_trip_and_unknown_roadmap(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    listing = server._methods["plans.list"](
        "1", {"profile": "profile", "project_id": "p", "roadmap_id": "r"}
    )
    assert [p["version"] for p in listing["result"]["plans"]] == [1]
    missing = server._methods["plans.list"](
        "2", {"profile": "profile", "project_id": "p", "roadmap_id": "r-missing"}
    )
    assert missing["result"]["plans"] == []


def test_plans_create_rpc_unknown_roadmap_5065(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["plans.create"](
        "1",
        {
            "profile": "profile", "project_id": "p", "roadmap_id": "r-missing",
            "actor": "agent-a",
            "nodes": [{"node_id": "obj", "kind": "objective", "title": "Objective"}],
            "relations": [], "todos": [],
        },
    )
    assert response["error"]["code"] == 5065


def test_plans_rpc_unexpected_error_maps_to_5061_generic(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    original = roadmaps_writer.RoadmapsWriter.create_plan
    roadmaps_writer.RoadmapsWriter.create_plan = lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("backend exploded")
    )
    try:
        response = server._methods["plans.create"](
            "1",
            {
                "profile": "profile", "project_id": "p", "roadmap_id": "r",
                "actor": "agent-a",
                "nodes": [{"node_id": "obj", "kind": "objective", "title": "Objective"}],
                "relations": [], "todos": [],
            },
        )
    finally:
        roadmaps_writer.RoadmapsWriter.create_plan = original
    assert response["error"]["code"] == 5061
    assert response["error"]["message"] == "roadmaps unavailable"
    assert "exploded" not in response["error"]["message"]


# ── roadmaps.planning_rules (T5c: versioned Vision planning rules) ──────────


def test_planning_rules_rpc_handler_is_registered(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    assert "roadmaps.planning_rules" in server._methods


def test_planning_rules_rpc_runs_off_the_ws_reader_thread():
    assert "roadmaps.planning_rules" in server._LONG_HANDLERS


def test_planning_rules_rpc_returns_version_and_rules_no_scope(tmp_path, monkeypatch):
    # Global rules: no profile/project/roadmap scope required at all.
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.planning_rules"]("1", {})
    assert response["result"]["version"] == "1.2"
    rules = response["result"]["rules"]
    assert isinstance(rules["prompt"], str)
    assert "json" in rules["prompt"].lower()
    # No secrets and no DB content leak through the payload.
    serialized = json.dumps(response["result"])
    assert "BEGIN" not in serialized
    assert "private" not in serialized.lower()


def test_planning_rules_rpc_explicit_version(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.planning_rules"](
        "1", {"version": "1.0"}
    )
    assert response["result"]["version"] == "1.0"


def test_planning_rules_rpc_unknown_version_returns_5063_clean_message(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.planning_rules"](
        "1", {"version": "99.9"}
    )
    assert response["error"]["code"] == 5063
    assert "99.9" in response["error"]["message"]
    assert "Traceback" not in response["error"]["message"]


def test_planning_rules_rpc_bad_params_returns_5063(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.planning_rules"]("1", {"version": 1.0})
    assert response["error"]["code"] == 5063
    response = server._methods["roadmaps.planning_rules"]("1", None)
    assert response["error"]["code"] == 5063


def test_planning_rules_rpc_unexpected_error_maps_to_5061_generic(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    from hermes_cli import roadmaps_planning_rules as rules_mod

    original = rules_mod.get_planning_rules
    rules_mod.get_planning_rules = lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("secret backend detail")
    )
    try:
        response = server._methods["roadmaps.planning_rules"]("1", {})
    finally:
        rules_mod.get_planning_rules = original
    assert response["error"]["code"] == 5061
    assert response["error"]["message"] == "roadmaps unavailable"
    assert "secret backend detail" not in response["error"]["message"]
