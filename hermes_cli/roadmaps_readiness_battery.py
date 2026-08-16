"""Roadmaps — Batterie Readiness (blockers + authorizations gates, read-only).

Spec ``docs/roadmaps-plan-team-execute-20260816.md`` §4.3. Each check returns a
structured failure with a stable, actionable code (the auto-resolve loop keys on
the code). No mutation here — the Readiness step closes only when ``ok`` is
True.

Readiness runs AFTER Team and BEFORE Execute: blockers are anticipated and
resolved with a plan, and every required authorization (secrets included) is
provided and verified before execution starts. A secret that is still missing
from the vault therefore surfaces here, before anything runs.

Failure codes (stable, English):
  readiness.blocker_no_resolution       — a blocker has no resolution plan
  readiness.blocker_unresolved          — a blocker is not resolved
  readiness.authorization_not_verified  — a non-secret authorization is not verified
  readiness.secret_not_verified         — a secret authorization is not provided/verified
"""

from __future__ import annotations

from typing import Any


def check_readiness_battery(
    conn,
    profile_id: str,
    project_id: str,
    roadmap_id: str,
    version: int,
) -> dict[str, Any]:
    """Evaluate the Batterie Readiness for one version. Returns ``{ok, failures}``.

    ``conn`` is a sqlite3 connection with ``Row`` row factory (as used by
    ``RoadmapsWriter`` / ``RoadmapsService``). Read-only.
    """
    scope = (profile_id, project_id, roadmap_id, version)

    items = conn.execute(
        "SELECT item_id, kind, subtype, title, detail, status FROM roadmap_readiness "
        "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
        scope,
    ).fetchall()

    failures: list[dict[str, Any]] = []
    for item in items:
        if item["kind"] == "blocker":
            # Every blocker needs a resolution plan AND must be resolved.
            if not (item["detail"] or "").strip():
                failures.append({
                    "code": "readiness.blocker_no_resolution",
                    "item_id": item["item_id"],
                    "hint": f"Blocker {item['title']!r} has no resolution plan.",
                })
            if (item["status"] or "") != "resolved":
                failures.append({
                    "code": "readiness.blocker_unresolved",
                    "item_id": item["item_id"],
                    "hint": f"Blocker {item['title']!r} is not resolved.",
                })
        else:  # authorization
            if (item["subtype"] or "") == "secret":
                if (item["status"] or "") != "verified":
                    failures.append({
                        "code": "readiness.secret_not_verified",
                        "item_id": item["item_id"],
                        "hint": (
                            f"Secret {item['title']!r} is not provided/verified "
                            "before execution."
                        ),
                    })
            else:
                if (item["status"] or "") != "verified":
                    failures.append({
                        "code": "readiness.authorization_not_verified",
                        "item_id": item["item_id"],
                        "hint": f"Authorization {item['title']!r} is not verified.",
                    })

    return {"ok": not failures, "failures": failures}
