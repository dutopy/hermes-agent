"""Roadmaps team + Batterie Team (spec docs/roadmaps-plan-team-execute-20260816.md §4.2, §5).

``set_team`` persists lane workers + todo→worker ownership; ``check_team_battery``
gates the Team step on every todo having a valid, fully-sculpted owner.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from hermes_cli import projects_db
from hermes_cli.roadmaps_service import RoadmapsService
from hermes_cli.roadmaps_writer import RoadmapsWriter


def _complete_plan(version: int = 2) -> dict:
    return {
        "version": version,
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
            {"todo_id": "t2", "node_id": "ph-1", "title": "Also do this",
             "acceptance": "Verified"},
        ],
    }


@pytest.fixture()
def db(tmp_path: Path) -> Path:
    path = tmp_path / "projects.db"
    conn = projects_db.connect(path)
    conn.execute("INSERT INTO projects(id, slug, name, created_at) VALUES ('p1','p1','p1',1)")
    conn.commit()
    conn.close()
    return path


def _roadmap(db: Path) -> tuple[str, int]:
    writer = RoadmapsWriter(db)
    roadmap_id = writer.create_roadmap("prof", "p1", "Roadmap", "pierre")["roadmap_id"]
    version = writer.create_plan("prof", "p1", roadmap_id, "agent", **_complete_plan())["version"]
    return roadmap_id, version


def _workers() -> list[dict]:
    return [
        {"worker_id": "w1", "lane": "backend", "model": "gpt-5.6", "provider": "codex",
         "thinking_level": "high", "toolsets": ["terminal", "file"], "skills": ["roadmaps"]},
    ]


def test_set_team_and_list(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    writer = RoadmapsWriter(db)
    result = writer.set_team(
        "prof", "p1", roadmap_id, version, "pierre",
        workers=_workers(),
        assignments=[{"todo_id": "t1", "worker_id": "w1"},
                     {"todo_id": "t2", "worker_id": "w1"}],
    )
    assert result["workers"] == 1
    assert result["assigned"] == 2

    listing = RoadmapsService(db).list_team("prof", "p1", roadmap_id, version)
    assert [w["worker_id"] for w in listing["workers"]] == ["w1"]
    assert listing["workers"][0]["model"] == "gpt-5.6"
    assert listing["workers"][0]["toolsets"] == ["terminal", "file"]
    assert listing["workers"][0]["skills"] == ["roadmaps"]
    assert {a["todo_id"] for a in listing["assignments"]} == {"t1", "t2"}


def test_team_battery_green_when_complete(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    writer = RoadmapsWriter(db)
    writer.set_team(
        "prof", "p1", roadmap_id, version, "pierre",
        workers=_workers(),
        assignments=[{"todo_id": "t1", "worker_id": "w1"},
                     {"todo_id": "t2", "worker_id": "w1"}],
    )
    result = RoadmapsService(db).check_team_battery("prof", "p1", roadmap_id, version)
    assert result == {"ok": True, "failures": []}


def test_team_battery_flags_missing_owner(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    # No team set at all: every todo is unowned.
    result = RoadmapsService(db).check_team_battery("prof", "p1", roadmap_id, version)
    codes = {f["code"] for f in result["failures"]}
    assert "team.todo_no_owner" in codes


def test_team_battery_flags_unsculpted_worker(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    writer = RoadmapsWriter(db)
    writer.set_team(
        "prof", "p1", roadmap_id, version, "pierre",
        workers=[{"worker_id": "w1", "lane": "backend"}],
        assignments=[{"todo_id": "t1", "worker_id": "w1"}],
    )
    result = RoadmapsService(db).check_team_battery("prof", "p1", roadmap_id, version)
    codes = {f["code"] for f in result["failures"]}
    assert "team.worker_no_model" in codes
    assert "team.worker_no_thinking" in codes
    assert "team.worker_no_toolsets" in codes
    assert "team.worker_no_skills" in codes
    # t2 is still unowned.
    assert "team.todo_no_owner" in codes


def test_set_team_rejects_unknown_assignment_worker(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    writer = RoadmapsWriter(db)
    with pytest.raises(ValueError, match="not a worker"):
        writer.set_team(
            "prof", "p1", roadmap_id, version, "pierre",
            workers=_workers(),
            assignments=[{"todo_id": "t1", "worker_id": "ghost"}],
        )


def test_set_team_replaces_previous_team(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    writer = RoadmapsWriter(db)
    writer.set_team(
        "prof", "p1", roadmap_id, version, "pierre",
        workers=_workers(),
        assignments=[{"todo_id": "t1", "worker_id": "w1"},
                     {"todo_id": "t2", "worker_id": "w1"}],
    )
    # Replace with an empty team: workers cleared, todos unassigned.
    result = writer.set_team("prof", "p1", roadmap_id, version, "pierre")
    assert result["workers"] == 0
    assert result["assigned"] == 0
    listing = RoadmapsService(db).list_team("prof", "p1", roadmap_id, version)
    assert listing["workers"] == []
    assert listing["assignments"] == []
