"""Roadmaps readiness + Batterie Readiness (spec docs/roadmaps-plan-team-execute-20260816.md §4.3).

``set_readiness`` persists blockers + authorizations; ``check_readiness_battery``
gates the Readiness step: blockers anticipated and resolved with a plan, and
every authorization (secrets included) provided and verified before execution.
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


def _items() -> list[dict]:
    return [
        {"item_id": "blk-1", "kind": "blocker", "title": "API rate limit",
         "detail": "Pre-provision a higher tier", "status": "resolved"},
        {"item_id": "auth-1", "kind": "authorization", "title": "Deploy access",
         "status": "verified"},
        {"item_id": "secret-1", "kind": "authorization", "subtype": "secret",
         "title": "GitHub token", "status": "verified"},
    ]


def test_set_readiness_and_list(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    writer = RoadmapsWriter(db)
    result = writer.set_readiness("prof", "p1", roadmap_id, version, "pierre", items=_items())
    assert result["items"] == 3

    listing = RoadmapsService(db).list_readiness("prof", "p1", roadmap_id, version)
    assert {i["item_id"] for i in listing["items"]} == {"blk-1", "auth-1", "secret-1"}
    by_id = {i["item_id"]: i for i in listing["items"]}
    assert by_id["secret-1"]["subtype"] == "secret"
    assert by_id["blk-1"]["detail"] == "Pre-provision a higher tier"


def test_readiness_battery_green_when_complete(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    writer = RoadmapsWriter(db)
    writer.set_readiness("prof", "p1", roadmap_id, version, "pierre", items=_items())
    result = RoadmapsService(db).check_readiness_battery("prof", "p1", roadmap_id, version)
    assert result == {"ok": True, "failures": []}


def test_readiness_battery_flags_unresolved_blocker(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    writer = RoadmapsWriter(db)
    writer.set_readiness("prof", "p1", roadmap_id, version, "pierre", items=[
        {"item_id": "blk-1", "kind": "blocker", "title": "API rate limit",
         "detail": "", "status": "open"},
    ])
    result = RoadmapsService(db).check_readiness_battery("prof", "p1", roadmap_id, version)
    codes = {f["code"] for f in result["failures"]}
    assert "readiness.blocker_no_resolution" in codes
    assert "readiness.blocker_unresolved" in codes


def test_readiness_battery_flags_unverified_secret(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    writer = RoadmapsWriter(db)
    writer.set_readiness("prof", "p1", roadmap_id, version, "pierre", items=[
        {"item_id": "secret-1", "kind": "authorization", "subtype": "secret",
         "title": "GitHub token", "status": "listed"},
        {"item_id": "auth-1", "kind": "authorization", "title": "Deploy access",
         "status": "provided"},
    ])
    result = RoadmapsService(db).check_readiness_battery("prof", "p1", roadmap_id, version)
    codes = {f["code"] for f in result["failures"]}
    assert "readiness.secret_not_verified" in codes
    assert "readiness.authorization_not_verified" in codes


def test_set_readiness_replaces_previous_items(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    writer = RoadmapsWriter(db)
    writer.set_readiness("prof", "p1", roadmap_id, version, "pierre", items=_items())
    result = writer.set_readiness("prof", "p1", roadmap_id, version, "pierre")
    assert result["items"] == 0
    listing = RoadmapsService(db).list_readiness("prof", "p1", roadmap_id, version)
    assert listing["items"] == []


def test_set_readiness_rejects_duplicate_item_id(db: Path) -> None:
    roadmap_id, version = _roadmap(db)
    writer = RoadmapsWriter(db)
    with pytest.raises(ValueError, match="duplicate item_id"):
        writer.set_readiness("prof", "p1", roadmap_id, version, "pierre", items=[
            {"item_id": "x", "kind": "blocker", "title": "A", "status": "open"},
            {"item_id": "x", "kind": "blocker", "title": "B", "status": "open"},
        ])
