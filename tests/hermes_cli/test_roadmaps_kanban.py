"""Roadmaps → Kanban durable link (spec docs/roadmaps-plan-team-execute-20260816.md §6).

``spawn_kanban_cards`` creates one kanban card per todo under a milestone and
records the durable link; ``list_kanban_links`` reads links + live card state.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from hermes_cli import kanban_db, projects_db
from hermes_cli.roadmaps_service import RoadmapsService
from hermes_cli.roadmaps_writer import RoadmapNodeNotFoundError, RoadmapsWriter


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
def db(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "projects.db"
    conn = projects_db.connect(path)
    conn.execute("INSERT INTO projects(id, slug, name, created_at) VALUES ('p1','p1','p1',1)")
    conn.commit()
    conn.close()
    # Pin the kanban DB to a temp path so the spawn never touches the real board.
    monkeypatch.setenv("HERMES_KANBAN_DB", str(tmp_path / "kanban.db"))
    return path


def _spawned_roadmap(db: Path) -> tuple[str, int]:
    writer = RoadmapsWriter(db)
    roadmap_id = writer.create_roadmap("prof", "p1", "Roadmap", "pierre")["roadmap_id"]
    version = writer.create_plan("prof", "p1", roadmap_id, "agent", **_complete_plan())["version"]
    return roadmap_id, version


def test_spawn_kanban_cards_creates_cards_and_links(db: Path) -> None:
    roadmap_id, version = _spawned_roadmap(db)
    writer = RoadmapsWriter(db)
    result = writer.spawn_kanban_cards(
        "prof", "p1", roadmap_id, version, "ms-1", "pierre", board_slug="default"
    )
    assert result["success"] is True
    assert result["spawned"] == 2
    assert result["board_slug"] == "default"
    assert {l["todo_id"] for l in result["links"]} == {"t1", "t2"}

    # The kanban cards exist with the todo title + acceptance as the body.
    kconn = kanban_db.connect(board="default")
    try:
        titles = set()
        bodies = set()
        for link in result["links"]:
            task = kanban_db.get_task(kconn, link["task_id"])
            assert task is not None
            assert task.id == link["task_id"]
            titles.add(task.title)
            bodies.add(task.body)
    finally:
        kconn.close()
    assert titles == {"Do it", "Also do this"}
    assert bodies == {"Visible outcome", "Verified"}

    # The read side resolves the live card state for each link.
    listing = RoadmapsService(db).list_kanban_links("prof", "p1", roadmap_id, version)
    assert {l["todo_id"] for l in listing["links"]} == {"t1", "t2"}
    for link in listing["links"]:
        assert link["board_slug"] == "default"
        assert link["card"]["found"] is True
        assert link["card"]["status"]


def test_spawn_kanban_cards_is_idempotent(db: Path) -> None:
    roadmap_id, version = _spawned_roadmap(db)
    writer = RoadmapsWriter(db)
    first = writer.spawn_kanban_cards(
        "prof", "p1", roadmap_id, version, "ms-1", "pierre", board_slug="default"
    )
    assert first["spawned"] == 2
    second = writer.spawn_kanban_cards(
        "prof", "p1", roadmap_id, version, "ms-1", "pierre", board_slug="default"
    )
    assert second["spawned"] == 0
    assert second["links"] == []
    # Still exactly two cards, no duplicates.
    kconn = kanban_db.connect(board="default")
    try:
        tasks = kanban_db.list_tasks(kconn)
    finally:
        kconn.close()
    assert len(tasks) == 2


def test_spawn_kanban_cards_unknown_milestone_raises(db: Path) -> None:
    roadmap_id, version = _spawned_roadmap(db)
    writer = RoadmapsWriter(db)
    with pytest.raises(RoadmapNodeNotFoundError):
        writer.spawn_kanban_cards(
            "prof", "p1", roadmap_id, version, "nope", "pierre", board_slug="default"
        )


def test_list_kanban_links_empty_when_no_links(db: Path) -> None:
    roadmap_id, version = _spawned_roadmap(db)
    result = RoadmapsService(db).list_kanban_links("prof", "p1", roadmap_id, version)
    assert result["links"] == []
    assert result["scope"]["roadmap_id"] == roadmap_id
