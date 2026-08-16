"""Roadmaps — Batterie Team (lane-worker completeness gates, read-only).

Spec ``docs/roadmaps-plan-team-execute-20260816.md`` §4.2. Each check returns a
structured failure with a stable, actionable code (the auto-resolve loop keys on
the code). No mutation here — the Team step closes only when ``ok`` is True.

Failure codes (stable, English):
  team.todo_no_owner       — a todo has no owner worker
  team.owner_unknown       — a todo's owner references an unknown worker
  team.worker_no_model     — a worker has no explicit model/provider
  team.worker_no_thinking  — a worker has no thinking level
  team.worker_no_toolsets  — a worker has no toolsets
  team.worker_no_skills    — a worker has no skills
"""

from __future__ import annotations

import json
from typing import Any


def _parse_list(text: Any) -> list[Any]:
    """Parse a stored JSON array of names; ``[]`` on null/empty/unparseable."""
    if not text:
        return []
    try:
        value = json.loads(text)
    except (ValueError, TypeError):
        return []
    if not isinstance(value, list):
        return []
    return value


def check_team_battery(
    conn,
    profile_id: str,
    project_id: str,
    roadmap_id: str,
    version: int,
) -> dict[str, Any]:
    """Evaluate the Batterie Team for one version. Returns ``{ok, failures}``.

    ``conn`` is a sqlite3 connection with ``Row`` row factory (as used by
    ``RoadmapsWriter`` / ``RoadmapsService``). Read-only.
    """
    scope = (profile_id, project_id, roadmap_id, version)

    todos = conn.execute(
        "SELECT todo_id, owner_worker FROM roadmap_todos "
        "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
        scope,
    ).fetchall()
    workers = conn.execute(
        "SELECT worker_id, model, provider, thinking_level, toolsets, skills "
        "FROM roadmap_team_workers "
        "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
        scope,
    ).fetchall()

    failures: list[dict[str, Any]] = []
    worker_ids = {w["worker_id"] for w in workers}

    # 1+2. every todo has a valid owner (coverage: no work item left unassigned).
    for t in todos:
        if not (t["owner_worker"] or "").strip():
            failures.append({
                "code": "team.todo_no_owner",
                "todo_id": t["todo_id"],
                "hint": f"Todo {t['todo_id']!r} has no owner worker.",
            })
        elif t["owner_worker"] not in worker_ids:
            failures.append({
                "code": "team.owner_unknown",
                "todo_id": t["todo_id"],
                "hint": (
                    f"Todo {t['todo_id']!r} owner {t['owner_worker']!r} "
                    "is not a worker of this version."
                ),
            })

    # 3-6. every worker is fully sculpted (model/provider, thinking, toolsets, skills).
    for w in workers:
        if not (w["model"] or "").strip() or not (w["provider"] or "").strip():
            failures.append({
                "code": "team.worker_no_model",
                "worker_id": w["worker_id"],
                "hint": f"Worker {w['worker_id']!r} has no explicit model/provider.",
            })
        if not (w["thinking_level"] or "").strip():
            failures.append({
                "code": "team.worker_no_thinking",
                "worker_id": w["worker_id"],
                "hint": f"Worker {w['worker_id']!r} has no thinking level.",
            })
        if not _parse_list(w["toolsets"]):
            failures.append({
                "code": "team.worker_no_toolsets",
                "worker_id": w["worker_id"],
                "hint": f"Worker {w['worker_id']!r} has no toolsets.",
            })
        if not _parse_list(w["skills"]):
            failures.append({
                "code": "team.worker_no_skills",
                "worker_id": w["worker_id"],
                "hint": f"Worker {w['worker_id']!r} has no skills.",
            })

    return {"ok": not failures, "failures": failures}
