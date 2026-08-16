"""Roadmaps board projection (spec docs/roadmaps-plan-team-execute-20260816.md §7).

``RoadmapsService.board`` assembles objective → milestones → phases → todos,
each todo enriched with its owner worker and the live state of its linked
kanban card. The board is a pure projection — the Kanban stays the executor.
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
        ],
    }


@pytest.fixture()
def db(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "projects.db"
    conn = projects_db.connect(path)
    conn.execute("INSERT INTO projects(id, slug, name, created_at) VALUES ('p1','p1','p1',1)")
    conn.commit()
    conn.close()
    # Pin the kanban DB to a temp path so the spawn never touches the real board.
    monkeypatch.setenv("HERMES_KANBAN_DB", str(tmp_path / "kanban.db"))
    return path


def _roadmap(db: Path) -> tuple[str, int]:
    writer = RoadmapsWriter(db)
    roadmap_id = writer.create_roadmap("prof", "p1", "Roadmap", "pierre")["roadmap_id"]
    version = writer.create_plan("prof", "p1", roadmap_id, "agent", **_complete_plan())["version"]
    return roadmap_id, version


def test_board_projection_shape(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    board = RoadmapsService(db).board("prof", "p1", roadmap_id, version)
    assert board["found"] is True
    assert board["version"] == version
    assert board["objective"]["node_id"] == "obj"
    assert [m["milestone"]["node_id"] for m in board["milestones"]] == ["ms-1"]
    phases = board["milestones"][0]["phases"]
    assert [p["phase"]["node_id"] for p in phases] == ["ph-1"]
    todos = phases[0]["todos"]
    assert [t["todo"]["todo_id"] for t in todos] == ["t1"]
    assert todos[0]["todo"]["acceptance"] == "Visible outcome"
    # No team / no kanban yet: worker and card are absent.
    assert todos[0]["worker"] is None
    assert todos[0]["card"] is None


def test_board_resolves_worker_and_live_card(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    writer = RoadmapsWriter(db)
    writer.set_team(
        "prof", "p1", roadmap_id, version, "pierre",
        workers=[{"worker_id": "w1", "lane": "backend", "model": "gpt-5.6",
                  "provider": "codex", "thinking_level": "high",
                  "toolsets": ["terminal"], "skills": ["roadmaps"]}],
        assignments=[{"todo_id": "t1", "worker_id": "w1"}],
    )
    writer.spawn_kanban_cards(
        "prof", "p1", roadmap_id, version, "ms-1", "pierre", board_slug="default"
    )

    board = RoadmapsService(db).board("prof", "p1", roadmap_id, version)
    todo = board["milestones"][0]["phases"][0]["todos"][0]
    assert todo["worker"]["worker_id"] == "w1"
    assert todo["worker"]["toolsets"] == ["terminal"]
    assert todo["card"]["found"] is True
    assert todo["card"]["status"]


def test_board_defaults_to_active_version_when_unset(db: Path) -> None:
    roadmap_id, _version = _roadmap(db)
    # No active version set yet → board resolves to None, empty milestones.
    board = RoadmapsService(db).board("prof", "p1", roadmap_id)
    assert board["found"] is True
    assert board["version"] is None
    assert board["milestones"] == []


def test_board_unknown_roadmap_not_found(db: Path) -> None:
    board = RoadmapsService(db).board("prof", "p1", "r-missing")
    assert board["found"] is False
    assert board["milestones"] == []
