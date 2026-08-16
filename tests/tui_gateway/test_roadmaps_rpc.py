from __future__ import annotations

from pathlib import Path

import pytest

from hermes_cli import projects_db
from tui_gateway import server


def test_roadmaps_rpc_handlers_are_registered_and_read_only(monkeypatch, tmp_path: Path):
    path = tmp_path / "projects.db"
    conn = projects_db.connect(path)
    conn.execute("INSERT INTO projects(id, slug, name, created_at) VALUES ('p', 'p', 'P', 1)")
    conn.execute("INSERT INTO roadmaps VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ('profile', 'p', 'r', 'R', None, 'draft', None, 'a', 'a', 1, 1))
    conn.commit(); conn.close()
    monkeypatch.setattr(projects_db, "projects_db_path", lambda: path)
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    monkeypatch.setattr(server, "_current_profile_name", lambda: "profile")
    assert {"roadmaps.list", "roadmaps.get", "roadmaps.snapshot"}.issubset(server._methods)
    listing = server._methods["roadmaps.list"]("1", {"profile": "profile", "project_id": "p"})
    assert listing["result"]["roadmaps"][0]["roadmap_id"] == "r"
    missing = server._methods["roadmaps.get"]("2", {"profile": "profile", "project_id": "missing", "roadmap_id": "r"})
    assert missing["result"]["found"] is False
    assert "roadmaps.events" not in server._methods


def test_roadmaps_rpc_requires_explicit_scope():
    response = server._methods["roadmaps.get"]("3", {"profile": "unknown", "project_id": "p", "roadmap_id": "r"})
    assert response["error"]["code"] == 5063


def test_roadmaps_rpc_rejects_missing_profile():
    response = server._methods["roadmaps.get"]("4", {"project_id": "p", "roadmap_id": "r"})
    assert response["error"]["code"] == 5063
    assert response["error"]["message"] == "profile_id required"


@pytest.mark.parametrize('field', ['profile', 'project_id', 'roadmap_id'])
def test_roadmaps_rpc_rejects_overlong_identifiers(field):
    params = {'profile': 'profile', 'project_id': 'p', 'roadmap_id': 'r'}
    params[field] = 'x' * 129
    response = server._methods["roadmaps.get"]("5", params)
    assert response["error"]["code"] == 5063
