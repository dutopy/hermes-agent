"""Roadmaps — Batterie Plan (structural + dependency gates, read-only).

Spec ``docs/roadmaps-plan-team-execute-20260816.md`` §4.1. Each check returns a
structured failure with a stable, actionable code (the auto-resolve loop keys on
the code). No mutation, no state transition here — ``validate_plan`` runs this
and refuses to validate while ``ok`` is False.

Failure codes (stable, English):
  plan.missing_objective      — no root objective node
  plan.objective_no_outcome   — objective missing title/description (outcome + criteria)
  plan.milestone_no_phase     — a milestone has no child phase
  plan.phase_no_todo          — a phase has no todo
  plan.todo_no_title          — a todo has an empty title
  plan.todo_no_acceptance     — a todo has no acceptance criteria
  plan.orphan_node            — a non-objective node has no valid parent
  plan.broken_relation        — a relation references a missing node
  plan.relation_cycle         — the relation graph has a cycle
"""

from __future__ import annotations

from typing import Any


def _cycle(edges: dict[str, list[str]]) -> bool:
    """DFS three-color cycle detection over the relation graph."""
    color: dict[str, int] = {}

    def dfs(node: str) -> bool:
        color[node] = 1
        for nxt in edges.get(node, ()):
            if color.get(nxt) == 1:
                return True
            if color.get(nxt) is None and dfs(nxt):
                return True
        color[node] = 2
        return False

    for node in edges:
        if color.get(node) is None and dfs(node):
            return True
    return False


def check_plan_battery(
    conn,
    profile_id: str,
    project_id: str,
    roadmap_id: str,
    version: int,
) -> dict[str, Any]:
    """Evaluate the Batterie Plan for one version. Returns ``{ok, failures}``.

    ``conn`` is a sqlite3 connection with ``Row`` row factory (as used by
    ``RoadmapsWriter`` / ``RoadmapsService``). Read-only.
    """
    scope = (profile_id, project_id, roadmap_id, version)

    nodes = conn.execute(
        "SELECT node_id, parent_node_id, kind, title, description FROM roadmap_nodes "
        "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
        scope,
    ).fetchall()
    todos = conn.execute(
        "SELECT todo_id, node_id, title, acceptance FROM roadmap_todos "
        "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
        scope,
    ).fetchall()
    relations = conn.execute(
        "SELECT from_node_id, to_node_id FROM roadmap_relations "
        "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
        scope,
    ).fetchall()

    failures: list[dict[str, Any]] = []
    by_id = {n["node_id"]: n for n in nodes}
    children: dict[str, list[Any]] = {}
    for n in nodes:
        if n["parent_node_id"]:
            children.setdefault(n["parent_node_id"], []).append(n)

    objectives = [n for n in nodes if n["kind"] == "objective"]
    milestones = [n for n in nodes if n["kind"] == "milestone"]
    phases = [n for n in nodes if n["kind"] == "phase"]

    # 1. objective + outcome/criteria (title + description both non-empty).
    if not objectives:
        failures.append({
            "code": "plan.missing_objective",
            "hint": "The plan has no objective (root).",
        })
    else:
        obj = objectives[0]
        if not (obj["title"] or "").strip() or not (obj["description"] or "").strip():
            failures.append({
                "code": "plan.objective_no_outcome",
                "node_id": obj["node_id"],
                "hint": "The objective must define an outcome and success criteria.",
            })

    # 2. every milestone has >= 1 phase child.
    for m in milestones:
        if not any(c["kind"] == "phase" for c in children.get(m["node_id"], ())):
            failures.append({
                "code": "plan.milestone_no_phase",
                "node_id": m["node_id"],
                "hint": f"Milestone {m['node_id']!r} has no phase.",
            })

    # 3. every phase has >= 1 todo.
    todos_by_node: dict[str, list[Any]] = {}
    for t in todos:
        todos_by_node.setdefault(t["node_id"], []).append(t)
    for p in phases:
        if not todos_by_node.get(p["node_id"]):
            failures.append({
                "code": "plan.phase_no_todo",
                "node_id": p["node_id"],
                "hint": f"Phase {p['node_id']!r} has no todo.",
            })

    # 4. every todo has a non-empty title AND acceptance criteria.
    for t in todos:
        if not (t["title"] or "").strip():
            failures.append({
                "code": "plan.todo_no_title",
                "todo_id": t["todo_id"],
                "hint": f"Todo {t['todo_id']!r} has an empty title.",
            })
        if not (t["acceptance"] or "").strip():
            failures.append({
                "code": "plan.todo_no_acceptance",
                "todo_id": t["todo_id"],
                "hint": f"Todo {t['todo_id']!r} has no acceptance criteria.",
            })

    # 5. no orphan: every non-objective node has a parent in the version.
    for n in nodes:
        if n["kind"] == "objective":
            continue
        if not n["parent_node_id"] or n["parent_node_id"] not in by_id:
            failures.append({
                "code": "plan.orphan_node",
                "node_id": n["node_id"],
                "hint": f"Node {n['node_id']!r} has no valid parent.",
            })

    # 6. relations: no missing endpoint, no cycle.
    node_ids = set(by_id)
    edges: dict[str, list[str]] = {}
    for r in relations:
        if r["from_node_id"] not in node_ids or r["to_node_id"] not in node_ids:
            failures.append({
                "code": "plan.broken_relation",
                "hint": (
                    f"Relation {r['from_node_id']!r} -> {r['to_node_id']!r} "
                    "references a missing node."
                ),
            })
        else:
            edges.setdefault(r["from_node_id"], []).append(r["to_node_id"])
    if _cycle(edges):
        failures.append({
            "code": "plan.relation_cycle",
            "hint": "The relation graph has a cycle.",
        })

    return {"ok": not failures, "failures": failures}
