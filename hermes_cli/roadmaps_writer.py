"""Authorized, versioned Roadmaps execution mutations.

This is the write-side counterpart of :mod:`hermes_cli.roadmaps_service`
(which stays strictly read-only).  Every mutation:

- targets the ACTIVE profile's ``projects.db`` resolved by the runtime;
- requires the full qualified scope ``(profile_id, project_id, roadmap_id)``;
- requires an explicit non-empty actor;
- requires the roadmap version the caller observed (``expected_version``),
  and refuses to write when the roadmap has been revised since
  (optimistic concurrency); a roadmap with no active version yet is
  observed as ``expected_version=0``;
- validates the state transition against the pure contract
  (:mod:`src.roadmaps_contract`), so the runtime cannot drift from the
  documented machine;
- runs in a single IMMEDIATE transaction and rolls back on any failure.

Two families of mutations are exposed:

- execution-level node mutations: claim, progress, complete, block,
  unblock, todo;
- roadmap CRUD + plan governance (T5b): ``create_roadmap`` /
  ``update_roadmap`` / ``archive_roadmap`` and ``create_plan`` /
  ``activate_plan`` / ``validate_plan``.

Conventions (T5b, verified against the schema and the existing read side):

- ``roadmaps.create`` creates the roadmap row (``lifecycle_state='draft'``,
  ``active_version=NULL``) plus the initial version 1 marker
  (``roadmap_versions.state='draft'``, empty plan) in ONE transaction.
  The lifecycle machine is strict: only ``'draft'`` is accepted at
  creation, so a later state cannot be forged via create.  The next real
  plan therefore starts at version 2.  A generated ``roadmap_id`` uses
  the ``r_`` prefix (``r_`` + 8 hex chars).
- ``roadmaps.update`` only touches the fields actually provided
  (title <= 200 chars, purpose <= 2000); ``expected_version`` guards
  against clobbering.  ``lifecycle_state`` is NOT writable through
  update — transitions go exclusively through ``plans.validate`` /
  ``plans.activate`` / ``roadmaps.archive``.
- ``roadmaps.archive`` moves ``lifecycle_state`` to the terminal
  ``'archived'`` and keeps the version history readable; archiving an
  already archived roadmap is rejected.
- ``plans.create`` validates the FULL payload (nodes/relations/todos)
  before any insert and commits everything atomically.  The new version
  is ``'proposed'`` (a created plan is proposed, never active); the
  roadmap lifecycle moves ``draft -> proposed``.  Version 1 is reserved
  by ``roadmaps.create``, so a duplicate version is rejected.
- ``plans.validate`` transitions a version ``draft|proposed -> validated``
  (version-state machine, distinct from the roadmap-lifecycle machine in
  the pure contract).  Governance authority is the caller: the toolset
  agent acting under Pierre's authority, or Pierre directly — the backend
  records the actor on ``roadmaps.updated_by`` (``roadmap_versions`` has
  no ``updated_by`` column; it is append-only apart from state).
- ``plans.activate`` requires the version to be ``'validated'``, points
  ``roadmaps.active_version`` at it, marks the previously active version
  ``'superseded'`` (history preserved) and moves the roadmap lifecycle
  ``validated -> in_progress``.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import time
from pathlib import Path
from typing import Any

from hermes_cli import projects_db
from hermes_cli.roadmaps_battery import check_plan_battery
from hermes_cli.sqlite_util import write_txn
from src.roadmaps_contract import transition_node


class RoadmapsWriteError(RuntimeError):
    """Base class for all authorizable write failures."""


class RoadmapNotFoundError(RoadmapsWriteError):
    """The roadmap (or its active version) does not exist."""


class RoadmapProjectNotFoundError(RoadmapsWriteError):
    """The project named in the scope does not exist."""


class RoadmapExistsError(RoadmapsWriteError):
    """A roadmap with this id already exists in the project scope."""


class RoadmapNodeNotFoundError(RoadmapsWriteError):
    """The node does not exist in the active roadmap version."""


class StaleRoadmapVersionError(RoadmapsWriteError):
    """The caller's expected_version no longer matches the active version."""


class RoadmapTodoNotFoundError(RoadmapsWriteError):
    """The todo does not exist in the active roadmap version."""


class RoadmapVersionNotFoundError(RoadmapsWriteError):
    """The roadmap version does not exist."""


class RoadmapVersionExistsError(RoadmapsWriteError):
    """The roadmap version already exists (conflict)."""


class InvalidRoadmapTodoTransitionError(RoadmapsWriteError):
    """The requested todo state transition is not allowed."""


class InvalidRoadmapTransitionError(RoadmapsWriteError):
    """The requested node state transition is not allowed by the contract."""


class InvalidRoadmapPlanTransitionError(RoadmapsWriteError):
    """The requested plan/version state transition is not allowed."""


class PlanBatteryFailedError(RoadmapsWriteError):
    """The plan failed its Batterie Plan gate and cannot be validated yet.

    Carries the structured ``failures`` list (stable codes) so the caller can
    drive the auto-resolve loop instead of a blind retry.
    """

    def __init__(self, failures: list[dict[str, Any]]) -> None:
        self.failures = failures
        codes = ", ".join(failure["code"] for failure in failures)
        super().__init__(f"plan failed the Batterie Plan gate: {codes}")


# Allowed todo state transitions (open → in_progress → done, cancel from open/in_progress).
TODO_TRANSITIONS: dict[str, frozenset[str]] = {
    "open": frozenset({"in_progress", "done", "cancelled"}),
    "in_progress": frozenset({"done", "cancelled", "open"}),
    "done": frozenset(),
    "cancelled": frozenset(),
}

# Schema enumerations (see the CHECK constraints in projects_db.SCHEMA_SQL).
ROADMAP_LIFECYCLE_STATES: frozenset[str] = frozenset(
    {"draft", "proposed", "validated", "in_progress", "blocked", "completed", "archived"}
)
PLAN_VERSION_STATES: frozenset[str] = frozenset(
    {"draft", "proposed", "validated", "superseded", "archived"}
)
NODE_KINDS: frozenset[str] = frozenset(
    {"objective", "milestone", "phase", "decision"}
)
NODE_STATES: frozenset[str] = frozenset(
    {"planned", "ready", "in_progress", "blocked", "completed", "archived"}
)
RELATION_KINDS: frozenset[str] = frozenset(
    {"depends_on", "blocks", "enables", "follows", "validates", "supersedes"}
)
RELATION_STATES: frozenset[str] = frozenset({"active", "superseded", "invalid"})
TODO_STATES: frozenset[str] = frozenset({"open", "in_progress", "done", "cancelled"})

MAX_IDENTIFIER_LENGTH = 128
MAX_TITLE_LENGTH = 200
MAX_PURPOSE_LENGTH = 2000
MAX_DESCRIPTION_LENGTH = 2000
MAX_REASON_LENGTH = 2000
MAX_VERSION = 2**31 - 1
# Plan-payload element bounds (mirror roadmaps_plan_parser's DoS caps so a
# create_plan payload cannot build a pathological graph that exhausts the
# interpreter stack or the transaction).
MAX_PLAN_NODES = 2000
MAX_PLAN_RELATIONS = 2000
MAX_PLAN_TODOS = 2000
# Readiness enums (spec §4.3): blockers are anticipated + resolved, authorizations
# (secrets/accesses/permissions) are provided + verified before execution.
READINESS_KINDS: frozenset[str] = frozenset({"blocker", "authorization"})
READINESS_STATUSES: frozenset[str] = frozenset(
    {"open", "resolved", "listed", "provided", "verified"}
)
READINESS_SUBTYPES: frozenset[str] = frozenset({"secret", "access", "permission"})


def _required(value: Any, name: str, max_length: int = MAX_IDENTIFIER_LENGTH) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    value = value.strip()
    if not value:
        raise ValueError(f"{name} required")
    if len(value) > max_length:
        raise ValueError(f"{name} must be at most {max_length} characters")
    if "/" in value or "\\" in value:
        raise ValueError(f"{name} must not contain path separators")
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError(f"{name} contains control characters")
    return value


def _non_empty_text(value: Any, name: str, max_length: int = 2000) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    value = value.strip()
    if not value:
        raise ValueError(f"{name} required")
    if len(value) > max_length:
        raise ValueError(f"{name} must be at most {max_length} characters")
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError(f"{name} contains control characters")
    return value


def _optional_text(value: Any, name: str, max_length: int = 2000) -> str | None:
    """Optional text: None/blank becomes None; otherwise validated, stripped."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    value = value.strip()
    if not value:
        return None
    if len(value) > max_length:
        raise ValueError(f"{name} must be at most {max_length} characters")
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError(f"{name} contains control characters")
    return value


def _int_in_range(value: Any, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer")
    if not (low <= value <= high):
        raise ValueError(f"{name} must be between {low} and {high}")
    return value


def _name_list(value: Any, name: str) -> list[str]:
    """Validate a list of non-empty identifier names (toolsets/skills)."""
    if not isinstance(value, list):
        raise ValueError(f"{name} must be a list")
    return [_required(item, f"{name}[{i}]") for i, item in enumerate(value)]


def _enum(value: Any, name: str, allowed: frozenset[str]) -> str:
    """Validate an enum field, defaulting None to the first documented value."""
    if value is None:
        raise ValueError(f"{name} required")
    value = _required(value, name)
    if value not in allowed:
        raise ValueError(
            f"{name} must be one of {', '.join(sorted(allowed))}"
        )
    return value


def _detect_cycle(edges: list[tuple[str, str]], kind: str) -> None:
    """Raise ValueError when the directed edges contain a cycle.

    Iterative 3-colour DFS (explicit stack) — the recursive version overflowed
    the interpreter stack on a ~1000-node parent chain, mirroring the exact bug
    fixed in ``roadmaps_plan_parser._detect_cycle``.
    """
    adjacency: dict[str, list[str]] = {}
    for source, target in edges:
        adjacency.setdefault(source, []).append(target)
    # 0 = unvisited, 1 = on the current DFS path, 2 = fully processed.
    marks: dict[str, int] = {}

    for start in adjacency:
        if marks.get(start, 0) == 2:
            continue
        stack: list[tuple[str, int]] = [(start, 0)]
        marks[start] = 1
        while stack:
            node, idx = stack[-1]
            neighbours = adjacency.get(node, [])
            if idx < len(neighbours):
                stack[-1] = (node, idx + 1)
                nxt = neighbours[idx]
                nxt_mark = marks.get(nxt, 0)
                if nxt_mark == 1:
                    raise ValueError(f"cyclic {kind} reference detected in payload")
                if nxt_mark == 0:
                    marks[nxt] = 1
                    stack.append((nxt, 0))
            else:
                marks[node] = 2
                stack.pop()


def _validate_plan_nodes(nodes: Any) -> list[dict[str, Any]]:
    """Validate and normalize the plan's node payload (no DB access)."""
    if nodes is None:
        return []
    if not isinstance(nodes, list):
        raise ValueError("nodes must be a list")
    if len(nodes) > MAX_PLAN_NODES:
        raise ValueError(f"nodes must be at most {MAX_PLAN_NODES} items")
    seen: set[str] = set()
    parents: list[tuple[str, str]] = []
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(nodes):
        if not isinstance(item, dict):
            raise ValueError(f"nodes[{index}] must be an object")
        node_id = _required(item.get("node_id"), f"nodes[{index}].node_id")
        if node_id in seen:
            raise ValueError(f"duplicate node_id {node_id!r} in nodes")
        seen.add(node_id)
        kind = _enum(item.get("kind"), f"nodes[{index}].kind", NODE_KINDS)
        title = _non_empty_text(
            item.get("title"), f"nodes[{index}].title", max_length=MAX_TITLE_LENGTH
        )
        description = _optional_text(
            item.get("description"), f"nodes[{index}].description",
            max_length=MAX_DESCRIPTION_LENGTH,
        )
        state = item.get("state")
        state = "planned" if state is None else _enum(state, f"nodes[{index}].state", NODE_STATES)
        progress = item.get("progress")
        progress = 0 if progress is None else _int_in_range(
            progress, f"nodes[{index}].progress", 0, 100
        )
        owner_agent = _optional_text(
            item.get("owner_agent"), f"nodes[{index}].owner_agent",
            max_length=MAX_IDENTIFIER_LENGTH,
        )
        block_reason = _optional_text(
            item.get("block_reason"), f"nodes[{index}].block_reason",
            max_length=MAX_REASON_LENGTH,
        )
        parent_node_id = item.get("parent_node_id")
        if parent_node_id is not None:
            parent_node_id = _required(
                parent_node_id, f"nodes[{index}].parent_node_id"
            )
            if parent_node_id == node_id:
                raise ValueError(
                    f"nodes[{index}].parent_node_id cannot reference the node itself"
                )
            parents.append((node_id, parent_node_id))
        normalized.append({
            "node_id": node_id, "kind": kind, "title": title,
            "description": description, "parent_node_id": parent_node_id,
            "state": state, "progress": progress, "owner_agent": owner_agent,
            "block_reason": block_reason,
        })
    for node_id, parent_node_id in parents:
        if parent_node_id not in seen:
            raise ValueError(
                f"parent_node_id {parent_node_id!r} does not reference a node of this payload"
            )
    _detect_cycle(parents, "parent")
    return normalized


def _validate_plan_relations(relations: Any, node_ids: set[str]) -> list[dict[str, Any]]:
    """Validate the plan's relation payload (no DB access)."""
    if relations is None:
        return []
    if not isinstance(relations, list):
        raise ValueError("relations must be a list")
    if len(relations) > MAX_PLAN_RELATIONS:
        raise ValueError(f"relations must be at most {MAX_PLAN_RELATIONS} items")
    seen: set[str] = set()
    edges: list[tuple[str, str]] = []
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(relations):
        if not isinstance(item, dict):
            raise ValueError(f"relations[{index}] must be an object")
        relation_id = _required(item.get("relation_id"), f"relations[{index}].relation_id")
        if relation_id in seen:
            raise ValueError(f"duplicate relation_id {relation_id!r} in relations")
        seen.add(relation_id)
        from_node_id = _required(item.get("from_node_id"), f"relations[{index}].from_node_id")
        to_node_id = _required(item.get("to_node_id"), f"relations[{index}].to_node_id")
        if from_node_id not in node_ids:
            raise ValueError(
                f"relations[{index}].from_node_id {from_node_id!r} does not reference a node of this payload"
            )
        if to_node_id not in node_ids:
            raise ValueError(
                f"relations[{index}].to_node_id {to_node_id!r} does not reference a node of this payload"
            )
        if from_node_id == to_node_id:
            raise ValueError(
                f"relations[{index}].from_node_id and to_node_id must differ"
            )
        kind = _enum(item.get("kind"), f"relations[{index}].kind", RELATION_KINDS)
        state = item.get("state")
        state = "active" if state is None else _enum(
            state, f"relations[{index}].state", RELATION_STATES
        )
        reason = _optional_text(
            item.get("reason"), f"relations[{index}].reason",
            max_length=MAX_REASON_LENGTH,
        )
        edges.append((from_node_id, to_node_id))
        normalized.append({
            "relation_id": relation_id, "from_node_id": from_node_id,
            "to_node_id": to_node_id, "kind": kind, "state": state,
            "reason": reason,
        })
    _detect_cycle(edges, "relation")
    return normalized


def _validate_plan_todos(todos: Any, node_ids: set[str]) -> list[dict[str, Any]]:
    """Validate the plan's todo payload (no DB access)."""
    if todos is None:
        return []
    if not isinstance(todos, list):
        raise ValueError("todos must be a list")
    if len(todos) > MAX_PLAN_TODOS:
        raise ValueError(f"todos must be at most {MAX_PLAN_TODOS} items")
    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(todos):
        if not isinstance(item, dict):
            raise ValueError(f"todos[{index}] must be an object")
        todo_id = _required(item.get("todo_id"), f"todos[{index}].todo_id")
        if todo_id in seen:
            raise ValueError(f"duplicate todo_id {todo_id!r} in todos")
        seen.add(todo_id)
        node_id = item.get("node_id")
        if node_id is not None:
            node_id = _required(node_id, f"todos[{index}].node_id")
            if node_id not in node_ids:
                raise ValueError(
                    f"todos[{index}].node_id {node_id!r} does not reference a node of this payload"
                )
        title = _non_empty_text(
            item.get("title"), f"todos[{index}].title", max_length=MAX_TITLE_LENGTH
        )
        acceptance = _optional_text(
            item.get("acceptance"), f"todos[{index}].acceptance",
            max_length=MAX_DESCRIPTION_LENGTH,
        )
        state = item.get("state")
        state = "open" if state is None else _enum(state, f"todos[{index}].state", TODO_STATES)
        position = item.get("position")
        position = 0 if position is None else _int_in_range(
            position, f"todos[{index}].position", 0, MAX_VERSION
        )
        normalized.append({
            "todo_id": todo_id, "node_id": node_id, "title": title,
            "acceptance": acceptance, "state": state, "position": position,
        })
    return normalized


def _parents_first(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Order nodes so every parent precedes its children (FK-safe inserts).

    Parents were validated to exist in the same payload and to be acyclic,
    so a topological order always exists here.
    """
    parent_of = {
        node["node_id"]: node["parent_node_id"] for node in nodes
    }
    ordered: list[dict[str, Any]] = []
    inserted: set[str] = set()
    remaining = list(nodes)
    while remaining:
        for node in remaining:
            parent = parent_of[node["node_id"]]
            if parent is None or parent in inserted:
                ordered.append(node)
                inserted.add(node["node_id"])
                remaining.remove(node)
                break
        else:  # pragma: no cover - unreachable after cycle validation
            raise ValueError("cyclic parent reference detected in payload")
    return ordered


class RoadmapsWriter:
    """Execute the versioned node mutations against the active profile store."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path

    def _connection(self):
        path = self.db_path if self.db_path is not None else projects_db.projects_db_path()
        return projects_db.connect(db_path=path)

    # -- shared resolution -------------------------------------------------

    def _resolve_node(self, conn, profile_id: str, project_id: str, roadmap_id: str, node_id: str):
        row = conn.execute(
            "SELECT active_version FROM roadmaps "
            "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
            (profile_id, project_id, roadmap_id),
        ).fetchone()
        if row is None:
            raise RoadmapNotFoundError("roadmap not found for the given scope")
        active_version = row["active_version"]
        if active_version is None:
            raise RoadmapNotFoundError("roadmap has no active version to mutate")
        node = conn.execute(
            "SELECT * FROM roadmap_nodes "
            "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
            (profile_id, project_id, roadmap_id, active_version, node_id),
        ).fetchone()
        if node is None:
            raise RoadmapNodeNotFoundError(
                f"node {node_id!r} not found in active version {active_version}"
            )
        return node, active_version

    @staticmethod
    def _check_version(active_version: int, expected_version: Any) -> None:
        if expected_version is None:
            raise ValueError("expected_version required for mutation")
        if isinstance(expected_version, bool) or not isinstance(expected_version, int):
            raise ValueError("expected_version must be an integer")
        if active_version != expected_version:
            raise StaleRoadmapVersionError(
                f"roadmap revised: caller expected version {expected_version}, "
                f"active version is {active_version}; reload before mutating"
            )

    @staticmethod
    def _transition(current: str, target: str) -> str:
        """Validate a node transition, mapping the contract's ValueError."""
        try:
            return transition_node(current, target)
        except ValueError as exc:
            raise InvalidRoadmapTransitionError(str(exc)) from exc

    @staticmethod
    def _result(scope: dict[str, str], node, before: dict[str, Any]) -> dict[str, Any]:
        return {
            "success": True,
            "scope": scope,
            "node": {
                "node_id": node["node_id"],
                "state": node["state"],
                "progress": node["progress"],
                "owner_agent": node["owner_agent"],
                "block_reason": node["block_reason"],
                "updated_at": node["updated_at"],
            },
            "before": before,
        }

    # -- mutations ----------------------------------------------------------

    def claim_node(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        node_id: str,
        actor: str,
        expected_version: Any,
    ) -> dict[str, Any]:
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        node_id = _required(node_id, "node_id")
        actor = _required(actor, "actor")
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                node, active_version = self._resolve_node(conn, profile_id, project_id, roadmap_id, node_id)
                self._check_version(active_version, expected_version)
                before = {"state": node["state"], "owner_agent": node["owner_agent"], "progress": node["progress"]}
                target = self._transition(node["state"], "in_progress")
                now = int(time.time())
                conn.execute(
                    "UPDATE roadmap_nodes SET state=?, owner_agent=?, updated_at=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
                    (target, actor, now, profile_id, project_id, roadmap_id, active_version, node_id),
                )
                conn.execute(
                    "UPDATE roadmaps SET updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (now, actor, profile_id, project_id, roadmap_id),
                )
                updated = conn.execute(
                    "SELECT * FROM roadmap_nodes "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
                    (profile_id, project_id, roadmap_id, active_version, node_id),
                ).fetchone()
                return self._result(scope, updated, before)

    def advance_node(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        node_id: str,
        actor: str,
        expected_version: Any,
    ) -> dict[str, Any]:
        """Transition a node ``planned -> ready`` (the start of execution).

        The contract's node machine only allows ``planned -> ready``
        (``claim_node`` moves ``ready -> in_progress``); without this step a
        planned node can never become actionable. ``expected_version`` is the
        active version the caller observed; a mismatch raises
        :class:`StaleRoadmapVersionError`.
        """
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        node_id = _required(node_id, "node_id")
        actor = _required(actor, "actor")
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                node, active_version = self._resolve_node(conn, profile_id, project_id, roadmap_id, node_id)
                self._check_version(active_version, expected_version)
                before = {"state": node["state"], "owner_agent": node["owner_agent"], "progress": node["progress"]}
                target = self._transition(node["state"], "ready")
                now = int(time.time())
                conn.execute(
                    "UPDATE roadmap_nodes SET state=?, updated_at=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
                    (target, now, profile_id, project_id, roadmap_id, active_version, node_id),
                )
                conn.execute(
                    "UPDATE roadmaps SET updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (now, actor, profile_id, project_id, roadmap_id),
                )
                updated = conn.execute(
                    "SELECT * FROM roadmap_nodes "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
                    (profile_id, project_id, roadmap_id, active_version, node_id),
                ).fetchone()
                return self._result(scope, updated, before)

    def update_progress(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        node_id: str,
        actor: str,
        progress: Any,
        expected_version: Any,
    ) -> dict[str, Any]:
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        node_id = _required(node_id, "node_id")
        actor = _required(actor, "actor")
        progress = _int_in_range(progress, "progress", 0, 100)
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                node, active_version = self._resolve_node(conn, profile_id, project_id, roadmap_id, node_id)
                self._check_version(active_version, expected_version)
                if node["state"] != "in_progress":
                    raise InvalidRoadmapTransitionError(
                        f"progress requires state 'in_progress', got {node['state']!r}"
                    )
                before = {"state": node["state"], "progress": node["progress"]}
                now = int(time.time())
                conn.execute(
                    "UPDATE roadmap_nodes SET progress=?, updated_at=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
                    (progress, now, profile_id, project_id, roadmap_id, active_version, node_id),
                )
                conn.execute(
                    "UPDATE roadmaps SET updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (now, actor, profile_id, project_id, roadmap_id),
                )
                updated = conn.execute(
                    "SELECT * FROM roadmap_nodes "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
                    (profile_id, project_id, roadmap_id, active_version, node_id),
                ).fetchone()
                return self._result(scope, updated, before)

    def complete_node(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        node_id: str,
        actor: str,
        expected_version: Any,
    ) -> dict[str, Any]:
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        node_id = _required(node_id, "node_id")
        actor = _required(actor, "actor")
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                node, active_version = self._resolve_node(conn, profile_id, project_id, roadmap_id, node_id)
                self._check_version(active_version, expected_version)
                before = {"state": node["state"], "progress": node["progress"]}
                target = self._transition(node["state"], "completed")
                now = int(time.time())
                conn.execute(
                    "UPDATE roadmap_nodes SET state=?, progress=100, block_reason=NULL, updated_at=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
                    (target, now, profile_id, project_id, roadmap_id, active_version, node_id),
                )
                conn.execute(
                    "UPDATE roadmaps SET updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (now, actor, profile_id, project_id, roadmap_id),
                )
                updated = conn.execute(
                    "SELECT * FROM roadmap_nodes "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
                    (profile_id, project_id, roadmap_id, active_version, node_id),
                ).fetchone()
                return self._result(scope, updated, before)

    def block_node(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        node_id: str,
        actor: str,
        reason: str,
        expected_version: Any,
    ) -> dict[str, Any]:
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        node_id = _required(node_id, "node_id")
        actor = _required(actor, "actor")
        reason = _non_empty_text(reason, "reason")
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                node, active_version = self._resolve_node(conn, profile_id, project_id, roadmap_id, node_id)
                self._check_version(active_version, expected_version)
                before = {"state": node["state"], "block_reason": node["block_reason"]}
                target = self._transition(node["state"], "blocked")
                now = int(time.time())
                conn.execute(
                    "UPDATE roadmap_nodes SET state=?, block_reason=?, updated_at=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
                    (target, reason, now, profile_id, project_id, roadmap_id, active_version, node_id),
                )
                conn.execute(
                    "UPDATE roadmaps SET updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (now, actor, profile_id, project_id, roadmap_id),
                )
                updated = conn.execute(
                    "SELECT * FROM roadmap_nodes "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
                    (profile_id, project_id, roadmap_id, active_version, node_id),
                ).fetchone()
                return self._result(scope, updated, before)

    def unblock_node(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        node_id: str,
        actor: str,
        expected_version: Any,
    ) -> dict[str, Any]:
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        node_id = _required(node_id, "node_id")
        actor = _required(actor, "actor")
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                node, active_version = self._resolve_node(conn, profile_id, project_id, roadmap_id, node_id)
                self._check_version(active_version, expected_version)
                before = {"state": node["state"], "block_reason": node["block_reason"]}
                target = self._transition(node["state"], "in_progress")
                now = int(time.time())
                conn.execute(
                    "UPDATE roadmap_nodes SET state=?, block_reason=NULL, updated_at=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
                    (target, now, profile_id, project_id, roadmap_id, active_version, node_id),
                )
                conn.execute(
                    "UPDATE roadmaps SET updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (now, actor, profile_id, project_id, roadmap_id),
                )
                updated = conn.execute(
                    "SELECT * FROM roadmap_nodes "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND node_id=?",
                    (profile_id, project_id, roadmap_id, active_version, node_id),
                ).fetchone()
                return self._result(scope, updated, before)

    def update_todo(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        todo_id: str,
        actor: str,
        state: str,
        expected_version: Any,
    ) -> dict[str, Any]:
        """Transition a todo of the active roadmap version (manual steering)."""
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        todo_id = _required(todo_id, "todo_id")
        actor = _required(actor, "actor")
        state = _required(state, "state")
        if state not in ("open", "in_progress", "done", "cancelled"):
            raise ValueError("state must be one of open/in_progress/done/cancelled")
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                row = conn.execute(
                    "SELECT active_version FROM roadmaps "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (profile_id, project_id, roadmap_id),
                ).fetchone()
                if row is None:
                    raise RoadmapNotFoundError("roadmap not found for the given scope")
                active_version = row["active_version"]
                if active_version is None:
                    raise RoadmapNotFoundError("roadmap has no active version to mutate")
                self._check_version(active_version, expected_version)

                todo = conn.execute(
                    "SELECT * FROM roadmap_todos "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND todo_id=?",
                    (profile_id, project_id, roadmap_id, active_version, todo_id),
                ).fetchone()
                if todo is None:
                    raise RoadmapTodoNotFoundError(
                        f"todo {todo_id!r} not found in active version {active_version}"
                    )
                if state not in TODO_TRANSITIONS.get(todo["state"], frozenset()):
                    raise InvalidRoadmapTodoTransitionError(
                        f"invalid todo transition: {todo['state']!r} -> {state!r}"
                    )
                before = {"state": todo["state"]}
                now = int(time.time())
                conn.execute(
                    "UPDATE roadmap_todos SET state=?, updated_at=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND todo_id=?",
                    (state, now, profile_id, project_id, roadmap_id, active_version, todo_id),
                )
                conn.execute(
                    "UPDATE roadmaps SET updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (now, actor, profile_id, project_id, roadmap_id),
                )
                updated = conn.execute(
                    "SELECT todo_id, node_id, title, acceptance, state, position, updated_at FROM roadmap_todos "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND todo_id=?",
                    (profile_id, project_id, roadmap_id, active_version, todo_id),
                ).fetchone()
                return {
                    "success": True,
                    "scope": scope,
                    "todo": dict(updated),
                    "before": before,
                }

    # -- durable roadmap session links ----------------------------------------

    def attach_session(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        stored_session_id: str,
        actor: str,
        expected_version: Any,
        *,
        kind: str = "vision",
        plan_version: Any = None,
    ) -> dict[str, Any]:
        """Attach a durable stored session id to the fully-qualified roadmap."""
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        stored_session_id = _required(stored_session_id, "stored_session_id")
        actor = _required(actor, "actor")
        kind = _enum(kind, "kind", frozenset({"vision"}))
        if plan_version is not None:
            plan_version = _int_in_range(plan_version, "plan_version", 1, MAX_VERSION)
        scope = {
            "profile_id": profile_id,
            "project_id": project_id,
            "roadmap_id": roadmap_id,
        }

        with self._connection() as conn:
            with write_txn(conn):
                roadmap = conn.execute(
                    "SELECT active_version FROM roadmaps "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (profile_id, project_id, roadmap_id),
                ).fetchone()
                if roadmap is None:
                    raise RoadmapNotFoundError("roadmap not found for the given scope")
                self._check_version(roadmap["active_version"] or 0, expected_version)
                if plan_version is not None:
                    version_exists = conn.execute(
                        "SELECT 1 FROM roadmap_versions WHERE profile_id=? "
                        "AND project_id=? AND roadmap_id=? AND version=?",
                        (profile_id, project_id, roadmap_id, plan_version),
                    ).fetchone()
                    if version_exists is None:
                        raise RoadmapVersionNotFoundError(
                            "plan version not found for the given roadmap scope"
                        )
                existing = conn.execute(
                    "SELECT stored_session_id, kind, node_id, plan_version, state, "
                    "actor, created_at, updated_at FROM roadmap_sessions "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? "
                    "AND stored_session_id=? AND kind=?",
                    (profile_id, project_id, roadmap_id, stored_session_id, kind),
                ).fetchone()
                if (existing is not None and existing["state"] == "active"
                        and existing["plan_version"] == plan_version):
                    return {"success": True, "scope": scope, "session": dict(existing)}
                now = int(time.time())
                conn.execute(
                    "UPDATE roadmap_sessions SET state='closed', actor=?, updated_at=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? "
                    "AND kind='vision' AND state='active' AND stored_session_id<>?",
                    (actor, now, profile_id, project_id, roadmap_id, stored_session_id),
                )
                if existing is None:
                    conn.execute(
                        "INSERT INTO roadmap_sessions "
                        "(profile_id, project_id, roadmap_id, stored_session_id, kind, "
                        "node_id, plan_version, state, actor, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, NULL, ?, 'active', ?, ?, ?)",
                        (profile_id, project_id, roadmap_id, stored_session_id, kind,
                         plan_version, actor, now, now),
                    )
                else:
                    conn.execute(
                        "UPDATE roadmap_sessions SET state='active', plan_version=?, "
                        "actor=?, updated_at=? WHERE profile_id=? AND project_id=? "
                        "AND roadmap_id=? AND stored_session_id=? AND kind=?",
                        (plan_version, actor, now, profile_id, project_id, roadmap_id,
                         stored_session_id, kind),
                    )
                conn.execute(
                    "UPDATE roadmaps SET updated_by=?, updated_at=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (actor, now, profile_id, project_id, roadmap_id),
                )
                session = conn.execute(
                    "SELECT stored_session_id, kind, node_id, plan_version, state, "
                    "actor, created_at, updated_at FROM roadmap_sessions "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? "
                    "AND stored_session_id=? AND kind=?",
                    (profile_id, project_id, roadmap_id, stored_session_id, kind),
                ).fetchone()
                return {"success": True, "scope": scope, "session": dict(session)}

    # -- roadmap CRUD + plan governance (T5b) --------------------------------

    @staticmethod
    def _next_roadmap_id() -> str:
        return "r_" + secrets.token_hex(4)

    @staticmethod
    def _content_hash(nodes, relations, todos) -> str:
        payload = {"nodes": nodes, "relations": relations, "todos": todos}
        encoded = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def create_roadmap(
        self,
        profile_id: str,
        project_id: str,
        title: Any,
        actor: str,
        roadmap_id: str | None = None,
        purpose: Any = None,
        lifecycle_state: Any = "draft",
    ) -> dict[str, Any]:
        """Create a roadmap plus its initial version-1 draft marker.

        ``roadmap_id`` is generated (``r_`` + 8 hex chars) unless provided.
        ``lifecycle_state`` is forced to ``'draft'`` (the fresh state used by
        the read side); any explicit non-draft value is rejected — later
        states are only reachable via ``plans.validate`` / ``plans.activate``
        / ``roadmaps.archive``.  ``active_version`` stays NULL until a
        validated plan is activated.
        """
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        title = _non_empty_text(title, "title", max_length=MAX_TITLE_LENGTH)
        actor = _required(actor, "actor")
        # Strict lifecycle machine: a roadmap is born 'draft'. Accepting a
        # later state here would bypass plans.validate / plans.activate /
        # roadmaps.archive (e.g. 'archived' or 'completed' without any plan
        # history), so any explicit non-draft value is rejected.
        if lifecycle_state is None:
            lifecycle_state = "draft"
        if lifecycle_state != "draft":
            raise ValueError(
                "lifecycle_state must be 'draft' at creation (transitions go "
                "through plans.validate, plans.activate, roadmaps.archive)"
            )
        lifecycle = "draft"
        purpose = _optional_text(purpose, "purpose", max_length=MAX_PURPOSE_LENGTH)
        if roadmap_id is not None:
            roadmap_id = _required(roadmap_id, "roadmap_id")
        else:
            roadmap_id = self._next_roadmap_id()
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                project = conn.execute(
                    "SELECT 1 FROM projects WHERE id=?", (project_id,)
                ).fetchone()
                if project is None:
                    raise RoadmapProjectNotFoundError(
                        f"project {project_id!r} not found for the given scope"
                    )
                exists = conn.execute(
                    "SELECT 1 FROM roadmaps "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (profile_id, project_id, roadmap_id),
                ).fetchone()
                if exists is not None:
                    raise RoadmapExistsError(
                        f"roadmap {roadmap_id!r} already exists in this project"
                    )
                now = int(time.time())
                conn.execute(
                    "INSERT INTO roadmaps "
                    "(profile_id, project_id, roadmap_id, title, purpose, lifecycle_state, "
                    "active_version, created_by, updated_by, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)",
                    (profile_id, project_id, roadmap_id, title, purpose, lifecycle,
                     actor, actor, now, now),
                )
                # Initial version-1 draft marker (empty plan): the first real
                # plan created via create_plan will be version 2.
                conn.execute(
                    "INSERT INTO roadmap_versions "
                    "(profile_id, project_id, roadmap_id, version, state, source, "
                    "reason, created_by, created_at, content_hash) "
                    "VALUES (?, ?, ?, 1, 'draft', 'roadmaps.create', ?, ?, ?, NULL)",
                    (profile_id, project_id, roadmap_id, None, actor, now),
                )
        return {
            "success": True,
            "scope": scope,
            "roadmap_id": roadmap_id,
            "version": 1,
            "state": "draft",
        }

    def update_roadmap(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        actor: str,
        expected_version: Any,
        title: Any = None,
        purpose: Any = None,
        lifecycle_state: Any = None,
    ) -> dict[str, Any]:
        """Update only the roadmap fields actually provided.

        ``expected_version`` is the active version the caller observed (0 for
        a roadmap with no active version yet); a mismatch raises
        :class:`StaleRoadmapVersionError`.  ``lifecycle_state`` is not
        writable here — transitions go exclusively through
        ``plans.validate`` / ``plans.activate`` / ``roadmaps.archive`` — and
        an archived roadmap keeps its terminal lifecycle_state (title/purpose
        may still be edited).
        """
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        actor = _required(actor, "actor")
        # Strict lifecycle machine: transitions go exclusively through
        # plans.validate / plans.activate / roadmaps.archive. A direct
        # lifecycle_state write here would bypass those ops (e.g. 'completed'
        # without a validated/activated plan), so it is rejected outright.
        if lifecycle_state is not None:
            raise ValueError(
                "lifecycle_state is managed by plans.validate, plans.activate, "
                "and roadmaps.archive; direct lifecycle writes are rejected"
            )
        if title is None and purpose is None:
            raise ValueError("nothing to update: provide title or purpose")
        if title is not None:
            title = _non_empty_text(title, "title", max_length=MAX_TITLE_LENGTH)
        purpose = _optional_text(purpose, "purpose", max_length=MAX_PURPOSE_LENGTH)
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                row = conn.execute(
                    "SELECT lifecycle_state, active_version FROM roadmaps "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (profile_id, project_id, roadmap_id),
                ).fetchone()
                if row is None:
                    raise RoadmapNotFoundError("roadmap not found for the given scope")
                self._check_version(row["active_version"] or 0, expected_version)
                now = int(time.time())
                conn.execute(
                    "UPDATE roadmaps SET "
                    "title=COALESCE(?, title), purpose=COALESCE(?, purpose), "
                    "lifecycle_state=COALESCE(?, lifecycle_state), "
                    "updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (title, purpose, lifecycle_state, now, actor,
                     profile_id, project_id, roadmap_id),
                )
                updated = conn.execute(
                    "SELECT roadmap_id, title, purpose, lifecycle_state, active_version, "
                    "created_by, updated_by, created_at, updated_at FROM roadmaps "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (profile_id, project_id, roadmap_id),
                ).fetchone()
                return {"success": True, "scope": scope, "roadmap": dict(updated)}

    def archive_roadmap(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        actor: str,
        expected_version: Any,
    ) -> dict[str, Any]:
        """Move the roadmap lifecycle to the terminal ``'archived'`` state.

        The version history stays readable (versions are preserved);
        archiving an already archived roadmap is rejected.  ``expected_version``
        is the observed active version (0 when none).
        """
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        actor = _required(actor, "actor")
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                row = conn.execute(
                    "SELECT lifecycle_state, active_version FROM roadmaps "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (profile_id, project_id, roadmap_id),
                ).fetchone()
                if row is None:
                    raise RoadmapNotFoundError("roadmap not found for the given scope")
                self._check_version(row["active_version"] or 0, expected_version)
                if row["lifecycle_state"] == "archived":
                    raise InvalidRoadmapTransitionError("roadmap is already archived")
                now = int(time.time())
                conn.execute(
                    "UPDATE roadmaps SET lifecycle_state='archived', updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (now, actor, profile_id, project_id, roadmap_id),
                )
                updated = conn.execute(
                    "SELECT roadmap_id, title, purpose, lifecycle_state, active_version, "
                    "created_by, updated_by, created_at, updated_at FROM roadmaps "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (profile_id, project_id, roadmap_id),
                ).fetchone()
                return {"success": True, "scope": scope, "roadmap": dict(updated)}

    def create_plan(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        actor: str,
        version: Any = None,
        nodes: Any = None,
        relations: Any = None,
        todos: Any = None,
        source: Any = None,
        reason: Any = None,
    ) -> dict[str, Any]:
        """Create a full plan version atomically (nodes + relations + todos).

        The whole payload is validated BEFORE any insert, then everything is
        committed in one IMMEDIATE transaction — an invalid payload leaves the
        store untouched.  The new version is ``'proposed'`` (a created plan is
        proposed, never active).  ``version`` defaults to max(version)+1
        (version 1 is reserved by ``roadmaps.create``).  ``source`` / ``reason``
        document where the plan came from.
        """
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        actor = _required(actor, "actor")
        if version is not None:
            version = _int_in_range(version, "version", 1, MAX_VERSION)
        source = _optional_text(source, "source", max_length=MAX_IDENTIFIER_LENGTH)
        reason = _optional_text(reason, "reason", max_length=MAX_REASON_LENGTH)
        nodes = _validate_plan_nodes(nodes)
        node_ids = {node["node_id"] for node in nodes}
        relations = _validate_plan_relations(relations, node_ids)
        todos = _validate_plan_todos(todos, node_ids)
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                row = conn.execute(
                    "SELECT lifecycle_state, active_version FROM roadmaps "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (profile_id, project_id, roadmap_id),
                ).fetchone()
                if row is None:
                    raise RoadmapNotFoundError("roadmap not found for the given scope")
                if row["lifecycle_state"] == "archived":
                    raise InvalidRoadmapTransitionError(
                        "cannot create a plan for an archived roadmap"
                    )
                if version is None:
                    max_version = conn.execute(
                        "SELECT COALESCE(MAX(version), 0) AS m FROM roadmap_versions "
                        "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                        (profile_id, project_id, roadmap_id),
                    ).fetchone()["m"]
                    version = max_version + 1
                else:
                    exists = conn.execute(
                        "SELECT 1 FROM roadmap_versions "
                        "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                        (profile_id, project_id, roadmap_id, version),
                    ).fetchone()
                    if exists is not None:
                        raise RoadmapVersionExistsError(
                            f"version {version} already exists for this roadmap"
                        )
                now = int(time.time())
                content_hash = self._content_hash(nodes, relations, todos)
                conn.execute(
                    "INSERT INTO roadmap_versions "
                    "(profile_id, project_id, roadmap_id, version, state, source, "
                    "reason, created_by, created_at, content_hash) "
                    "VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?)",
                    (profile_id, project_id, roadmap_id, version, source, reason,
                     actor, now, content_hash),
                )
                for node in _parents_first(nodes):
                    conn.execute(
                        "INSERT INTO roadmap_nodes "
                        "(profile_id, project_id, roadmap_id, version, node_id, "
                        "parent_node_id, kind, title, description, state, progress, "
                        "owner_agent, block_reason, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (profile_id, project_id, roadmap_id, version,
                         node["node_id"], node["parent_node_id"], node["kind"],
                         node["title"], node["description"], node["state"],
                         node["progress"], node["owner_agent"], node["block_reason"],
                         now, now),
                    )
                for relation in relations:
                    conn.execute(
                        "INSERT INTO roadmap_relations "
                        "(profile_id, project_id, roadmap_id, version, relation_id, "
                        "from_node_id, to_node_id, kind, state, reason) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (profile_id, project_id, roadmap_id, version,
                         relation["relation_id"], relation["from_node_id"],
                         relation["to_node_id"], relation["kind"],
                         relation["state"], relation["reason"]),
                    )
                for todo in todos:
                    conn.execute(
                        "INSERT INTO roadmap_todos "
                        "(profile_id, project_id, roadmap_id, version, todo_id, "
                        "node_id, title, state, position, created_at, updated_at, acceptance) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (profile_id, project_id, roadmap_id, version,
                         todo["todo_id"], todo["node_id"], todo["title"],
                         todo["state"], todo["position"], now, now,
                         todo["acceptance"]),
                    )
                # Roadmap lifecycle: draft -> proposed once a plan is proposed.
                lifecycle = (
                    "in_progress"
                    if row["lifecycle_state"] == "validated"
                    else ("proposed" if row["lifecycle_state"] == "draft" else row["lifecycle_state"])
                )
                conn.execute(
                    "UPDATE roadmaps SET lifecycle_state=?, updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (lifecycle, now, actor, profile_id, project_id, roadmap_id),
                )
        return {
            "success": True,
            "scope": scope,
            "version": version,
            "state": "proposed",
            "content_hash": content_hash,
            "counts": {"nodes": len(nodes), "relations": len(relations), "todos": len(todos)},
        }

    def validate_plan(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        version: Any,
        actor: str,
        expected_version: Any,
    ) -> dict[str, Any]:
        """Transition a plan version ``draft|proposed -> validated``.

        The Batterie Plan gate runs first: the version must pass
        ``check_plan_battery`` (objective outcome + criteria, milestone → phase
        → todo, every todo with acceptance, no orphan, acyclic) or
        ``PlanBatteryFailedError`` is raised and nothing transitions.

        Governance op: the caller (toolset agent under Pierre's authority, or
        Pierre directly) is recorded as ``roadmaps.updated_by`` — the version
        row itself has no ``updated_by`` column (append-only apart from state).
        ``expected_version`` is the observed active version (0 when none).
        """
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        version = _int_in_range(version, "version", 1, MAX_VERSION)
        actor = _required(actor, "actor")
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                row = conn.execute(
                    "SELECT lifecycle_state, active_version FROM roadmaps "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (profile_id, project_id, roadmap_id),
                ).fetchone()
                if row is None:
                    raise RoadmapNotFoundError("roadmap not found for the given scope")
                if row["lifecycle_state"] == "archived":
                    raise InvalidRoadmapTransitionError(
                        "cannot validate a plan for an archived roadmap"
                    )
                self._check_version(row["active_version"] or 0, expected_version)
                vrow = conn.execute(
                    "SELECT state FROM roadmap_versions "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                    (profile_id, project_id, roadmap_id, version),
                ).fetchone()
                if vrow is None:
                    raise RoadmapVersionNotFoundError(
                        f"version {version} not found for this roadmap"
                    )
                if vrow["state"] not in ("draft", "proposed"):
                    raise InvalidRoadmapPlanTransitionError(
                        f"only draft/proposed plans can be validated; "
                        f"version {version} is {vrow['state']!r}"
                    )
                battery = check_plan_battery(
                    conn, profile_id, project_id, roadmap_id, version
                )
                if not battery["ok"]:
                    raise PlanBatteryFailedError(battery["failures"])
                now = int(time.time())
                conn.execute(
                    "UPDATE roadmap_versions SET state='validated' "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                    (profile_id, project_id, roadmap_id, version),
                )
                conn.execute(
                    "UPDATE roadmaps SET updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (now, actor, profile_id, project_id, roadmap_id),
                )
        return {"success": True, "scope": scope, "version": version, "state": "validated"}

    def activate_plan(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        version: Any,
        actor: str,
        expected_version: Any,
    ) -> dict[str, Any]:
        """Point ``roadmaps.active_version`` at a validated plan version.

        The version must be ``'validated'`` (a non-validated plan is rejected
        with an explicit transition error).  The previously active version, if
        any, is marked ``'superseded'`` (history preserved).  Activation starts
        execution: the roadmap lifecycle moves to ``'in_progress'`` whatever
        its prior non-terminal state.  ``expected_version`` is the active
        version the caller observed (0 when none).
        """
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        version = _int_in_range(version, "version", 1, MAX_VERSION)
        actor = _required(actor, "actor")
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}

        with self._connection() as conn:
            with write_txn(conn):
                row = conn.execute(
                    "SELECT lifecycle_state, active_version FROM roadmaps "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (profile_id, project_id, roadmap_id),
                ).fetchone()
                if row is None:
                    raise RoadmapNotFoundError("roadmap not found for the given scope")
                if row["lifecycle_state"] == "archived":
                    raise InvalidRoadmapTransitionError(
                        "cannot activate a plan for an archived roadmap"
                    )
                self._check_version(row["active_version"] or 0, expected_version)
                vrow = conn.execute(
                    "SELECT state FROM roadmap_versions "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                    (profile_id, project_id, roadmap_id, version),
                ).fetchone()
                if vrow is None:
                    raise RoadmapVersionNotFoundError(
                        f"version {version} not found for this roadmap"
                    )
                if vrow["state"] != "validated":
                    raise InvalidRoadmapPlanTransitionError(
                        f"only a validated plan can be activated; "
                        f"version {version} is {vrow['state']!r}"
                    )
                now = int(time.time())
                previous = row["active_version"]
                if previous is not None and previous != version:
                    conn.execute(
                        "UPDATE roadmap_versions SET state='superseded' "
                        "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                        (profile_id, project_id, roadmap_id, previous),
                    )
                # Activation starts execution: the roadmap lifecycle moves to
                # 'in_progress' whatever its prior non-terminal state.
                conn.execute(
                    "UPDATE roadmaps SET active_version=?, lifecycle_state='in_progress', "
                    "updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (version, now, actor, profile_id, project_id, roadmap_id),
                )
        return {
            "success": True,
            "scope": scope,
            "active_version": version,
            "previous_active_version": previous,
        }

    def spawn_kanban_cards(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        version: Any,
        node_id: str,
        actor: str,
        board_slug: str | None = None,
    ) -> dict[str, Any]:
        """Spawn one kanban card per todo under a milestone (jalon) and record
        the durable todo→card link (spec §6). Idempotent: a todo already linked
        is skipped, and task creation is deduped by a roadmap-scoped
        idempotency key so a retry never double-writes a card.
        """
        from hermes_cli import kanban_db

        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        version = _int_in_range(version, "version", 1, MAX_VERSION)
        node_id = _required(node_id, "node_id")
        actor = _required(actor, "actor")
        if board_slug is not None:
            board_slug = _required(board_slug, "board_slug")
        scope = {
            "profile_id": profile_id,
            "project_id": project_id,
            "roadmap_id": roadmap_id,
            "version": version,
        }

        with self._connection() as conn:
            # Resolve the milestone and collect every phase descendant.
            nodes = conn.execute(
                "SELECT node_id, parent_node_id, kind FROM roadmap_nodes "
                "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                (profile_id, project_id, roadmap_id, version),
            ).fetchall()
            by_id = {n["node_id"]: n for n in nodes}
            milestone = by_id.get(node_id)
            if milestone is None or milestone["kind"] != "milestone":
                raise RoadmapNodeNotFoundError(
                    f"milestone {node_id!r} not found in version {version}"
                )
            children: dict[str, list[str]] = {}
            for n in nodes:
                if n["parent_node_id"]:
                    children.setdefault(n["parent_node_id"], []).append(n["node_id"])
            phase_ids: set[str] = set()
            stack = [node_id]
            seen = {node_id}
            while stack:
                cur = stack.pop()
                for child in children.get(cur, ()):
                    if child in seen:
                        continue
                    seen.add(child)
                    if by_id[child]["kind"] == "phase":
                        phase_ids.add(child)
                    stack.append(child)

            if not phase_ids:
                return {"success": True, "scope": scope, "board_slug": board_slug,
                        "spawned": 0, "links": []}

            todos = conn.execute(
                "SELECT todo_id, node_id, title, acceptance FROM roadmap_todos "
                "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                (profile_id, project_id, roadmap_id, version),
            ).fetchall()
            phase_todos = [t for t in todos if t["node_id"] in phase_ids]

            existing = {
                row["todo_id"]
                for row in conn.execute(
                    "SELECT todo_id FROM roadmap_kanban_links "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                    (profile_id, project_id, roadmap_id, version),
                )
            }
            to_spawn = [t for t in phase_todos if t["todo_id"] not in existing]
            if not to_spawn:
                return {"success": True, "scope": scope, "board_slug": board_slug,
                        "spawned": 0, "links": []}

            # Resolve the board: explicit > project-bound board > current board.
            if board_slug is None:
                proj = conn.execute(
                    "SELECT board_slug FROM projects WHERE id=?", (project_id,)
                ).fetchone()
                board_slug = proj["board_slug"] if proj and proj["board_slug"] else None
                if not board_slug:
                    board_slug = kanban_db.get_current_board() or "default"

            kconn = kanban_db.connect(board=board_slug)
            spawned: list[dict[str, str]] = []
            try:
                for t in to_spawn:
                    task_id = kanban_db.create_task(
                        kconn,
                        title=t["title"],
                        body=(t["acceptance"] or "").strip() or None,
                        created_by=actor,
                        project_id=project_id,
                        board=board_slug,
                        idempotency_key=(
                            f"roadmap:{profile_id}:{roadmap_id}:{version}:{t['todo_id']}"
                        ),
                    )
                    spawned.append({"todo_id": t["todo_id"], "task_id": task_id})
            finally:
                kconn.close()

            now = int(time.time())
            with write_txn(conn):
                for link in spawned:
                    conn.execute(
                        "INSERT OR IGNORE INTO roadmap_kanban_links "
                        "(profile_id, project_id, roadmap_id, version, todo_id, "
                        "board_slug, task_id, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (profile_id, project_id, roadmap_id, version,
                         link["todo_id"], board_slug, link["task_id"], now, now),
                    )
                if spawned:
                    conn.execute(
                        "UPDATE roadmaps SET updated_at=?, updated_by=? "
                        "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                        (now, actor, profile_id, project_id, roadmap_id),
                    )

        return {
            "success": True,
            "scope": scope,
            "board_slug": board_slug,
            "spawned": len(spawned),
            "links": [
                {"todo_id": link["todo_id"], "board_slug": board_slug, "task_id": link["task_id"]}
                for link in spawned
            ],
        }

    def set_team(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        version: Any,
        actor: str,
        workers: Any = None,
        assignments: Any = None,
    ) -> dict[str, Any]:
        """Replace the version's team (lane workers) and todo→worker ownership.

        ``workers`` is a list of ``{worker_id, lane, model, provider,
        thinking_level, toolsets, skills}`` where ``toolsets``/``skills`` are
        lists of names (stored as JSON). ``assignments`` maps ``todo_id →
        worker_id``. The team is replaced atomically (idempotent set): workers
        are re-inserted and every todo's ``owner_worker`` is set or cleared.
        Structure is validated here; completeness is the Batterie Team's job.
        """
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        version = _int_in_range(version, "version", 1, MAX_VERSION)
        actor = _required(actor, "actor")
        if workers is None:
            workers = []
        if assignments is None:
            assignments = []
        if not isinstance(workers, list):
            raise ValueError("workers must be a list")
        if not isinstance(assignments, list):
            raise ValueError("assignments must be a list")

        normalized: list[dict[str, Any]] = []
        seen_workers: set[str] = set()
        for index, item in enumerate(workers):
            if not isinstance(item, dict):
                raise ValueError(f"workers[{index}] must be an object")
            worker_id = _required(item.get("worker_id"), f"workers[{index}].worker_id")
            if worker_id in seen_workers:
                raise ValueError(f"duplicate worker_id {worker_id!r} in workers")
            seen_workers.add(worker_id)
            normalized.append({
                "worker_id": worker_id,
                "lane": _non_empty_text(
                    item.get("lane"), f"workers[{index}].lane", max_length=MAX_TITLE_LENGTH
                ),
                "model": _optional_text(
                    item.get("model"), f"workers[{index}].model", max_length=MAX_IDENTIFIER_LENGTH
                ),
                "provider": _optional_text(
                    item.get("provider"), f"workers[{index}].provider", max_length=MAX_IDENTIFIER_LENGTH
                ),
                "thinking_level": _optional_text(
                    item.get("thinking_level"), f"workers[{index}].thinking_level",
                    max_length=MAX_IDENTIFIER_LENGTH,
                ),
                "toolsets": _name_list(item.get("toolsets") or [], f"workers[{index}].toolsets"),
                "skills": _name_list(item.get("skills") or [], f"workers[{index}].skills"),
            })

        worker_ids = {w["worker_id"] for w in normalized}
        norm_assign: list[tuple[str, str]] = []
        seen_todos: set[str] = set()
        for index, item in enumerate(assignments):
            if not isinstance(item, dict):
                raise ValueError(f"assignments[{index}] must be an object")
            todo_id = _required(item.get("todo_id"), f"assignments[{index}].todo_id")
            if todo_id in seen_todos:
                raise ValueError(f"duplicate todo_id {todo_id!r} in assignments")
            seen_todos.add(todo_id)
            worker_id = _required(item.get("worker_id"), f"assignments[{index}].worker_id")
            if worker_id not in worker_ids:
                raise ValueError(
                    f"assignments[{index}].worker_id {worker_id!r} is not a worker of this payload"
                )
            norm_assign.append((todo_id, worker_id))

        scope = {
            "profile_id": profile_id,
            "project_id": project_id,
            "roadmap_id": roadmap_id,
            "version": version,
        }

        with self._connection() as conn:
            with write_txn(conn):
                vrow = conn.execute(
                    "SELECT 1 FROM roadmap_versions "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                    (profile_id, project_id, roadmap_id, version),
                ).fetchone()
                if vrow is None:
                    raise RoadmapVersionNotFoundError(
                        f"version {version} not found for this roadmap"
                    )
                todo_rows = conn.execute(
                    "SELECT todo_id FROM roadmap_todos "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                    (profile_id, project_id, roadmap_id, version),
                ).fetchall()
                todo_ids = {r["todo_id"] for r in todo_rows}
                for todo_id, _ in norm_assign:
                    if todo_id not in todo_ids:
                        raise RoadmapTodoNotFoundError(
                            f"todo {todo_id!r} not found in version {version}"
                        )

                now = int(time.time())
                conn.execute(
                    "DELETE FROM roadmap_team_workers "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                    (profile_id, project_id, roadmap_id, version),
                )
                for w in normalized:
                    conn.execute(
                        "INSERT INTO roadmap_team_workers "
                        "(profile_id, project_id, roadmap_id, version, worker_id, lane, "
                        "model, provider, thinking_level, toolsets, skills, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (profile_id, project_id, roadmap_id, version,
                         w["worker_id"], w["lane"], w["model"], w["provider"],
                         w["thinking_level"],
                         json.dumps(w["toolsets"]) if w["toolsets"] else None,
                         json.dumps(w["skills"]) if w["skills"] else None,
                         now, now),
                    )
                assign_map = dict(norm_assign)
                for row in todo_rows:
                    owner = assign_map.get(row["todo_id"])
                    conn.execute(
                        "UPDATE roadmap_todos SET owner_worker=?, updated_at=? "
                        "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? AND todo_id=?",
                        (owner, now, profile_id, project_id, roadmap_id, version, row["todo_id"]),
                    )
                conn.execute(
                    "UPDATE roadmaps SET updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (now, actor, profile_id, project_id, roadmap_id),
                )

        return {
            "success": True,
            "scope": scope,
            "workers": len(normalized),
            "assigned": len(norm_assign),
        }

    def set_readiness(
        self,
        profile_id: str,
        project_id: str,
        roadmap_id: str,
        version: Any,
        actor: str,
        items: Any = None,
    ) -> dict[str, Any]:
        """Replace the version's readiness items (blockers + authorizations).

        ``items`` is a list of ``{item_id, kind, subtype, title, detail,
        status}``. ``kind`` is 'blocker' or 'authorization'; ``subtype``
        ('secret'|'access'|'permission') is optional and only meaningful for
        authorizations. The set is replaced atomically (idempotent set).
        Structure is validated here; completeness (resolved blockers with a
        plan, verified authorizations) is the Batterie Readiness's job.
        """
        profile_id = _required(profile_id, "profile_id")
        project_id = _required(project_id, "project_id")
        roadmap_id = _required(roadmap_id, "roadmap_id")
        version = _int_in_range(version, "version", 1, MAX_VERSION)
        actor = _required(actor, "actor")
        if items is None:
            items = []
        if not isinstance(items, list):
            raise ValueError("items must be a list")

        normalized: list[dict[str, Any]] = []
        seen_items: set[str] = set()
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                raise ValueError(f"items[{index}] must be an object")
            item_id = _required(item.get("item_id"), f"items[{index}].item_id")
            if item_id in seen_items:
                raise ValueError(f"duplicate item_id {item_id!r} in items")
            seen_items.add(item_id)
            kind = _enum(item.get("kind"), f"items[{index}].kind", READINESS_KINDS)
            title = _non_empty_text(
                item.get("title"), f"items[{index}].title", max_length=MAX_TITLE_LENGTH
            )
            status = _enum(item.get("status"), f"items[{index}].status", READINESS_STATUSES)
            subtype = item.get("subtype")
            if subtype is not None:
                subtype = _enum(subtype, f"items[{index}].subtype", READINESS_SUBTYPES)
            detail = _optional_text(
                item.get("detail"), f"items[{index}].detail", max_length=MAX_REASON_LENGTH
            )
            normalized.append({
                "item_id": item_id,
                "kind": kind,
                "subtype": subtype,
                "title": title,
                "detail": detail,
                "status": status,
            })

        scope = {
            "profile_id": profile_id,
            "project_id": project_id,
            "roadmap_id": roadmap_id,
            "version": version,
        }

        with self._connection() as conn:
            with write_txn(conn):
                vrow = conn.execute(
                    "SELECT 1 FROM roadmap_versions "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                    (profile_id, project_id, roadmap_id, version),
                ).fetchone()
                if vrow is None:
                    raise RoadmapVersionNotFoundError(
                        f"version {version} not found for this roadmap"
                    )
                now = int(time.time())
                conn.execute(
                    "DELETE FROM roadmap_readiness "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                    (profile_id, project_id, roadmap_id, version),
                )
                for item in normalized:
                    conn.execute(
                        "INSERT INTO roadmap_readiness "
                        "(profile_id, project_id, roadmap_id, version, item_id, kind, "
                        "subtype, title, detail, status, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (profile_id, project_id, roadmap_id, version,
                         item["item_id"], item["kind"], item["subtype"], item["title"],
                         item["detail"], item["status"], now, now),
                    )
                conn.execute(
                    "UPDATE roadmaps SET updated_at=?, updated_by=? "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                    (now, actor, profile_id, project_id, roadmap_id),
                )

        return {
            "success": True,
            "scope": scope,
            "items": len(normalized),
        }
