"""Batterie Plan (roadmaps_battery) — structural + dependency gates.

The battery checks the NEW hierarchy (objective → milestone → phase → todo);
it is a read-only complement to create_plan's payload validation. The relation
cycle/orphan/broken-reference checks are defence-in-depth here because
create_plan already rejects those payloads before insert.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from hermes_cli import projects_db
from hermes_cli.roadmaps_service import RoadmapsService
from hermes_cli.roadmaps_writer import RoadmapsWriter


def _payload(version: int = 2, *, nodes=None, todos=None) -> dict:
    return {
        "version": version,
        "nodes": nodes if nodes is not None else [
            {"node_id": "obj", "kind": "objective", "title": "Outcome", "description": "Success criteria"},
            {"node_id": "m1", "kind": "milestone", "title": "Milestone 1", "parent_node_id": "obj"},
            {"node_id": "ph1", "kind": "phase", "title": "Phase 1", "parent_node_id": "m1"},
        ],
        "relations": [],
        "todos": todos if todos is not None else [
            {"todo_id": "t1", "node_id": "ph1", "title": "Do it", "acceptance": "Visible outcome"},
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


def _write(db: Path, payload: dict) -> tuple[str, int]:
    writer = RoadmapsWriter(db)
    roadmap_id = writer.create_roadmap("prof", "p1", "Roadmap", "pierre")["roadmap_id"]
    version = writer.create_plan("prof", "p1", roadmap_id, "agent", **payload)["version"]
    return roadmap_id, version


def test_full_plan_is_green(db: Path) -> None:
    rid, version = _write(db, _payload())
    result = RoadmapsService(db).check_battery("prof", "p1", rid, version)
    assert result == {"ok": True, "failures": []}


def test_missing_objective(db: Path) -> None:
    rid, version = _write(db, _payload(nodes=[
        {"node_id": "m1", "kind": "milestone", "title": "M", "parent_node_id": None},
    ], todos=[]))
    result = RoadmapsService(db).check_battery("prof", "p1", rid, version)
    assert "plan.missing_objective" in {f["code"] for f in result["failures"]}


def test_milestone_without_phase(db: Path) -> None:
    rid, version = _write(db, _payload(nodes=[
        {"node_id": "obj", "kind": "objective", "title": "Outcome", "description": "Criteria"},
        {"node_id": "m1", "kind": "milestone", "title": "M", "parent_node_id": "obj"},
    ], todos=[]))
    result = RoadmapsService(db).check_battery("prof", "p1", rid, version)
    codes = {f["code"] for f in result["failures"]}
    assert "plan.milestone_no_phase" in codes


def test_phase_without_todo(db: Path) -> None:
    rid, version = _write(db, _payload(nodes=[
        {"node_id": "obj", "kind": "objective", "title": "Outcome", "description": "Criteria"},
        {"node_id": "m1", "kind": "milestone", "title": "M", "parent_node_id": "obj"},
        {"node_id": "ph1", "kind": "phase", "title": "P", "parent_node_id": "m1"},
    ], todos=[]))
    result = RoadmapsService(db).check_battery("prof", "p1", rid, version)
    codes = {f["code"] for f in result["failures"]}
    assert "plan.phase_no_todo" in codes


def test_todo_without_acceptance(db: Path) -> None:
    rid, version = _write(db, _payload(todos=[
        {"todo_id": "t1", "node_id": "ph1", "title": "Do it"},
    ]))
    result = RoadmapsService(db).check_battery("prof", "p1", rid, version)
    codes = {f["code"] for f in result["failures"]}
    assert "plan.todo_no_acceptance" in codes
    assert "plan.todo_no_title" not in codes
