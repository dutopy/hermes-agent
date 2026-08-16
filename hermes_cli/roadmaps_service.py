"""Read-only Roadmaps service backed by an existing profile ``projects.db``."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import quote


class RoadmapsUnavailable(RuntimeError):
    """The profile store exists but cannot be read safely."""


class RoadmapsService:
    MAX_IDENTIFIER_LENGTH = 128
    _PUBLIC_COLUMNS = {
        "roadmaps": (
            "profile_id", "project_id", "roadmap_id", "title", "purpose",
            "lifecycle_state", "active_version", "created_by", "updated_by",
            "created_at", "updated_at",
        ),
        "roadmap_versions": (
            "profile_id", "project_id", "roadmap_id", "version", "state",
            "source", "reason", "created_by", "created_at", "content_hash",
        ),
        "roadmap_nodes": (
            "profile_id", "project_id", "roadmap_id", "version", "node_id",
            "parent_node_id", "kind", "title", "description", "state",
            "progress", "owner_agent", "block_reason", "created_at", "updated_at",
        ),
        "roadmap_relations": (
            "profile_id", "project_id", "roadmap_id", "version", "relation_id",
            "from_node_id", "to_node_id", "kind", "state", "reason",
        ),
        "roadmap_todos": (
            "profile_id", "project_id", "roadmap_id", "version", "todo_id",
            "node_id", "title", "state", "position", "created_at", "updated_at",
            "acceptance", "owner_worker",
        ),
        "roadmap_kanban_links": (
            "profile_id", "project_id", "roadmap_id", "version", "todo_id",
            "board_slug", "task_id", "created_at", "updated_at",
        ),
        "roadmap_team_workers": (
            "profile_id", "project_id", "roadmap_id", "version", "worker_id",
            "lane", "model", "provider", "thinking_level", "toolsets", "skills",
            "created_at", "updated_at",
        ),
        "roadmap_readiness": (
            "profile_id", "project_id", "roadmap_id", "version", "item_id",
            "kind", "subtype", "title", "detail", "status",
            "created_at", "updated_at",
        ),
        "roadmap_sessions": (
            "profile_id", "project_id", "roadmap_id", "stored_session_id",
            "kind", "node_id", "plan_version", "state", "actor", "created_at",
            "updated_at",
        ),
    }

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path

    @staticmethod
    def _required(value: str, name: str) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{name} must be a string")
        value = value.strip()
        if not value or any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError(f"{name} required")
        if len(value) > RoadmapsService.MAX_IDENTIFIER_LENGTH:
            raise ValueError(f"{name} must be at most {RoadmapsService.MAX_IDENTIFIER_LENGTH} characters")
        return value

    @classmethod
    def _optional(cls, value: str | None, name: str) -> str | None:
        return None if value is None else cls._required(value, name)

    def _connection(self) -> sqlite3.Connection | None:
        path = Path(self.db_path) if self.db_path is not None else None
        if path is None or not path.is_file():
            return None
        uri_path = quote(str(path.resolve()), safe="/")
        uri = f"file:{uri_path}?mode=ro"
        conn = None
        handed_off = False
        try:
            conn = sqlite3.connect(uri, uri=True)
            conn.row_factory = sqlite3.Row
            tables = {row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )}
            required = {"roadmaps", "roadmap_versions", "roadmap_nodes",
                        "roadmap_relations", "roadmap_todos", "roadmap_sessions"}
            if not required.issubset(tables):
                raise RoadmapsUnavailable
            handed_off = True
            return conn
        except RoadmapsUnavailable:
            raise
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            if conn is not None and not handed_off:
                conn.close()

    @classmethod
    def _select(cls, table: str) -> str:
        return f"SELECT {', '.join(cls._PUBLIC_COLUMNS[table])} FROM {table}"

    @staticmethod
    def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        return dict(row) if row is not None else None

    def list(self, profile_id: str, project_id: str | None = None) -> dict[str, Any]:
        profile_id = self._required(profile_id, "profile_id")
        project_id = self._optional(project_id, "project_id")
        query = (
            f"SELECT r.{', r.'.join(self._PUBLIC_COLUMNS['roadmaps'])}, p.name AS project_name "
            "FROM roadmaps r LEFT JOIN projects p ON p.id = r.project_id "
            "WHERE r.profile_id = ?"
        )
        args: list[Any] = [profile_id]
        if project_id is not None:
            query += " AND r.project_id = ?"
            args.append(project_id)
        query += " ORDER BY r.project_id, r.roadmap_id"
        scope = {"profile_id": profile_id, **({"project_id": project_id} if project_id is not None else {})}
        conn = self._connection()
        if conn is None:
            return {"roadmaps": [], "scope": scope}
        try:
            rows = [self._row(row) for row in conn.execute(query, args)]
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            conn.close()
        return {"roadmaps": rows, "scope": scope}

    def get(self, profile_id: str, project_id: str, roadmap_id: str) -> dict[str, Any]:
        profile_id = self._required(profile_id, "profile_id")
        project_id = self._required(project_id, "project_id")
        roadmap_id = self._required(roadmap_id, "roadmap_id")
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}
        conn = self._connection()
        if conn is None:
            return {"found": False, "scope": scope, "roadmap": None}
        try:
            roadmap = conn.execute(
                f"{self._select('roadmaps')} WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                (profile_id, project_id, roadmap_id),
            ).fetchone()
            if roadmap is None:
                return {"found": False, "scope": scope, "roadmap": None}
            payload: dict[str, Any] = self._row(roadmap) or {}
            versions = []
            for version in conn.execute(
                f"{self._select('roadmap_versions')} WHERE profile_id=? AND project_id=? AND roadmap_id=? ORDER BY version",
                (profile_id, project_id, roadmap_id),
            ):
                version_payload: dict[str, Any] = self._row(version) or {}
                key = (profile_id, project_id, roadmap_id, version["version"])
                version_payload["nodes"] = [self._row(row) for row in conn.execute(f"{self._select('roadmap_nodes')} WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? ORDER BY node_id", key)]
                version_payload["relations"] = [self._row(row) for row in conn.execute(f"{self._select('roadmap_relations')} WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? ORDER BY relation_id", key)]
                version_payload["todos"] = [self._row(row) for row in conn.execute(f"{self._select('roadmap_todos')} WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? ORDER BY position, todo_id", key)]
                versions.append(version_payload)
            payload["versions"] = versions
            return {"found": True, "scope": scope, "roadmap": payload}
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            conn.close()

    def snapshot(self, profile_id: str, project_id: str, roadmap_id: str) -> dict[str, Any]:
        return self.get(profile_id, project_id, roadmap_id)

    def get_snapshot(self, profile_id: str, project_id: str, roadmap_id: str) -> dict[str, Any]:
        return self.snapshot(profile_id, project_id, roadmap_id)

    def check_battery(
        self, profile_id: str, project_id: str, roadmap_id: str, version: int
    ) -> dict[str, Any]:
        """Evaluate the Batterie Plan for one version (read-only)."""
        from hermes_cli.roadmaps_battery import check_plan_battery

        profile_id = self._required(profile_id, "profile_id")
        project_id = self._required(project_id, "project_id")
        roadmap_id = self._required(roadmap_id, "roadmap_id")
        conn = self._connection()
        if conn is None:
            return {
                "ok": False,
                "failures": [
                    {"code": "plan.no_store", "hint": "Roadmaps store unavailable."}
                ],
            }
        try:
            return check_plan_battery(conn, profile_id, project_id, roadmap_id, version)
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            conn.close()

    def list_plans(self, profile_id: str, project_id: str, roadmap_id: str) -> dict[str, Any]:
        """List the roadmap's plan versions, newest first (version DESC)."""
        profile_id = self._required(profile_id, "profile_id")
        project_id = self._required(project_id, "project_id")
        roadmap_id = self._required(roadmap_id, "roadmap_id")
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}
        conn = self._connection()
        if conn is None:
            return {"plans": [], "scope": scope}
        try:
            plans = [
                self._row(row)
                for row in conn.execute(
                    f"{self._select('roadmap_versions')} "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? "
                    "ORDER BY version DESC",
                    (profile_id, project_id, roadmap_id),
                )
            ]
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            conn.close()
        return {"plans": plans, "scope": scope}

    def get_plan(self, profile_id: str, project_id: str, roadmap_id: str, version: int) -> dict[str, Any]:
        """Fetch one complete plan version (nodes + relations + todos)."""
        profile_id = self._required(profile_id, "profile_id")
        project_id = self._required(project_id, "project_id")
        roadmap_id = self._required(roadmap_id, "roadmap_id")
        if isinstance(version, bool) or not isinstance(version, int):
            raise ValueError("version must be an integer")
        if version < 1:
            raise ValueError("version must be at least 1")
        scope = {"profile_id": profile_id, "project_id": project_id, "roadmap_id": roadmap_id}
        conn = self._connection()
        if conn is None:
            return {"found": False, "scope": scope, "plan": None}
        try:
            row = conn.execute(
                f"{self._select('roadmap_versions')} "
                "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                (profile_id, project_id, roadmap_id, version),
            ).fetchone()
            if row is None:
                return {"found": False, "scope": scope, "plan": None}
            plan: dict[str, Any] = self._row(row) or {}
            key = (profile_id, project_id, roadmap_id, version)
            plan["nodes"] = [
                self._row(node) for node in conn.execute(
                    f"{self._select('roadmap_nodes')} WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? ORDER BY node_id",
                    key,
                )
            ]
            plan["relations"] = [
                self._row(relation) for relation in conn.execute(
                    f"{self._select('roadmap_relations')} WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? ORDER BY relation_id",
                    key,
                )
            ]
            plan["todos"] = [
                self._row(todo) for todo in conn.execute(
                    f"{self._select('roadmap_todos')} WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? ORDER BY position, todo_id",
                    key,
                )
            ]
            return {"found": True, "scope": scope, "plan": plan}
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            conn.close()

    def list_sessions(
        self, profile_id: str, project_id: str, roadmap_id: str
    ) -> dict[str, Any]:
        """List durable session links for exactly one qualified roadmap."""
        profile_id = self._required(profile_id, "profile_id")
        project_id = self._required(project_id, "project_id")
        roadmap_id = self._required(roadmap_id, "roadmap_id")
        scope = {
            "profile_id": profile_id,
            "project_id": project_id,
            "roadmap_id": roadmap_id,
        }
        conn = self._connection()
        if conn is None:
            return {"sessions": [], "scope": scope}
        try:
            sessions = [
                self._row(row)
                for row in conn.execute(
                    f"{self._select('roadmap_sessions')} "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? "
                    "ORDER BY CASE state WHEN 'active' THEN 0 ELSE 1 END, "
                    "updated_at DESC, stored_session_id",
                    (profile_id, project_id, roadmap_id),
                )
            ]
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            conn.close()
        return {"sessions": sessions, "scope": scope}

    @staticmethod
    def _kanban_card_state(board_slug: str, task_id: str) -> dict[str, Any]:
        """Read one kanban card's live state (best-effort, read-only).

        Never creates a board DB: a read of a missing board/task returns
        ``{"found": False, "status": "unknown"}`` instead of a side effect.
        """
        from hermes_cli import kanban_db

        db_path = kanban_db.kanban_db_path(board=board_slug)
        if not db_path.is_file():
            return {"found": False, "status": "unknown"}
        conn = sqlite3.connect(f"file:{quote(str(db_path.resolve()), safe='/')}?mode=ro", uri=True)
        try:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT id, title, status, assignee, completed_at FROM tasks WHERE id=?",
                (task_id,),
            ).fetchone()
        except sqlite3.Error:
            return {"found": False, "status": "unknown"}
        finally:
            conn.close()
        if row is None:
            return {"found": False, "status": "unknown"}
        return {
            "found": True,
            "task_id": row["id"],
            "title": row["title"],
            "status": row["status"],
            "assignee": row["assignee"],
            "completed_at": row["completed_at"],
        }

    def list_kanban_links(
        self, profile_id: str, project_id: str, roadmap_id: str, version: int | None = None
    ) -> dict[str, Any]:
        """List durable todo→kanban links for a roadmap, with live card state.

        ``version=None`` returns links for every version; otherwise scoped to
        one version. Each entry is the link row plus the live kanban card
        state (``found``, ``status``, ``title``, ``assignee``, ``completed_at``)
        resolved against the card's board — the renderer never follows tip
        rotation itself.
        """
        profile_id = self._required(profile_id, "profile_id")
        project_id = self._required(project_id, "project_id")
        roadmap_id = self._required(roadmap_id, "roadmap_id")
        if version is not None and (isinstance(version, bool) or not isinstance(version, int)):
            raise ValueError("version must be an integer")
        scope = {
            "profile_id": profile_id,
            "project_id": project_id,
            "roadmap_id": roadmap_id,
            **( {"version": version} if version is not None else {}),
        }
        conn = self._connection()
        if conn is None:
            return {"links": [], "scope": scope}
        try:
            has_table = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='roadmap_kanban_links'"
            ).fetchone()
            if has_table is None:
                return {"links": [], "scope": scope}
            query = (
                f"{self._select('roadmap_kanban_links')} "
                "WHERE profile_id=? AND project_id=? AND roadmap_id=?"
            )
            args: list[Any] = [profile_id, project_id, roadmap_id]
            if version is not None:
                query += " AND version=?"
                args.append(version)
            query += " ORDER BY version, todo_id"
            rows = [self._row(row) for row in conn.execute(query, args)]
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            conn.close()
        for link in rows:
            link["card"] = self._kanban_card_state(link["board_slug"], link["task_id"])
        return {"links": rows, "scope": scope}

    @staticmethod
    def _json_list(text: Any) -> list[Any]:
        """Parse a stored JSON array of names; ``[]`` on null/empty/unparseable."""
        if not text:
            return []
        try:
            value = json.loads(text)
        except (ValueError, TypeError):
            return []
        return value if isinstance(value, list) else []

    def list_team(
        self, profile_id: str, project_id: str, roadmap_id: str, version: int | None = None
    ) -> dict[str, Any]:
        """List the version's team (workers) + todo→worker assignments.

        ``version=None`` returns the team across every version; otherwise
        scoped to one. ``toolsets``/``skills`` are returned as parsed lists.
        """
        profile_id = self._required(profile_id, "profile_id")
        project_id = self._required(project_id, "project_id")
        roadmap_id = self._required(roadmap_id, "roadmap_id")
        if version is not None and (isinstance(version, bool) or not isinstance(version, int)):
            raise ValueError("version must be an integer")
        scope = {
            "profile_id": profile_id,
            "project_id": project_id,
            "roadmap_id": roadmap_id,
            **( {"version": version} if version is not None else {}),
        }
        conn = self._connection()
        if conn is None:
            return {"workers": [], "assignments": [], "scope": scope}
        try:
            query = (
                f"{self._select('roadmap_team_workers')} "
                "WHERE profile_id=? AND project_id=? AND roadmap_id=?"
            )
            args: list[Any] = [profile_id, project_id, roadmap_id]
            if version is not None:
                query += " AND version=?"
                args.append(version)
            query += " ORDER BY worker_id"
            workers = []
            for row in conn.execute(query, args):
                worker = self._row(row) or {}
                worker["toolsets"] = self._json_list(worker.get("toolsets"))
                worker["skills"] = self._json_list(worker.get("skills"))
                workers.append(worker)

            tquery = (
                f"{self._select('roadmap_todos')} "
                "WHERE profile_id=? AND project_id=? AND roadmap_id=?"
            )
            targs: list[Any] = [profile_id, project_id, roadmap_id]
            if version is not None:
                tquery += " AND version=?"
                targs.append(version)
            tquery += " ORDER BY todo_id"
            assignments = [
                {"todo_id": row["todo_id"], "worker_id": row["owner_worker"]}
                for row in conn.execute(tquery, targs)
                if row["owner_worker"]
            ]
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            conn.close()
        return {"workers": workers, "assignments": assignments, "scope": scope}

    def check_team_battery(
        self, profile_id: str, project_id: str, roadmap_id: str, version: int
    ) -> dict[str, Any]:
        """Evaluate the Batterie Team for one version (read-only)."""
        from hermes_cli.roadmaps_team_battery import check_team_battery

        profile_id = self._required(profile_id, "profile_id")
        project_id = self._required(project_id, "project_id")
        roadmap_id = self._required(roadmap_id, "roadmap_id")
        conn = self._connection()
        if conn is None:
            return {
                "ok": False,
                "failures": [
                    {"code": "team.no_store", "hint": "Roadmaps store unavailable."}
                ],
            }
        try:
            return check_team_battery(conn, profile_id, project_id, roadmap_id, version)
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            conn.close()

    def list_readiness(
        self, profile_id: str, project_id: str, roadmap_id: str, version: int | None = None
    ) -> dict[str, Any]:
        """List the version's readiness items (blockers + authorizations).

        ``version=None`` returns items across every version; otherwise scoped
        to one.
        """
        profile_id = self._required(profile_id, "profile_id")
        project_id = self._required(project_id, "project_id")
        roadmap_id = self._required(roadmap_id, "roadmap_id")
        if version is not None and (isinstance(version, bool) or not isinstance(version, int)):
            raise ValueError("version must be an integer")
        scope = {
            "profile_id": profile_id,
            "project_id": project_id,
            "roadmap_id": roadmap_id,
            **( {"version": version} if version is not None else {}),
        }
        conn = self._connection()
        if conn is None:
            return {"items": [], "scope": scope}
        try:
            has_table = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='roadmap_readiness'"
            ).fetchone()
            if has_table is None:
                return {"items": [], "scope": scope}
            query = (
                f"{self._select('roadmap_readiness')} "
                "WHERE profile_id=? AND project_id=? AND roadmap_id=?"
            )
            args: list[Any] = [profile_id, project_id, roadmap_id]
            if version is not None:
                query += " AND version=?"
                args.append(version)
            query += " ORDER BY kind, item_id"
            items = [self._row(row) for row in conn.execute(query, args)]
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            conn.close()
        return {"items": items, "scope": scope}

    def check_readiness_battery(
        self, profile_id: str, project_id: str, roadmap_id: str, version: int
    ) -> dict[str, Any]:
        """Evaluate the Batterie Readiness for one version (read-only)."""
        from hermes_cli.roadmaps_readiness_battery import check_readiness_battery

        profile_id = self._required(profile_id, "profile_id")
        project_id = self._required(project_id, "project_id")
        roadmap_id = self._required(roadmap_id, "roadmap_id")
        conn = self._connection()
        if conn is None:
            return {
                "ok": False,
                "failures": [
                    {"code": "readiness.no_store", "hint": "Roadmaps store unavailable."}
                ],
            }
        try:
            return check_readiness_battery(conn, profile_id, project_id, roadmap_id, version)
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            conn.close()

    def board(
        self, profile_id: str, project_id: str, roadmap_id: str, version: int | None = None
    ) -> dict[str, Any]:
        """Board projection (spec §7): objective → milestones → phases → todos.

        Each todo carries its ``acceptance``, its owner worker and the live
        state of its linked kanban card. ``version=None`` resolves to the
        roadmap's active version. The board is a pure projection — the Kanban
        remains the executor; this only renders the plan and the live card
        state.
        """
        profile_id = self._required(profile_id, "profile_id")
        project_id = self._required(project_id, "project_id")
        roadmap_id = self._required(roadmap_id, "roadmap_id")
        if version is not None and (isinstance(version, bool) or not isinstance(version, int)):
            raise ValueError("version must be an integer")
        scope = {
            "profile_id": profile_id,
            "project_id": project_id,
            "roadmap_id": roadmap_id,
            **( {"version": version} if version is not None else {}),
        }
        conn = self._connection()
        if conn is None:
            return {"found": False, "scope": scope, "version": version, "milestones": []}
        try:
            roadmap = conn.execute(
                f"{self._select('roadmaps')} WHERE profile_id=? AND project_id=? AND roadmap_id=?",
                (profile_id, project_id, roadmap_id),
            ).fetchone()
            if roadmap is None:
                return {"found": False, "scope": scope, "version": version, "milestones": []}
            resolved = version
            if resolved is None:
                resolved = roadmap["active_version"]
            if resolved is None:
                return {
                    "found": True, "scope": scope, "version": None,
                    "objective": None, "milestones": [],
                }
            key = (profile_id, project_id, roadmap_id, resolved)
            nodes = [
                dict(row) for row in conn.execute(
                    f"{self._select('roadmap_nodes')} "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? "
                    "ORDER BY node_id",
                    key,
                )
            ]
            todos = [
                dict(row) for row in conn.execute(
                    f"{self._select('roadmap_todos')} "
                    "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=? "
                    "ORDER BY position, todo_id",
                    key,
                )
            ]
            workers: dict[str, dict[str, Any]] = {}
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='roadmap_team_workers'"
            ).fetchone():
                workers = {
                    row["worker_id"]: dict(row) for row in conn.execute(
                        f"{self._select('roadmap_team_workers')} "
                        "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                        key,
                    )
                }
            links: dict[str, dict[str, Any]] = {}
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='roadmap_kanban_links'"
            ).fetchone():
                links = {
                    row["todo_id"]: dict(row) for row in conn.execute(
                        f"{self._select('roadmap_kanban_links')} "
                        "WHERE profile_id=? AND project_id=? AND roadmap_id=? AND version=?",
                        key,
                    )
                }
        except sqlite3.Error as exc:
            raise RoadmapsUnavailable from exc
        finally:
            conn.close()

        for worker in workers.values():
            worker["toolsets"] = self._json_list(worker.get("toolsets"))
            worker["skills"] = self._json_list(worker.get("skills"))

        objective = next((n for n in nodes if n["kind"] == "objective"), None)
        milestones = sorted((n for n in nodes if n["kind"] == "milestone"), key=lambda n: n["node_id"])
        todos_by_node: dict[str, list[dict[str, Any]]] = {}
        for todo in todos:
            todos_by_node.setdefault(todo["node_id"], []).append(todo)

        def build_todo(todo: dict[str, Any]) -> dict[str, Any]:
            link = links.get(todo["todo_id"])
            card = (
                self._kanban_card_state(link["board_slug"], link["task_id"])
                if link is not None else None
            )
            owner = todo.get("owner_worker")
            return {
                "todo": todo,
                "worker": workers.get(owner) if owner else None,
                "card": card,
            }

        milestones_payload: list[dict[str, Any]] = []
        for milestone in milestones:
            phases = sorted(
                (n for n in nodes if n["kind"] == "phase" and n["parent_node_id"] == milestone["node_id"]),
                key=lambda n: n["node_id"],
            )
            phases_payload = [
                {"phase": phase, "todos": [build_todo(t) for t in todos_by_node.get(phase["node_id"], [])]}
                for phase in phases
            ]
            milestones_payload.append({"milestone": milestone, "phases": phases_payload})

        return {
            "found": True,
            "scope": scope,
            "version": resolved,
            "objective": objective,
            "milestones": milestones_payload,
        }
