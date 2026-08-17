"""Security regression tests for the Roadmaps RPC surface (review B1/1/2/3)."""

from __future__ import annotations

from pathlib import Path

import pytest

from hermes_cli import projects_db
from hermes_cli.roadmaps_writer import RoadmapsWriter
from tui_gateway import server


def seed(path: Path) -> None:
    conn = projects_db.connect(path)
    conn.execute("INSERT INTO projects(id, slug, name, created_at) VALUES ('p', 'p', 'P', 1)")
    conn.execute(
        "INSERT INTO roadmaps VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("default", "p", "r", "Roadmap", None, "in_progress", 1, "a", "a", 1, 1),
    )
    conn.execute(
        "INSERT INTO roadmap_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("default", "p", "r", 1, "validated", None, "src", None, "a", 1, None),
    )
    conn.execute(
        "INSERT INTO roadmap_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("default", "p", "r", 1, "n-running", None, "step", "Running", None, "in_progress", 10, "agent", None, 1, 1),
    )
    conn.commit()
    conn.close()


def _prepare(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "projects.db"
    seed(path)
    monkeypatch.setattr(projects_db, "projects_db_path", lambda: path)
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    monkeypatch.setattr(server, "_current_profile_name", lambda: "default")
    return path


@pytest.mark.parametrize(
    "evil",
    ["../skills", "..", "../..", "a/b", "a\\b", "CAPS", "sp ace"],
)
def test_b1_profile_traversal_is_rejected_before_any_path_resolution(tmp_path, monkeypatch, evil):
    """B1: a malformed profile name must fail with 5063 and never touch disk."""
    path = _prepare(tmp_path, monkeypatch)
    before = path.read_bytes()

    response = server._methods["roadmaps.claim_node"](
        "1",
        {
            "profile": evil,
            "project_id": "p",
            "roadmap_id": "r",
            "node_id": "n-running",
            "actor": "agent",
            "expected_version": 1,
        },
    )
    assert response["error"]["code"] == 5063
    assert "invalid profile scope" in response["error"]["message"]
    # No projects.db was seeded anywhere new under the fake home.
    assert list(tmp_path.rglob("projects.db")) == [path]
    assert path.read_bytes() == before


def test_reason_is_capped_and_control_chars_rejected(tmp_path: Path):
    path = tmp_path / "projects.db"
    seed(path)
    writer = RoadmapsWriter(path)
    with pytest.raises(ValueError, match="at most 2000"):
        writer.block_node("default", "p", "r", "n-running", "user", "x" * 2001, 1)
    with pytest.raises(ValueError, match="control characters"):
        writer.block_node("default", "p", "r", "n-running", "user", "bad\x00reason", 1)


def test_missing_node_id_returns_5063_not_5061(tmp_path, monkeypatch):
    _prepare(tmp_path, monkeypatch)
    response = server._methods["roadmaps.claim_node"](
        "1",
        {
            "profile": "default",
            "project_id": "p",
            "roadmap_id": "r",
            "actor": "agent",
            "expected_version": 1,
        },
    )
    assert response["error"]["code"] == 5063
    assert response["error"]["message"] == "node_id required"
