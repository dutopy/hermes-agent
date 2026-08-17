/**
 * Roadmaps — disk-mode Desktop plugin (branch feat/roadmaps).
 *
 * BUILT ARTIFACT — do not edit by hand. Source lives in src/; settings live
 * in src/config.json (embedded at build time). Rebuild with: node build.mjs
 * (esbuild bundle, format=esm, external @hermes/plugin-sdk / react /
 * react/jsx-runtime — the runtime loader rewrites those bare specifiers).
 */

// src/index.js
import { useCallback as useCallback8, useEffect as useEffect6, useMemo as useMemo7, useState as useState10 } from "react";
import { jsx as jsx14, jsxs as jsxs14 } from "react/jsx-runtime";
import {
  Badge as Badge3,
  Button as Button10,
  Codicon as Codicon13,
  CopyButton as CopyButton4,
  EmptyState as EmptyState8,
  ErrorState as ErrorState4,
  ROUTES_AREA,
  ScrollArea,
  SIDEBAR_NAV_AREA,
  Skeleton as Skeleton4,
  StatusDot as StatusDot7,
  cn as cn7,
  host as host7,
  useValue as useValue2
} from "@hermes/plugin-sdk";

// src/config.json
var config_default = {
  layout: {
    compact: 900,
    wide: 1280,
    inspectorWidth: 340
  },
  query: {
    listRefetchMs: 3e4,
    projectsRefetchMs: 3e4,
    snapshotRefetchMs: 6e4,
    boardRefetchMs: 3e4
  },
  states: {
    tone: {
      ready: "good",
      in_progress: "warn",
      blocked: "bad",
      completed: "muted",
      cancelled: "muted"
    },
    order: {
      blocked: 0,
      in_progress: 1,
      ready: 2
    },
    label: {
      ready: "Ready",
      in_progress: "In progress",
      blocked: "Blocked",
      completed: "Completed",
      planned: "Planned",
      archived: "Archived"
    }
  },
  nextActionLabel: {
    unblock: "Unblock",
    claim: "Claim",
    advance: "Advance",
    assign: "Assign",
    "wait-deps": "Wait"
  },
  relation: {
    label: {
      depends_on: "depends on",
      blocks: "blocks"
    },
    icon: {
      depends_on: "arrow-right",
      blocks: "debug-disconnect"
    }
  },
  board: {
    cardTone: {
      triage: "muted",
      todo: "muted",
      scheduled: "muted",
      ready: "good",
      running: "warn",
      blocked: "bad",
      review: "warn",
      done: "good",
      archived: "muted"
    }
  },
  tabs: [
    { id: "plan", label: "Plan", codicon: "versions" },
    { id: "team", label: "Team", codicon: "person" },
    { id: "readiness", label: "Readiness", codicon: "pass-filled" },
    { id: "map", label: "Map", codicon: "graph" }
  ],
  codicons: [
    "account",
    "add",
    "archive",
    "arrow-down",
    "arrow-right",
    "arrow-up",
    "check",
    "checklist",
    "chevron-right",
    "close",
    "debug-disconnect",
    "debug-restart",
    "edit",
    "ellipsis",
    "error",
    "files",
    "graph",
    "hourglass",
    "info",
    "list-ordered",
    "lock",
    "milestone",
    "pass-filled",
    "person",
    "person-add",
    "play",
    "project",
    "target",
    "versions"
  ]
};

// src/data.js
import { host } from "@hermes/plugin-sdk";
var ID = "roadmaps";
var RPC = {
  list: "roadmaps.list",
  snapshot: "roadmaps.snapshot",
  board: "roadmaps.board",
  claim_node: "roadmaps.claim_node",
  update_progress: "roadmaps.update_progress",
  complete_node: "roadmaps.complete_node",
  block_node: "roadmaps.block_node",
  unblock_node: "roadmaps.unblock_node",
  update_todo: "roadmaps.update_todo",
  projects_list: "projects.list",
  projects_create: "projects.create",
  projects_update: "projects.update",
  projects_archive: "projects.archive",
  roadmaps_create: "roadmaps.create",
  roadmaps_update: "roadmaps.update",
  roadmaps_archive: "roadmaps.archive",
  plans_list: "plans.list",
  plans_get: "plans.get",
  planning_rules: "roadmaps.planning_rules",
  roadmap_sessions: "roadmaps.sessions",
  attach_session: "roadmaps.attach_session",
  plans_create: "plans.create",
  plans_activate: "plans.activate",
  plans_check: "plans.check",
  team_list: "team.list",
  team_check: "team.check",
  readiness_list: "readiness.list",
  readiness_check: "readiness.check"
};
var NODE_ORDER = config_default.states.order;
var ERROR_GUIDANCE = {
  5061: {
    title: "Service unavailable",
    hint: "The roadmaps backend is temporarily unavailable. Try again in a moment."
  },
  5062: {
    title: "Not found",
    hint: "The project no longer exists in this profile. Reload the project list."
  },
  5063: {
    title: "Invalid parameters",
    hint: "The scope (profile, project, roadmap) or one of the fields is invalid. Check the selection, then try again."
  },
  5064: {
    title: "Stale version",
    hint: "The roadmap changed since this snapshot was loaded. Reload the snapshot, then retry the action."
  },
  5065: {
    title: "Not found",
    hint: "The roadmap, node, or todo no longer exists in this scope. Reload the list."
  },
  5066: {
    title: "Invalid transition",
    hint: "The current state does not allow this action (e.g. completing a blocked node). Fix the state, then try again."
  },
  5067: {
    title: "Conflict",
    hint: "A roadmap or plan version with this identifier already exists. Reload the list and choose a different name."
  }
};
var UNKNOWN_ERROR_HINT = "Something unexpected went wrong. Retry, and reload the snapshot if the problem persists.";
function rpcError(err) {
  const raw = err?.code;
  if (raw == null) return { code: null };
  const code = typeof raw === "number" ? raw : Number(raw);
  return { code: Number.isFinite(code) ? code : null };
}
function errorCopy(err) {
  const code = rpcError(err).code;
  const entry = code != null ? ERROR_GUIDANCE[code] : null;
  return { code, hint: entry?.hint ?? UNKNOWN_ERROR_HINT };
}
function mutationErrorCopy(error) {
  if (!error) return null;
  if (error.code == null) {
    return { title: "Action failed", hint: error.hint || UNKNOWN_ERROR_HINT, code: null };
  }
  const entry = ERROR_GUIDANCE[error.code];
  return { title: entry?.title ?? "Action failed", hint: entry?.hint ?? UNKNOWN_ERROR_HINT, code: error.code };
}
function isValidIdentifier(value) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 128) return false;
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) return false;
  }
  return true;
}
function assertResponseScope(response, expected) {
  const got = response?.scope ?? {};
  const okProfile = expected.profile == null || got.profile_id === expected.profile;
  const okProject = expected.projectId == null || got.project_id === expected.projectId;
  const okRoadmap = expected.roadmapId == null || got.roadmap_id === expected.roadmapId;
  return okProfile && okProject && okRoadmap;
}
function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
var nodeLabel = (n) => n?.title || n?.node_id || "?";
var plural = (n, s) => `${n} ${s}${n === 1 ? "" : "s"}`;
function validateProgress(value) {
  const p = Number(value);
  return Number.isInteger(p) && p >= 0 && p <= 100;
}
function localValidationError(hint) {
  return Object.assign(new Error(hint), { code: null, hint });
}
function validateRoadmapTitle(value) {
  if (typeof value !== "string") return false;
  const t = value.trim();
  if (t === "" || t.length > 200) return false;
  for (const ch of t) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) return false;
  }
  return true;
}
async function projectCreate(name) {
  return host.request(RPC.projects_create, { name: String(name ?? "").trim() });
}
async function projectUpdate(id, name) {
  return host.request(RPC.projects_update, { id, name: String(name ?? "").trim() });
}
async function projectArchive(id) {
  return host.request(RPC.projects_archive, { id });
}
function projectSelectorItems(projects) {
  return (projects ?? []).filter((p) => p && !p.archived).sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)));
}
function roadmapSelectorItems(roadmaps, projectId) {
  return (roadmaps ?? []).filter((r) => r && r.project_id === projectId && r.lifecycle_state !== "archived").sort((a, b) => String(a.title ?? a.roadmap_id).localeCompare(String(b.title ?? b.roadmap_id)));
}
function assertRoadmapScope(profile, projectId, roadmapId) {
  const scopeProfile = String(profile ?? "").trim();
  const scopeProject = String(projectId ?? "").trim();
  const scopeRoadmap = roadmapId == null ? null : String(roadmapId).trim();
  if (!isValidIdentifier(scopeProfile)) throw localValidationError("A valid profile is required for this action.");
  if (!isValidIdentifier(scopeProject)) throw localValidationError("A valid project id is required for this action.");
  if (scopeRoadmap !== null && !isValidIdentifier(scopeRoadmap)) {
    throw localValidationError("A valid roadmap id is required for this action.");
  }
  return { profile: scopeProfile, projectId: scopeProject, roadmapId: scopeRoadmap };
}
function assertExpectedVersion(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw localValidationError("expected_version must be a non-negative integer (0 when the roadmap has no active version).");
  }
  return value;
}
function assertActor(actor) {
  const sent = String(actor ?? "").trim() || "user";
  if (!isValidIdentifier(sent)) {
    throw localValidationError("Actor must be a valid identifier: non-empty, at most 128 characters, no control characters.");
  }
  return sent;
}
async function getPlanningRules() {
  const res = await host.request(RPC.planning_rules, {});
  if (!res || typeof res.rules?.prompt !== "string" || res.rules.prompt.trim() === "") {
    throw localValidationError("The planning rules could not be loaded. Retry the action.");
  }
  return res;
}
function validatePlanPayload(payload) {
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const relations = Array.isArray(payload?.relations) ? payload.relations : [];
  const todos = Array.isArray(payload?.todos) ? payload.todos : [];
  for (const [i, item] of nodes.entries()) {
    if (!item || typeof item !== "object") throw localValidationError(`nodes[${i}] must be an object.`);
    if (!isValidIdentifier(item.node_id)) {
      throw localValidationError(`nodes[${i}].node_id must be a non-empty identifier of at most 128 characters.`);
    }
    if (!validateRoadmapTitle(item.title)) {
      throw localValidationError(`nodes[${i}].title must be non-empty, at most 200 characters.`);
    }
    if (typeof item.kind !== "string" || item.kind.trim() === "") {
      throw localValidationError(`nodes[${i}].kind must be a non-empty string.`);
    }
  }
  for (const [i, item] of relations.entries()) {
    if (!item || typeof item !== "object") throw localValidationError(`relations[${i}] must be an object.`);
    for (const key of ["relation_id", "from_node_id", "to_node_id"]) {
      if (!isValidIdentifier(item[key])) {
        throw localValidationError(`relations[${i}].${key} must be a non-empty identifier of at most 128 characters.`);
      }
    }
    if (typeof item.kind !== "string" || item.kind.trim() === "") {
      throw localValidationError(`relations[${i}].kind must be a non-empty string.`);
    }
  }
  for (const [i, item] of todos.entries()) {
    if (!item || typeof item !== "object") throw localValidationError(`todos[${i}] must be an object.`);
    if (!isValidIdentifier(item.todo_id)) {
      throw localValidationError(`todos[${i}].todo_id must be a non-empty identifier of at most 128 characters.`);
    }
    if (!validateRoadmapTitle(item.title)) {
      throw localValidationError(`todos[${i}].title must be non-empty, at most 200 characters.`);
    }
  }
  return { nodes, relations, todos };
}
async function createPlan(profile, projectId, roadmapId, payload, actor) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId);
  const clean = validatePlanPayload(payload);
  const sentActor = assertActor(actor);
  const params = {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId,
    actor: sentActor,
    nodes: clean.nodes,
    relations: clean.relations,
    todos: clean.todos
  };
  const source = typeof payload?.source === "string" && payload.source.trim() !== "" ? payload.source.trim() : "vision";
  const reason = typeof payload?.reason === "string" && payload.reason.trim() !== "" ? payload.reason.trim() : void 0;
  if (source) params.source = source;
  if (reason) params.reason = reason;
  const title = typeof payload?.title === "string" && payload.title.trim() !== "" ? payload.title.trim() : void 0;
  if (title) params.title = title;
  return host.request(RPC.plans_create, params);
}
async function activatePlan(profile, projectId, roadmapId, version, expectedVersion, actor) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId);
  if (!Number.isInteger(version) || version < 1) {
    throw localValidationError("version must be a positive integer.");
  }
  const expected = assertExpectedVersion(expectedVersion);
  const sentActor = assertActor(actor);
  return host.request(RPC.plans_activate, {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId,
    version,
    expected_version: expected,
    actor: sentActor
  });
}
async function attachVisionSession(profile, projectId, roadmapId, storedSessionId, expectedVersion, actor, planVersion) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId);
  if (!isValidIdentifier(storedSessionId)) {
    throw localValidationError("A valid stored session id is required for Vision.");
  }
  const expected = assertExpectedVersion(expectedVersion);
  const sentActor = assertActor(actor);
  if (planVersion != null && (!Number.isInteger(planVersion) || planVersion < 1)) {
    throw localValidationError("plan_version must be a positive integer when provided.");
  }
  const params = {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId,
    stored_session_id: storedSessionId,
    kind: "vision",
    expected_version: expected,
    actor: sentActor
  };
  if (planVersion != null) params.plan_version = planVersion;
  const res = await host.request(RPC.attach_session, params);
  if (!assertResponseScope(res, scope) || res?.session?.stored_session_id !== storedSessionId || res?.session?.kind !== "vision" || res?.session?.state !== "active") {
    throw localValidationError("The Vision session response did not match the requested association.");
  }
  return res;
}
async function visionSessionCreate(profile, rulesPrompt) {
  const scopeProfile = String(profile ?? "").trim();
  if (!isValidIdentifier(scopeProfile)) {
    throw localValidationError("A valid profile is required to start a Vision session.");
  }
  const prompt = String(rulesPrompt ?? "").trim();
  if (prompt === "") {
    throw localValidationError("The planning rules prompt is empty \u2014 cannot start a Vision session.");
  }
  return host.request("session.create", {
    profile: scopeProfile,
    source: "vision",
    messages: [{ role: "system", content: prompt }]
  });
}
async function startVisionSession(profile, rulesPrompt) {
  const created = await visionSessionCreate(profile, rulesPrompt);
  return {
    profile: String(profile ?? "").trim(),
    storedSessionId: created?.stored_session_id,
    runtimeSessionId: created?.session_id
  };
}
function extractPlanJsonBlock(text) {
  if (typeof text !== "string" || text.trim() === "") return null;
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (fences.length === 0) return null;
  const last = fences[fences.length - 1];
  if (!last || last[1].trim() === "") return null;
  try {
    return JSON.parse(last[1].trim());
  } catch {
    return null;
  }
}
function planPreviewFromJson(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const nodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  if (nodes.length === 0) return null;
  const relations = Array.isArray(obj.relations) ? obj.relations : [];
  const todos = Array.isArray(obj.todos) ? obj.todos : [];
  const kinds = [];
  const seenKinds = /* @__PURE__ */ new Set();
  for (const n of nodes) {
    const kind = typeof n?.kind === "string" ? n.kind : "";
    if (kind !== "" && !seenKinds.has(kind)) {
      seenKinds.add(kind);
      kinds.push(kind);
    }
  }
  return {
    title: typeof obj.title === "string" && obj.title.trim() !== "" ? obj.title.trim() : "",
    counts: { nodes: nodes.length, relations: relations.length, todos: todos.length },
    kinds,
    nodes,
    relations,
    todos
  };
}
function activeVersion(snapshot) {
  const roadmap = snapshot?.roadmap;
  const v = roadmap?.active_version;
  return roadmap?.versions?.find((x) => x.version === v) ?? null;
}
function threadNodes(version) {
  const nodes = version?.nodes ?? [];
  return nodes.filter((n) => n.state === "ready" || n.state === "in_progress" || n.state === "blocked").sort(
    (a, b) => (NODE_ORDER[a.state] ?? 9) - (NODE_ORDER[b.state] ?? 9) || String(a.node_id).localeCompare(String(b.node_id))
  );
}
var CANONICAL_RELATIONS = /* @__PURE__ */ new Set(["depends_on", "blocks"]);
function mapRelations(version, { includeInactive = false } = {}) {
  const nodes = version?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  return (version?.relations ?? []).filter((r) => includeInactive || r.state === "active").filter((r) => CANONICAL_RELATIONS.has(r.kind)).map((r) => ({ ...r, from: byId.get(r.from_node_id) ?? null, to: byId.get(r.to_node_id) ?? null })).filter((r) => r.from && r.to).sort((a, b) => String(a.relation_id).localeCompare(String(b.relation_id)));
}
function planVersions(snapshot) {
  const versions = snapshot?.roadmap?.versions ?? [];
  return [...versions].sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0));
}
function depsSatisfied(node, version) {
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]));
  const deps = (version?.relations ?? []).filter((r) => r.state === "active" && r.kind === "depends_on" && r.from_node_id === node.node_id).map((r) => byId.get(r.to_node_id));
  return deps.every((d) => !d || d.state === "completed" || d.state === "cancelled");
}
function nodeDepsInfo(node, version) {
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]));
  const deps = (version?.relations ?? []).filter((r) => r.state === "active" && r.kind === "depends_on" && r.from_node_id === node.node_id).map((r) => {
    const target = byId.get(r.to_node_id) ?? null;
    return {
      target,
      targetId: r.to_node_id,
      satisfied: !target || target.state === "completed" || target.state === "cancelled"
    };
  });
  const total = deps.length;
  const satisfied = deps.filter((d) => d.satisfied).length;
  return { deps, total, satisfied };
}
function nodeDependants(node, version) {
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]));
  return (version?.relations ?? []).filter((r) => r.state === "active" && r.kind === "depends_on" && r.to_node_id === node.node_id).map((r) => byId.get(r.from_node_id)).filter(Boolean);
}
function nodeBlockers(node, version) {
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]));
  return (version?.relations ?? []).filter((r) => r.state === "active" && r.kind === "blocks" && r.to_node_id === node.node_id).map((r) => ({ from: byId.get(r.from_node_id) ?? null, reason: r.reason, relationId: r.relation_id })).filter((b) => b.from);
}
function nodeBlocks(node, version) {
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]));
  return (version?.relations ?? []).filter((r) => r.state === "active" && r.kind === "blocks" && r.from_node_id === node.node_id).map((r) => byId.get(r.to_node_id)).filter(Boolean);
}
function copilotSections(version) {
  const nodes = version?.nodes ?? [];
  if (nodes.length === 0) return null;
  const now = nodes.filter((n) => n.state === "ready" && depsSatisfied(n, version));
  const inflight = nodes.filter((n) => n.state === "in_progress");
  const waiting = nodes.filter((n) => n.state === "ready" && !depsSatisfied(n, version));
  const blocked = nodes.filter((n) => n.state === "blocked" && n.block_reason);
  return { now, inflight, waiting, blocked };
}
function nextAction(version) {
  const nodes = version?.nodes ?? [];
  if (nodes.length === 0) return null;
  let best = null;
  for (const n of nodes) {
    if (!["ready", "in_progress", "blocked"].includes(n.state)) continue;
    const { total, satisfied } = nodeDepsInfo(n, version);
    const pending = total - satisfied;
    let tier;
    let kind;
    if (n.state === "blocked") {
      if (pending === 0) {
        tier = 0;
        kind = "unblock";
      } else {
        tier = 3;
        kind = "wait-deps";
      }
    } else if (n.state === "ready") {
      if (pending === 0 && !n.owner_agent) {
        tier = 1;
        kind = "claim";
      } else if (pending === 0 && n.owner_agent) {
        tier = 2;
        kind = "advance";
      } else {
        tier = 4;
        kind = "wait-deps";
      }
    } else if (!n.owner_agent) {
      tier = 5;
      kind = "assign";
    } else {
      tier = 6;
      kind = "advance";
    }
    const cand = { node: n, tier, kind, pending, satisfied, total };
    if (!best || tier < best.tier || tier === best.tier && pending < best.pending || tier === best.tier && pending === best.pending && String(n.node_id) < String(best.node.node_id)) {
      best = cand;
    }
  }
  return best;
}
function criticalChain(version) {
  const nodes = version?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const depsOf = /* @__PURE__ */ new Map();
  for (const r of version?.relations ?? []) {
    if (r.state !== "active" || r.kind !== "depends_on") continue;
    const arr = depsOf.get(r.from_node_id) ?? [];
    arr.push(r.to_node_id);
    depsOf.set(r.from_node_id, arr);
  }
  const memo = /* @__PURE__ */ new Map();
  const depth = (id, seen2) => {
    if (memo.has(id)) return memo.get(id);
    if (seen2.has(id)) return 0;
    seen2.add(id);
    let d = 0;
    for (const depId of depsOf.get(id) ?? []) d = Math.max(d, 1 + depth(depId, seen2));
    seen2.delete(id);
    memo.set(id, d);
    return d;
  };
  const actionable = nodes.filter((n) => n.state === "ready" || n.state === "in_progress");
  if (actionable.length === 0) return [];
  let best = null;
  let bestDepth = -1;
  for (const n of actionable) {
    const d = depth(n.node_id, /* @__PURE__ */ new Set());
    if (d > bestDepth) {
      bestDepth = d;
      best = n;
    }
  }
  if (!best || bestDepth <= 0) return best ? [best.node_id] : [];
  const chain = [best.node_id];
  let cur = best;
  const seen = /* @__PURE__ */ new Set([best.node_id]);
  while (chain.length <= nodes.length) {
    const deps = (depsOf.get(cur.node_id) ?? []).filter((d) => !seen.has(d)).map((dId) => ({ dId, depth: depth(dId, /* @__PURE__ */ new Set()) })).sort((a, b) => b.depth - a.depth);
    if (deps.length === 0) break;
    cur = byId.get(deps[0].dId);
    if (!cur) break;
    seen.add(cur.node_id);
    chain.push(cur.node_id);
  }
  return chain;
}

// src/state.js
import { useCallback, useEffect as useEffect2, useMemo, useRef, useState as useState2 } from "react";
import { host as host2, useQuery } from "@hermes/plugin-sdk";

// src/persist.js
import { useEffect, useState } from "react";
function read(key, initialValue) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw != null ? JSON.parse(raw) : initialValue;
  } catch {
    return initialValue;
  }
}
function write(key, value) {
  const store = globalThis.localStorage;
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}
function usePersistedState(key, initialValue) {
  const [value, setValue] = useState(() => read(key, initialValue));
  useEffect(() => {
    setValue(read(key, initialValue));
  }, [key, initialValue]);
  useEffect(() => {
    write(key, value);
  }, [key, value]);
  return [value, setValue];
}

// src/state.js
function useLayoutMode(initialWidth) {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState2(initialWidth);
  useEffect2(() => {
    const el = containerRef.current;
    const RO = globalThis.ResizeObserver;
    if (!el || typeof RO !== "function") return;
    const ro = new RO((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = containerWidth > 0 ? containerWidth : initialWidth;
  const mode = width >= config_default.layout.wide ? "wide" : width >= config_default.layout.compact ? "mid" : "compact";
  return { containerRef, mode, compact: mode === "compact" };
}
function useRoadmapsList(profile, enabled) {
  return useQuery({
    queryKey: [ID, "list", profile],
    queryFn: async () => {
      const res = await host2.request(RPC.list, { profile });
      if (!assertResponseScope(res, { profile })) {
        throw Object.assign(new Error("Response out of scope"), { code: 5063 });
      }
      return res;
    },
    enabled,
    refetchInterval: config_default.query.listRefetchMs
  });
}
function useProjectsList(profile, enabled) {
  return useQuery({
    queryKey: [ID, "projects", profile],
    queryFn: async () => host2.request(RPC.projects_list, {}),
    enabled,
    refetchInterval: config_default.query.projectsRefetchMs
  });
}
function useRoadmapSnapshot(profile, projectId, roadmapId, enabled) {
  return useQuery({
    queryKey: [ID, "steer", profile, projectId, roadmapId],
    queryFn: async () => {
      const res = await host2.request(RPC.snapshot, { profile, project_id: projectId, roadmap_id: roadmapId });
      if (!assertResponseScope(res, { profile, projectId, roadmapId })) {
        throw Object.assign(new Error("Response out of scope"), { code: 5063 });
      }
      return res;
    },
    enabled,
    refetchInterval: config_default.query.snapshotRefetchMs
  });
}
function useRoadmapBoard(profile, projectId, roadmapId, enabled) {
  return useQuery({
    queryKey: [ID, "board", profile, projectId, roadmapId],
    queryFn: async () => {
      const res = await host2.request(RPC.board, { profile, project_id: projectId, roadmap_id: roadmapId });
      if (!assertResponseScope(res, { profile, projectId, roadmapId })) {
        throw Object.assign(new Error("Response out of scope"), { code: 5063 });
      }
      return res;
    },
    enabled,
    refetchInterval: config_default.query.boardRefetchMs
  });
}
function useRoadmapPlanBattery(profile, projectId, roadmapId, version, enabled) {
  return useQuery({
    queryKey: [ID, "plan-battery", profile, projectId, roadmapId, version],
    queryFn: async () => host2.request(RPC.plans_check, { profile, project_id: projectId, roadmap_id: roadmapId, version }),
    enabled,
    refetchInterval: config_default.query.boardRefetchMs
  });
}
function useRoadmapTeamBattery(profile, projectId, roadmapId, version, enabled) {
  return useQuery({
    queryKey: [ID, "team-battery", profile, projectId, roadmapId, version],
    queryFn: async () => host2.request(RPC.team_check, { profile, project_id: projectId, roadmap_id: roadmapId, version }),
    enabled,
    refetchInterval: config_default.query.boardRefetchMs
  });
}
function useRoadmapReadinessBattery(profile, projectId, roadmapId, version, enabled) {
  return useQuery({
    queryKey: [ID, "readiness-battery", profile, projectId, roadmapId, version],
    queryFn: async () => host2.request(RPC.readiness_check, { profile, project_id: projectId, roadmap_id: roadmapId, version }),
    enabled,
    refetchInterval: config_default.query.boardRefetchMs
  });
}
function useRoadmapTeam(profile, projectId, roadmapId, version, enabled) {
  return useQuery({
    queryKey: [ID, "team", profile, projectId, roadmapId, version],
    queryFn: async () => {
      const [team, battery] = await Promise.all([
        host2.request(RPC.team_list, { profile, project_id: projectId, roadmap_id: roadmapId, version }),
        host2.request(RPC.team_check, { profile, project_id: projectId, roadmap_id: roadmapId, version })
      ]);
      if (!assertResponseScope(team, { profile, projectId, roadmapId })) {
        throw Object.assign(new Error("Response out of scope"), { code: 5063 });
      }
      return { workers: team.workers ?? [], assignments: team.assignments ?? [], battery: battery ?? { ok: false, failures: [] } };
    },
    enabled,
    refetchInterval: config_default.query.boardRefetchMs
  });
}
function useRoadmapReadiness(profile, projectId, roadmapId, version, enabled) {
  return useQuery({
    queryKey: [ID, "readiness", profile, projectId, roadmapId, version],
    queryFn: async () => {
      const [rd, battery] = await Promise.all([
        host2.request(RPC.readiness_list, { profile, project_id: projectId, roadmap_id: roadmapId, version }),
        host2.request(RPC.readiness_check, { profile, project_id: projectId, roadmap_id: roadmapId, version })
      ]);
      if (!assertResponseScope(rd, { profile, projectId, roadmapId })) {
        throw Object.assign(new Error("Response out of scope"), { code: 5063 });
      }
      return { items: rd.items ?? [], battery: battery ?? { ok: false, failures: [] } };
    },
    enabled,
    refetchInterval: config_default.query.boardRefetchMs
  });
}
function useScopeState(profile, projects, roadmaps) {
  const [projectId, setProjectId] = usePersistedState(`roadmaps:${profile}:projectId`, "");
  const projectItems = useMemo(() => projectSelectorItems(projects), [projects]);
  const projectIds = useMemo(() => projectItems.map((p) => p.id), [projectItems]);
  const projectNameById = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    for (const p of projectItems) m.set(p.id, p.name || p.id);
    return m;
  }, [projectItems]);
  const roadmapOptions = useMemo(
    () => projectId === "" ? [] : roadmapSelectorItems(roadmaps, projectId),
    [roadmaps, projectId]
  );
  const roadmapId = roadmapOptions.length > 0 ? roadmapOptions[0].roadmap_id : "";
  useEffect2(() => {
    if (projectId !== "" && !projectIds.includes(projectId)) setProjectId("");
  }, [projectIds, projectId]);
  return { projectId, setProjectId, roadmapId, projectNameById, projects: projectItems, roadmapOptions };
}
function useNodeSelection(scopeIdentity, version) {
  const [selectedNodeId, setSelectedNodeId] = useState2("");
  useEffect2(() => {
    setSelectedNodeId("");
  }, scopeIdentity);
  useEffect2(() => {
    if (selectedNodeId !== "" && version && !version.nodes.some((n) => n.node_id === selectedNodeId)) {
      setSelectedNodeId("");
    }
  }, [version, selectedNodeId]);
  const onSelect = useCallback((nodeId) => {
    setSelectedNodeId((cur) => cur === nodeId ? "" : nodeId);
  }, []);
  return { selectedNodeId, setSelectedNodeId, onSelect };
}

// src/scope.js
import { useState as useState4 } from "react";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
import { Button as Button2, Codicon as Codicon2, CopyButton as CopyButton2, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tip } from "@hermes/plugin-sdk";

// src/scope-actions.js
import { useCallback as useCallback2, useState as useState3 } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  Button,
  Codicon,
  ConfirmDialog,
  CopyButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  host as host3,
  useQueryClient
} from "@hermes/plugin-sdk";
function FormError({ error }) {
  if (!error) return null;
  const ec = mutationErrorCopy(error);
  if (!ec) return null;
  return jsxs("div", {
    className: "flex items-start gap-1.5 rounded-[3px] bg-destructive/10 px-2 py-1 text-xs text-destructive",
    children: [
      jsx(Codicon, { name: "error", size: "0.75rem", className: "mt-px shrink-0" }),
      jsxs("span", { children: [ec.hint, ec.code != null ? ` (code ${ec.code})` : ""] })
    ]
  });
}
function ProjectCreateForm({ onCreated, onCancel }) {
  const [name, setName] = useState3("");
  const [busy, setBusy] = useState3(false);
  const [error, setError] = useState3(null);
  const queryClient = useQueryClient();
  const submit = useCallback2(async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await projectCreate(trimmed);
      await queryClient.invalidateQueries({ queryKey: [ID, "projects"] });
      host3.notify({ kind: "success", title: "Project created", message: `Created "${trimmed}".` });
      onCreated(res?.project?.id ?? "");
    } catch (err) {
      setError({ code: rpcError(err).code });
    } finally {
      setBusy(false);
    }
  }, [busy, name, onCreated, queryClient]);
  return jsxs("div", {
    className: "flex flex-col gap-1 px-0.5",
    children: [
      jsxs("div", {
        className: "flex items-center gap-1.5",
        children: [
          jsx(Input, {
            value: name,
            onChange: (ev) => setName(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === "Enter") void submit();
              if (ev.key === "Escape") onCancel();
            },
            placeholder: "Project name\u2026",
            autoFocus: true,
            disabled: busy,
            className: "h-6 w-48 px-1.5 text-xs",
            "aria-label": "New project name"
          }),
          jsx(Button, {
            type: "button",
            size: "xs",
            variant: "secondary",
            onClick: () => void submit(),
            disabled: busy || name.trim() === "",
            children: "Create"
          }),
          jsx(Button, {
            type: "button",
            size: "xs",
            variant: "ghost",
            onClick: onCancel,
            disabled: busy,
            children: "Cancel"
          })
        ]
      }),
      jsx(FormError, { error })
    ]
  });
}
function ProjectRenameForm({ projectId, currentName, onRenamed, onCancel }) {
  const [name, setName] = useState3(currentName);
  const [busy, setBusy] = useState3(false);
  const [error, setError] = useState3(null);
  const queryClient = useQueryClient();
  const submit = useCallback2(async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed === "") return;
    setBusy(true);
    setError(null);
    try {
      await projectUpdate(projectId, trimmed);
      await queryClient.invalidateQueries({ queryKey: [ID, "projects"] });
      host3.notify({ kind: "success", title: "Project renamed", message: `Renamed to "${trimmed}".` });
      onRenamed();
    } catch (err) {
      setError({ code: rpcError(err).code });
    } finally {
      setBusy(false);
    }
  }, [busy, name, onRenamed, projectId, queryClient]);
  return jsxs("div", {
    className: "flex flex-col gap-1 px-0.5",
    children: [
      jsxs("div", {
        className: "flex items-center gap-1.5",
        children: [
          jsx(Input, {
            value: name,
            onChange: (ev) => setName(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === "Enter") void submit();
              if (ev.key === "Escape") onCancel();
            },
            placeholder: "Project name\u2026",
            autoFocus: true,
            disabled: busy,
            className: "h-6 w-48 px-1.5 text-xs",
            "aria-label": "Rename project"
          }),
          jsx(Button, {
            type: "button",
            size: "xs",
            variant: "secondary",
            onClick: () => void submit(),
            disabled: busy || name.trim() === "",
            children: "Save"
          }),
          jsx(Button, {
            type: "button",
            size: "xs",
            variant: "ghost",
            onClick: onCancel,
            disabled: busy,
            children: "Cancel"
          })
        ]
      }),
      jsx(FormError, { error })
    ]
  });
}
function ProjectMenu({ projectId, projectName, onRequestRename, onArchived }) {
  const [confirmOpen, setConfirmOpen] = useState3(false);
  const [busy, setBusy] = useState3(false);
  const queryClient = useQueryClient();
  const archive = useCallback2(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await projectArchive(projectId);
      await queryClient.invalidateQueries({ queryKey: [ID, "projects"] });
      setConfirmOpen(false);
      host3.notify({ kind: "success", title: "Project archived", message: `Archived "${projectName}".` });
      onArchived();
    } catch (err) {
      const ec = mutationErrorCopy({ code: rpcError(err).code });
      throw new Error(ec.hint);
    } finally {
      setBusy(false);
    }
  }, [busy, onArchived, projectId, projectName, queryClient]);
  const hasProject = projectId !== "";
  return jsxs("div", {
    className: "flex items-center gap-1.5",
    children: [
      jsx(DropdownMenu, {
        children: [
          jsx(DropdownMenuTrigger, {
            asChild: true,
            children: jsx(Button, {
              type: "button",
              variant: "ghost",
              size: "icon-xs",
              className: "data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground",
              "aria-label": "Project actions",
              disabled: !hasProject,
              children: jsx(Codicon, { name: "ellipsis", size: "0.8rem" })
            })
          }),
          jsx(DropdownMenuContent, {
            align: "end",
            sideOffset: 4,
            className: "w-44",
            children: [
              jsx(DropdownMenuItem, {
                onSelect: onRequestRename,
                disabled: !hasProject,
                children: [jsx(Codicon, { name: "edit", size: "0.75rem" }), "Rename"]
              }),
              jsx(CopyButton, { appearance: "menu-item", text: projectId, label: "Copy ID", disabled: !hasProject }),
              jsx(DropdownMenuSeparator, {}),
              jsx(DropdownMenuItem, {
                variant: "destructive",
                disabled: !hasProject,
                onSelect: () => setConfirmOpen(true),
                children: [jsx(Codicon, { name: "archive", size: "0.75rem" }), "Archive"]
              })
            ]
          })
        ]
      }),
      jsx(ConfirmDialog, {
        open: confirmOpen,
        onClose: () => {
          if (!busy) setConfirmOpen(false);
        },
        onConfirm: archive,
        title: "Archive project",
        description: `Archive "${projectName}"? The project leaves the selector; its roadmaps stay on the backend.`,
        confirmLabel: "Archive",
        cancelLabel: "Cancel",
        destructive: true
      })
    ]
  });
}

// src/scope.js
function ScopeBar({
  profile,
  projectId,
  setProjectId,
  setSelectedNodeId,
  projects,
  projectNameById,
  compact,
  roadmapsCount,
  projectsError,
  onRetryProjects,
  follow,
  onToggleFollow
}) {
  const [projectCreateOpen, setProjectCreateOpen] = useState4(false);
  const [projectRenameOpen, setProjectRenameOpen] = useState4(false);
  const selectProject = (v) => {
    setProjectId(v);
    setSelectedNodeId("");
  };
  const currentName = projectNameById.get(projectId) || projectId;
  return jsxs2("div", {
    className: "flex flex-col gap-1",
    children: [
      jsxs2("div", {
        className: "flex flex-wrap items-center gap-2 px-0.5",
        children: [
          // Tip→TooltipTrigger uses Radix Slot (asChild): children MUST be a
          // single React element — jsx(), never jsxs() with an array of one.
          jsx2(Tip, {
            label: "Active profile (read-only)",
            children: jsx2("span", {
              className: "inline-flex items-center gap-1.5 rounded-[3px] bg-(--ui-bg-quaternary) px-2 py-1 font-mono text-[0.625rem] text-(--ui-text-secondary)",
              children: [jsx2(Codicon2, { name: "account", size: "0.7rem" }), profile]
            })
          }),
          jsxs2("div", {
            className: "flex items-center gap-1",
            children: [
              jsxs2("span", { className: "text-[0.625rem] text-(--ui-text-tertiary)", children: ["Project"] }),
              jsx2(Select, {
                value: projectId,
                onValueChange: selectProject,
                children: [
                  jsx2(SelectTrigger, {
                    className: "h-7 w-40 text-xs",
                    "aria-label": "Project",
                    children: jsx2(SelectValue, { placeholder: "select\u2026" })
                  }),
                  jsx2(SelectContent, {
                    children: projects.length === 0 ? jsx2(SelectItem, { value: "__none__", disabled: true, children: "No projects" }) : projects.map((p) => jsx2(SelectItem, { value: p.id, children: p.name || p.id }, p.id))
                  })
                ]
              }),
              // follow toggle — track the app's active project (sidebar).
              jsx2(Button2, {
                type: "button",
                variant: "ghost",
                size: "icon-xs",
                "aria-label": follow ? "Stop following active project" : "Follow active project",
                title: follow ? "Stop following the active project" : "Follow the active project",
                onClick: onToggleFollow,
                className: follow ? "text-primary" : "text-(--ui-text-tertiary)",
                children: jsx2(Codicon2, { name: "arrow-right", size: "0.8rem" })
              }),
              // "+" — inline create form (projects.create).
              jsx2(Button2, {
                type: "button",
                variant: "ghost",
                size: "icon-xs",
                "aria-label": "Create project",
                onClick: () => setProjectCreateOpen((v) => !v),
                children: jsx2(Codicon2, { name: "add", size: "0.8rem" })
              }),
              // "⋮" — project management menu (rename / archive / copy id).
              jsx2(ProjectMenu, {
                projectId,
                projectName: currentName,
                onRequestRename: () => setProjectRenameOpen(true),
                onArchived: () => {
                  setProjectRenameOpen(false);
                  setProjectCreateOpen(false);
                }
              }),
              projectId !== "" ? jsx2(CopyButton2, {
                appearance: "icon",
                buttonSize: "icon-xs",
                buttonVariant: "ghost",
                text: projectId,
                title: "Copy project ID",
                label: "Copy project ID"
              }) : null
            ]
          }),
          // projects.list failure — compact inline error with retry.
          projectsError ? jsxs2("span", {
            className: "flex items-center gap-1 text-[0.625rem] text-destructive",
            children: [
              jsx2(Codicon2, { name: "error", size: "0.7rem" }),
              jsx2("span", { className: "max-w-40 truncate", children: projectsError.hint }),
              jsx2(Button2, { type: "button", size: "xs", variant: "ghost", onClick: onRetryProjects, children: "Retry" })
            ]
          }) : null,
          compact ? null : jsx2("span", {
            className: "ml-auto text-[0.625rem] text-(--ui-text-tertiary)",
            children: `${plural(roadmapsCount, "roadmap")} \xB7 profile ${profile}`
          })
        ]
      }),
      projectCreateOpen ? jsx2(ProjectCreateForm, { onCreated: selectProject, onCancel: () => setProjectCreateOpen(false) }) : null,
      projectRenameOpen ? jsx2(ProjectRenameForm, {
        projectId,
        currentName,
        onRenamed: () => setProjectRenameOpen(false),
        onCancel: () => setProjectRenameOpen(false)
      }) : null
    ]
  });
}

// src/copilot.js
import { useMemo as useMemo2 } from "react";
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
import { Codicon as Codicon3, StatusDot as StatusDot2, cn } from "@hermes/plugin-sdk";

// src/ui.js
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
import { StatusDot } from "@hermes/plugin-sdk";
var NODE_TONE = config_default.states.tone;
var NODE_STATE_LABEL = config_default.states.label;
function ProgressBar({ value }) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return jsxs3("span", {
    className: "inline-flex items-center gap-1.5",
    children: [
      jsxs3("span", {
        className: "h-1 w-14 overflow-hidden rounded-full bg-(--ui-stroke-secondary)",
        children: [jsx3("span", { className: "h-full rounded-full bg-primary transition-all", style: { width: `${pct}%` } })]
      }),
      jsx3("span", { className: "text-[0.625rem] tabular-nums text-(--ui-text-quaternary)", children: `${pct}%` })
    ]
  });
}
function SectionTitle({ children, right }) {
  return jsxs3("div", {
    className: "flex items-center justify-between gap-2 px-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)",
    children: [jsx3("span", { className: "truncate", children }), right ?? null]
  });
}
function NodeStateTag({ state }) {
  return jsxs3("span", {
    className: "inline-flex items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)",
    children: [jsx3(StatusDot, { tone: NODE_TONE[state] ?? "muted" }), NODE_STATE_LABEL[state] ?? state]
  });
}
function BatteryBadge({ battery, label }) {
  const failures = battery?.failures ?? [];
  const ok = battery?.ok === true;
  const count = failures.length;
  return jsxs3("div", {
    className: "flex flex-col gap-1 px-0.5",
    children: [
      jsxs3("span", {
        className: "inline-flex items-center gap-1.5 text-[0.625rem]",
        children: [
          jsx3(StatusDot, { tone: ok ? "good" : "bad" }),
          jsx3("span", { className: "text-(--ui-text-secondary)", children: label }),
          jsx3("span", {
            className: ok ? "text-(--ui-text-quaternary)" : "text-destructive",
            children: ok ? "ready" : `${count} ${count === 1 ? "failure" : "failures"}`
          })
        ]
      }),
      count === 0 ? null : jsxs3("div", {
        className: "flex flex-col gap-0.5 pl-3.5",
        children: failures.map(
          (f) => jsxs3("div", { className: "flex flex-col", children: [
            jsx3("span", { className: "font-mono text-[0.625rem] text-destructive", children: f.code }),
            f.hint ? jsx3("span", { className: "text-[0.625rem] text-(--ui-text-tertiary)", children: f.hint }) : null
          ] }, f.code)
        )
      })
    ]
  });
}

// src/copilot.js
var NEXT_ACTION_LABEL = config_default.nextActionLabel;
function CopilotChip({ node, selected, onSelect }) {
  return jsx4("button", {
    type: "button",
    onClick: () => onSelect(node.node_id),
    title: `${node.kind} \xB7 ${node.state}`,
    className: cn(
      "inline-flex min-w-0 max-w-full items-center gap-1 truncate rounded-[3px] px-1.5 py-0.5 text-[0.6875rem] transition-colors",
      selected ? "bg-primary/10 text-primary" : "text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground"
    ),
    children: [jsx4(StatusDot2, { tone: NODE_TONE[node.state] ?? "muted" }), jsx4("span", { className: "truncate", children: nodeLabel(node) })]
  });
}
function CopilotChips({ nodes, selectedId, onSelect, dense }) {
  const shown = nodes.slice(0, dense ? 2 : 3);
  const extra = nodes.length - shown.length;
  return jsxs4("span", {
    className: "flex min-w-0 flex-wrap items-center gap-1",
    children: [
      ...shown.map((n) => jsx4(CopilotChip, { node: n, selected: n.node_id === selectedId, onSelect }, n.node_id)),
      extra > 0 ? jsx4("span", { className: "text-[0.625rem] text-(--ui-text-quaternary)", children: `+${extra}` }, "__extra__") : null
    ]
  });
}
function NextActionRow({ action, selected, onSelect }) {
  if (!action) return null;
  const { node, kind, pending } = action;
  let detail;
  if (kind === "unblock") detail = "Blocked \u2014 dependencies satisfied";
  else if (kind === "claim") detail = "Ready \u2014 dependencies satisfied";
  else if (kind === "advance") detail = node.state === "in_progress" ? `In flight${node.owner_agent ? ` \xB7 ${node.owner_agent}` : ""}` : "Ready \u2014 dependencies satisfied";
  else if (kind === "assign") detail = "In progress without an owner";
  else detail = `Waiting on ${plural(pending, "pending dependency")}`;
  return jsxs4("div", {
    className: "flex items-center gap-1.5 text-[0.6875rem]",
    children: [
      jsxs4("span", {
        className: "inline-flex shrink-0 items-center gap-1 font-medium uppercase tracking-wide text-(--ui-text-tertiary)",
        children: [jsx4(Codicon3, { name: "target", size: "0.7rem" }), "Next action"]
      }),
      jsx4("button", {
        type: "button",
        onClick: () => onSelect(node.node_id),
        className: cn(
          "inline-flex min-w-0 max-w-full items-center gap-1 rounded-[3px] px-1.5 py-0.5 transition-colors",
          selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-(--chrome-action-hover)"
        ),
        children: [
          jsx4(StatusDot2, { tone: NODE_TONE[node.state] ?? "muted" }),
          jsx4("span", { className: "font-medium", children: NEXT_ACTION_LABEL[kind] ?? kind }),
          jsx4("span", { className: "truncate", children: nodeLabel(node) }),
          jsx4("span", { className: "text-(--ui-text-tertiary)", children: ["\xB7 ", detail] })
        ]
      })
    ]
  });
}
function CopilotBar({ version, selectedId, onSelect, dense }) {
  const sections = useMemo2(() => copilotSections(version), [version]);
  const action = useMemo2(() => nextAction(version), [version]);
  const groups = (sections ? [
    { key: "now", label: "Now", codicon: "play", nodes: sections.now },
    { key: "inflight", label: "In flight", codicon: "list-ordered", nodes: sections.inflight },
    { key: "waiting", label: "Waiting", codicon: "hourglass", nodes: sections.waiting },
    { key: "blocked", label: "Blocked", codicon: "debug-disconnect", nodes: sections.blocked }
  ] : []).filter((g) => g.nodes.length > 0);
  if (!action && groups.length === 0) {
    return jsx4("div", {
      className: "px-0.5 text-xs text-(--ui-text-tertiary)",
      children: "Nothing actionable \u2014 every node is resolved or not ready yet."
    });
  }
  return jsxs4("div", {
    className: "flex flex-col gap-1",
    children: [
      jsx4(NextActionRow, { action, selected: action ? action.node.node_id === selectedId : false, onSelect }),
      groups.length > 0 ? jsxs4("div", {
        className: "flex flex-wrap items-center gap-x-4 gap-y-1.5",
        children: groups.map(
          (g, i) => jsxs4(
            "div",
            {
              className: cn("flex min-w-0 items-center gap-1.5", i > 0 && "border-l border-(--ui-stroke-tertiary) pl-4"),
              children: [
                jsxs4("span", {
                  className: "flex shrink-0 items-center gap-1 text-[0.625rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)",
                  children: [jsx4(Codicon3, { name: g.codicon, size: "0.7rem" }), g.label]
                }),
                jsx4("span", { className: "text-[0.625rem] tabular-nums text-(--ui-text-quaternary)", children: g.nodes.length }),
                jsx4(CopilotChips, { nodes: g.nodes, selectedId, onSelect, dense })
              ]
            },
            g.key
          )
        )
      }) : null
    ]
  });
}

// src/views/fil.js
import { useCallback as useCallback3, useMemo as useMemo3 } from "react";
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
import { Codicon as Codicon4, EmptyState, StatusDot as StatusDot3, cn as cn2 } from "@hermes/plugin-sdk";
function CriticalChainStrip({ chain, version, selectedId, onSelect }) {
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]));
  const ordered = [...chain].reverse();
  const parts = [];
  ordered.forEach((id, i) => {
    if (i > 0) {
      parts.push(jsx5(Codicon4, { name: "chevron-right", size: "0.6rem", className: "shrink-0 text-(--ui-text-quaternary)" }, `sep-${i}`));
    }
    parts.push(
      jsx5(
        "button",
        {
          type: "button",
          onClick: () => onSelect(id),
          title: nodeLabel(byId.get(id)),
          className: cn2(
            "min-w-0 max-w-44 truncate hover:underline",
            id === selectedId ? "font-medium text-primary" : "text-(--ui-text-secondary) hover:text-foreground"
          ),
          children: nodeLabel(byId.get(id))
        },
        id
      )
    );
  });
  return jsxs5("div", {
    className: "flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-[3px] bg-(--ui-bg-quaternary) px-2 py-1 text-[0.625rem]",
    children: [
      jsx5("span", { className: "mr-1 font-medium uppercase tracking-wide text-(--ui-text-tertiary)", children: "Critical path" }),
      ...parts
    ]
  });
}
function NodeRow({ node, version, selected, onSelect, compact, dense }) {
  const onClick = useCallback3(() => onSelect(node.node_id), [node.node_id, onSelect]);
  const deps = useMemo3(() => nodeDepsInfo(node, version), [node, version]);
  const dependants = useMemo3(() => nodeDependants(node, version), [node, version]);
  const blockers = useMemo3(() => nodeBlockers(node, version), [node, version]);
  const pendingCount = deps.total - deps.satisfied;
  if (dense) {
    return jsxs5("button", {
      type: "button",
      onClick,
      className: cn2(
        "group flex w-full items-center gap-2 px-2 py-1 text-left transition-colors",
        selected ? "bg-primary/[0.06]" : "hover:bg-(--chrome-action-hover)"
      ),
      children: [
        jsx5(StatusDot3, { tone: NODE_TONE[node.state] ?? "muted" }),
        jsxs5("span", {
          className: "min-w-0 flex-1 truncate text-xs font-medium",
          children: [
            jsx5("span", { className: cn2("text-[0.625rem]", selected ? "text-primary" : "text-(--ui-text-tertiary)"), children: `${node.kind} \xB7 ` }),
            nodeLabel(node)
          ]
        }),
        jsx5(NodeStateTag, { state: node.state }),
        jsx5(ProgressBar, { value: node.progress })
      ]
    });
  }
  return jsxs5("button", {
    type: "button",
    onClick,
    className: cn2(
      "group flex w-full flex-col gap-1 px-2 py-1.5 text-left transition-colors",
      selected ? "bg-primary/[0.06]" : "hover:bg-(--chrome-action-hover)"
    ),
    children: [
      jsxs5("div", {
        className: "flex items-center gap-2",
        children: [
          jsx5(StatusDot3, { tone: NODE_TONE[node.state] ?? "muted" }),
          jsxs5("span", {
            className: "min-w-0 flex-1 truncate text-xs font-medium",
            children: [
              jsx5("span", { className: cn2("text-[0.625rem]", selected ? "text-primary" : "text-(--ui-text-tertiary)"), children: `${node.kind} \xB7 ` }),
              nodeLabel(node)
            ]
          }),
          !compact ? jsx5(NodeStateTag, { state: node.state }) : null
        ]
      }),
      !compact ? jsxs5("div", {
        className: "flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-3.5",
        children: [
          deps.total > 0 ? pendingCount === 0 ? jsxs5("span", {
            className: "inline-flex items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)",
            children: [jsx5(Codicon4, { name: "check", size: "0.65rem" }), `${deps.satisfied}/${deps.total} deps satisfied`]
          }) : jsxs5("span", {
            className: "inline-flex items-center gap-1 text-[0.625rem] text-amber-500/90 dark:text-amber-300/90",
            title: deps.deps.filter((d) => !d.satisfied).map((d) => nodeLabel(d.target) || d.targetId).join(", "),
            children: [jsx5(Codicon4, { name: "hourglass", size: "0.65rem" }), `${plural(pendingCount, "pending dep")}`]
          }) : null,
          blockers.length > 0 ? jsxs5("span", {
            className: "inline-flex items-center gap-1 text-[0.625rem] text-destructive",
            children: [jsx5(Codicon4, { name: "debug-disconnect", size: "0.65rem" }), `${plural(blockers.length, "blocker")}`]
          }) : null,
          dependants.length > 0 ? jsxs5("span", {
            className: "inline-flex items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)",
            children: [jsx5(Codicon4, { name: "arrow-down", size: "0.65rem" }), `${plural(dependants.length, "dependant")}`]
          }) : null,
          jsxs5("span", {
            className: "ml-auto flex shrink-0 items-center gap-2",
            children: [
              jsx5(ProgressBar, { value: node.progress }),
              node.owner_agent ? jsxs5("span", {
                className: "inline-flex min-w-0 max-w-32 items-center gap-1 truncate text-[0.625rem] text-(--ui-text-tertiary)",
                children: [jsx5(Codicon4, { name: "person", size: "0.65rem" }), jsx5("span", { className: "truncate", children: node.owner_agent })]
              }) : null
            ]
          })
        ]
      }) : null,
      node.state === "blocked" && node.block_reason ? jsxs5("div", {
        className: "flex items-start gap-1 pl-3.5 text-[0.625rem] text-destructive",
        children: [
          jsx5(Codicon4, { name: "debug-disconnect", size: "0.7rem", className: "mt-px shrink-0" }),
          jsx5("span", { className: "whitespace-pre-wrap break-words", children: node.block_reason })
        ]
      }) : null
    ]
  });
}
function ThreadView({ version, selectedId, onSelect, compact, dense }) {
  const nodes = threadNodes(version);
  const chain = useMemo3(() => criticalChain(version), [version]);
  if (nodes.length === 0) {
    return jsx5(EmptyState, {
      title: "Nothing in flight",
      description: "No ready, in_progress, or blocked nodes in the active version of this roadmap."
    });
  }
  return jsxs5("div", {
    className: "flex flex-col gap-1.5",
    children: [
      chain.length > 1 ? jsx5(CriticalChainStrip, { chain, version, selectedId, onSelect }) : null,
      jsx5(SectionTitle, {
        right: jsx5("span", { className: "tabular-nums text-(--ui-text-quaternary)", children: plural(nodes.length, "node") }),
        children: "Thread"
      }),
      jsxs5("div", {
        className: "flex flex-col divide-y divide-(--ui-stroke-tertiary)",
        children: nodes.map((n) => jsx5(NodeRow, { node: n, version, selected: n.node_id === selectedId, onSelect, compact, dense }, n.node_id))
      })
    ]
  });
}

// src/views/map.js
import { useCallback as useCallback5, useMemo as useMemo4, useState as useState5 } from "react";
import { jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
import { Codicon as Codicon6, EmptyState as EmptyState3, cn as cn4 } from "@hermes/plugin-sdk";

// src/views/board.js
import { useCallback as useCallback4 } from "react";
import { jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
import { Button as Button3, Codicon as Codicon5, EmptyState as EmptyState2, ErrorState, Skeleton, StatusDot as StatusDot4, cn as cn3 } from "@hermes/plugin-sdk";
var CARD_TONE = config_default.board.cardTone;
function CardTag({ card }) {
  if (!card || card.found !== true) {
    return jsx6("span", {
      className: "inline-flex items-center text-[0.625rem] text-(--ui-text-quaternary)",
      children: "no card"
    });
  }
  return jsxs6("span", {
    className: "inline-flex items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)",
    children: [jsx6(StatusDot4, { tone: CARD_TONE[card.status] ?? "muted" }), jsx6("span", { children: card.status })]
  });
}
function WorkerTag({ worker }) {
  if (!worker) return null;
  const label = worker.lane ? worker.model ? `${worker.lane} \xB7 ${worker.model}` : worker.lane : worker.worker_id;
  return jsxs6("span", {
    className: "inline-flex min-w-0 items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)",
    children: [jsx6(Codicon5, { name: "person", size: "0.65rem" }), jsx6("span", { className: "truncate", children: label })]
  });
}
function TodoRow({ todo }) {
  return jsxs6("div", {
    className: "flex flex-col gap-0.5 py-0.5",
    children: [
      jsxs6("div", {
        className: "flex flex-wrap items-center gap-x-2 gap-y-0.5",
        children: [
          jsx6("span", { className: "min-w-0 flex-1 truncate text-xs", children: todo.todo.title }),
          jsx6(CardTag, { card: todo.card }),
          jsx6(WorkerTag, { worker: todo.worker })
        ]
      }),
      todo.todo.acceptance ? jsx6("div", { className: "truncate text-[0.625rem] text-(--ui-text-quaternary)", children: todo.todo.acceptance }) : null
    ]
  });
}
function PhaseGroup({ phase, selectedId, onSelect }) {
  const onClick = useCallback4(() => onSelect(phase.phase.node_id), [phase.phase.node_id, onSelect]);
  return jsxs6("div", {
    className: "flex flex-col border-l border-(--ui-stroke-tertiary) pl-2",
    children: [
      jsxs6("button", {
        type: "button",
        onClick,
        className: cn3(
          "flex items-center gap-1.5 px-1 py-1 text-left transition-colors",
          phase.phase.node_id === selectedId ? "text-primary" : "text-(--ui-text-secondary) hover:text-foreground"
        ),
        children: [
          jsx6(Codicon5, { name: "chevron-right", size: "0.65rem", className: "shrink-0" }),
          jsx6("span", { className: "min-w-0 flex-1 truncate text-xs", children: nodeLabel(phase.phase) }),
          jsx6(NodeStateTag, { state: phase.phase.state })
        ]
      }),
      phase.todos.length === 0 ? jsx6("div", { className: "px-3 py-0.5 text-[0.625rem] text-(--ui-text-quaternary)", children: "No todos" }) : jsx6("div", {
        className: "flex flex-col pl-4",
        children: phase.todos.map((t) => jsx6(TodoRow, { todo: t }, t.todo.todo_id))
      })
    ]
  });
}
function MilestoneGroup({ milestone, selectedId, onSelect }) {
  const onClick = useCallback4(() => onSelect(milestone.milestone.node_id), [milestone.milestone.node_id, onSelect]);
  return jsxs6("div", {
    className: "flex flex-col",
    children: [
      jsxs6("button", {
        type: "button",
        onClick,
        className: cn3(
          "flex items-center gap-2 px-1 py-1.5 text-left transition-colors",
          milestone.milestone.node_id === selectedId ? "bg-primary/[0.06]" : "hover:bg-(--chrome-action-hover)"
        ),
        children: [
          jsx6(Codicon5, { name: "milestone", size: "0.7rem", className: "shrink-0 text-(--ui-text-tertiary)" }),
          jsx6("span", { className: "min-w-0 flex-1 truncate text-xs font-medium", children: nodeLabel(milestone.milestone) }),
          jsx6(NodeStateTag, { state: milestone.milestone.state })
        ]
      }),
      milestone.phases.length === 0 ? jsx6("div", { className: "px-2 py-0.5 text-[0.625rem] text-(--ui-text-quaternary)", children: "No phases" }) : jsx6("div", {
        className: "flex flex-col gap-1 pl-3",
        children: milestone.phases.map((p) => jsx6(PhaseGroup, { phase: p, selectedId, onSelect }, p.phase.node_id))
      })
    ]
  });
}
function BoardView({ scope, selectedId, onSelect }) {
  const query = useRoadmapBoard(scope.profile, scope.projectId, scope.roadmapId, true);
  const boardVersion = query.data?.version ?? null;
  const planBattery = useRoadmapPlanBattery(scope.profile, scope.projectId, scope.roadmapId, boardVersion, boardVersion != null);
  if (query.isLoading) {
    return jsx6(Skeleton, { className: "h-24 w-full" });
  }
  if (query.isError) {
    const err = errorCopy(query.error);
    return jsx6(ErrorState, {
      title: "Board unavailable",
      description: `${err.hint}${err.code != null ? ` (code ${err.code})` : ""}`,
      children: jsx6(Button3, {
        type: "button",
        size: "xs",
        variant: "secondary",
        onClick: () => void query.refetch(),
        children: "Retry"
      })
    });
  }
  const board = query.data;
  if (!board || board.found !== true) {
    return jsx6(EmptyState2, {
      title: "No roadmap for this scope",
      description: "The board is unavailable for the selected roadmap."
    });
  }
  if (board.version == null) {
    return jsx6(EmptyState2, {
      title: "No active version",
      description: "This roadmap has no active version to display."
    });
  }
  const milestones = board.milestones ?? [];
  const objective = board.objective;
  const todoCount = milestones.reduce((n, m) => n + m.phases.reduce((p, ph) => p + ph.todos.length, 0), 0);
  return jsxs6("div", {
    className: "flex flex-col gap-2",
    children: [
      jsx6(SectionTitle, {
        right: jsx6("span", { className: "tabular-nums text-(--ui-text-quaternary)", children: plural(todoCount, "todo") }),
        children: "Cartography"
      }),
      jsx6(BatteryBadge, { battery: planBattery.data, label: "Plan battery" }),
      objective ? jsxs6("div", {
        className: "flex flex-col gap-0.5 rounded-[3px] border border-(--ui-stroke-tertiary) px-2 py-1.5",
        children: [
          jsxs6("div", {
            className: "flex items-center gap-2",
            children: [
              jsx6(Codicon5, { name: "target", size: "0.7rem", className: "shrink-0 text-(--ui-text-tertiary)" }),
              jsx6("span", { className: "min-w-0 flex-1 truncate text-xs font-medium", children: nodeLabel(objective) }),
              jsx6(NodeStateTag, { state: objective.state })
            ]
          }),
          objective.description ? jsx6("div", { className: "truncate text-[0.625rem] text-(--ui-text-tertiary)", children: objective.description }) : null
        ]
      }) : null,
      milestones.length === 0 ? jsx6(EmptyState2, {
        title: "No milestones",
        description: "The active version contains no milestones to display."
      }) : jsx6("div", {
        className: "flex flex-col divide-y divide-(--ui-stroke-tertiary)",
        children: milestones.map((m) => jsx6(MilestoneGroup, { milestone: m, selectedId, onSelect }, m.milestone.node_id))
      })
    ]
  });
}

// src/views/map.js
var RELATION_LABEL = config_default.relation.label;
var RELATION_ICON = config_default.relation.icon;
function RelationRow({ rel, selectedNodeId, onSelect }) {
  const onFrom = useCallback5(() => onSelect(rel.from_node_id), [rel.from_node_id, onSelect]);
  const onTo = useCallback5(() => onSelect(rel.to_node_id), [rel.to_node_id, onSelect]);
  return jsxs7("div", {
    className: cn4(
      "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2 py-1.5 text-xs transition-colors",
      (rel.from_node_id === selectedNodeId || rel.to_node_id === selectedNodeId) && "bg-primary/[0.04]"
    ),
    children: [
      jsxs7("button", {
        type: "button",
        onClick: onFrom,
        className: cn4("min-w-0 truncate text-left hover:underline", rel.from_node_id === selectedNodeId ? "text-primary" : "text-foreground"),
        children: nodeLabel(rel.from)
      }),
      jsxs7("span", {
        className: "flex shrink-0 items-center gap-1 text-[0.625rem] uppercase tracking-wide text-(--ui-text-tertiary)",
        children: [jsx7(Codicon6, { name: RELATION_ICON[rel.kind] ?? "arrow-right", size: "0.65rem" }), RELATION_LABEL[rel.kind] ?? rel.kind]
      }),
      jsxs7("button", {
        type: "button",
        onClick: onTo,
        className: cn4("min-w-0 truncate text-right hover:underline", rel.to_node_id === selectedNodeId ? "text-primary" : "text-foreground"),
        children: nodeLabel(rel.to)
      })
    ]
  });
}
function MapView({ version, selectedId, onSelect, scope }) {
  const [showInactive, setShowInactive] = useState5(false);
  const rels = useMemo4(() => mapRelations(version, { includeInactive: showInactive }), [version, showInactive]);
  return jsxs7("div", {
    className: "flex flex-col gap-2",
    children: [
      jsx7(BoardView, { scope, selectedId, onSelect }),
      jsxs7("div", {
        className: "flex flex-col gap-1.5",
        children: [
          jsxs7(SectionTitle, {
            right: jsx7("button", {
              type: "button",
              onClick: () => setShowInactive((v) => !v),
              className: "rounded-[3px] px-1 text-[0.625rem] normal-case tracking-normal text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground",
              children: showInactive ? "active only" : "include inactive"
            }),
            children: ["Relations", ` (${rels.length})`]
          }),
          rels.length === 0 ? jsx7(EmptyState3, {
            title: showInactive ? "No relations" : "No active relations",
            description: "Each row is a canonical relation (depends on, blocks) of the active version."
          }) : jsxs7("div", {
            className: "flex flex-col divide-y divide-(--ui-stroke-tertiary)",
            children: rels.map((r) => jsx7(RelationRow, { rel: r, selectedNodeId: selectedId, onSelect }, r.relation_id))
          })
        ]
      })
    ]
  });
}

// src/views/plan.js
import { useCallback as useCallback6, useEffect as useEffect4, useState as useState8 } from "react";
import { jsx as jsx10, jsxs as jsxs10 } from "react/jsx-runtime";
import { Badge as Badge2, Button as Button6, Codicon as Codicon9, EmptyState as EmptyState4, cn as cn5, host as host5, useQueryClient as useQueryClient2, useValue } from "@hermes/plugin-sdk";

// src/views/vision.js
import { useState as useState6 } from "react";
import { jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
import * as SDK from "@hermes/plugin-sdk";
import { Button as Button4, Codicon as Codicon7 } from "@hermes/plugin-sdk";
var SessionSurface2 = SDK.SessionSurface;
function VisionLane({ session, collapsible = true }) {
  const [collapsed, setCollapsed] = useState6(false);
  if (typeof SessionSurface2 !== "function") {
    return jsx8("div", { className: "flex min-h-0 flex-1 flex-col" });
  }
  if (collapsible && collapsed) {
    return jsx8(Button4, {
      type: "button",
      variant: "ghost",
      size: "xs",
      onClick: () => setCollapsed(false),
      className: "justify-start gap-1 self-start",
      children: [jsx8(Codicon7, { name: "chevron-right", size: "0.7rem" }), "Vision"]
    });
  }
  return jsxs8("div", {
    className: "flex min-h-0 flex-1 flex-col",
    children: [
      collapsible ? jsxs8("div", {
        className: "flex items-center justify-between gap-2 border-b border-(--ui-stroke-tertiary) px-0.5 py-0.5",
        children: [
          jsx8("span", { className: "text-[0.625rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)", children: "Vision" }),
          jsx8(Button4, {
            type: "button",
            variant: "ghost",
            size: "xs",
            onClick: () => setCollapsed(true),
            title: "Collapse the Vision chat",
            className: "gap-1",
            children: jsx8(Codicon7, { name: "arrow-down", size: "0.7rem" })
          })
        ]
      }) : null,
      jsx8(SessionSurface2, { session })
    ]
  });
}

// src/views/plan-draft.js
import { useEffect as useEffect3, useMemo as useMemo5, useState as useState7 } from "react";
import { jsx as jsx9, jsxs as jsxs9 } from "react/jsx-runtime";
import { Badge, Button as Button5, Codicon as Codicon8, host as host4 } from "@hermes/plugin-sdk";
function useVisionDraft(visionSid) {
  const [draftText, setDraftText] = useState7("");
  const [error, setError] = useState7(null);
  useEffect3(() => {
    if (!visionSid) return void 0;
    const offDelta = host4.onEvent("message.delta", (ev) => {
      if (ev.session_id !== visionSid) return;
      const text = ev.payload?.text;
      if (typeof text === "string" && text !== "") setDraftText((cur) => cur + text);
    });
    const offComplete = host4.onEvent("message.complete", (ev) => {
      if (ev.session_id !== visionSid) return;
      if (ev.payload?.status === "error") {
        setError((cur) => cur || { code: null, hint: "The Vision session ended with an error before a plan draft was produced." });
      }
    });
    return () => {
      offDelta();
      offComplete();
    };
  }, [visionSid]);
  const preview = useMemo5(() => {
    if (!draftText.trim()) return null;
    const block = extractPlanJsonBlock(draftText);
    return block ? planPreviewFromJson(block) : null;
  }, [draftText]);
  return { draftText, preview, error, reset: () => setDraftText("") };
}
var KIND_ICON = {
  objective: "target",
  milestone: "milestone",
  phase: "chevron-right",
  decision: "law"
};
function buildTree(nodes) {
  const byId = /* @__PURE__ */ new Map();
  for (const n of nodes) byId.set(n.node_id, { node: n, children: [] });
  const roots = [];
  for (const n of nodes) {
    const entry = byId.get(n.node_id);
    const parent = n.parent_node_id ? byId.get(n.parent_node_id) : null;
    if (parent) parent.children.push(entry);
    else roots.push(entry);
  }
  return roots;
}
function DraftNode({ node, children }) {
  return jsxs9("div", {
    className: "flex flex-col",
    children: [
      jsxs9("div", {
        className: "flex items-center gap-1.5 px-1 py-0.5",
        children: [
          jsx9(Codicon8, { name: KIND_ICON[node.kind] ?? "circle-outline", size: "0.7rem", className: "shrink-0 text-(--ui-text-tertiary)" }),
          jsx9("span", { className: "min-w-0 flex-1 truncate text-xs", children: node.title || node.node_id }),
          node.kind ? jsx9(Badge, { size: "xs", variant: "outline", children: node.kind }) : null
        ]
      }),
      children.length > 0 ? jsx9("div", {
        className: "ml-2 flex flex-col border-l border-(--ui-stroke-tertiary) pl-3",
        children: children.map((c) => jsx9(DraftNode, { node: c.node, children: c.children }, c.node.node_id))
      }) : null
    ]
  });
}
function PlanDraftLive({ preview, draftText, activeSessionId, visionSid, saveBusy, onSave }) {
  const hasPreview = preview !== null;
  const roots = hasPreview ? buildTree(preview.nodes) : [];
  return jsxs9("div", {
    className: "flex min-h-0 flex-col gap-1",
    children: [
      jsx9(SectionTitle, {
        right: jsx9(Button5, {
          type: "button",
          size: "xs",
          variant: "secondary",
          onClick: onSave,
          disabled: !hasPreview || saveBusy,
          className: "gap-1",
          children: [jsx9(Codicon8, { name: "pass-filled", size: "0.7rem" }), saveBusy ? "Saving\u2026" : "Save plan"]
        }),
        children: "Plan draft"
      }),
      hasPreview ? jsxs9("div", {
        className: "flex min-h-0 flex-col gap-1",
        children: [
          jsx9("div", { className: "truncate text-xs font-medium", children: preview.title || "Draft plan" }),
          jsx9("div", {
            className: "flex flex-wrap items-center gap-1.5 text-[0.625rem] text-(--ui-text-quaternary)",
            children: `${plural(preview.counts.nodes, "node")} \xB7 ${plural(preview.counts.relations, "relation")} \xB7 ${plural(preview.counts.todos, "todo")}`
          }),
          roots.length > 0 ? jsx9("div", {
            className: "flex flex-col gap-0.5 overflow-auto",
            children: roots.map((r) => jsx9(DraftNode, { node: r.node, children: r.children }, r.node.node_id))
          }) : null
        ]
      }) : jsxs9("div", {
        className: "flex items-center gap-1.5 text-[0.625rem] text-(--ui-text-tertiary)",
        children: [
          jsx9("span", {
            className: "truncate",
            children: activeSessionId === visionSid ? "Sculpting the plan in the Vision chat\u2026" : "Waiting for the Vision session to produce a plan draft\u2026"
          }),
          draftText ? jsx9("span", { className: "shrink-0 tabular-nums text-(--ui-text-quaternary)", children: `${draftText.length} chars` }) : null
        ]
      })
    ]
  });
}

// src/views/plan.js
function VersionRow({ v, active, activating, onActivate }) {
  const isActive = v.version === active;
  const canActivate = v.state === "validated" && !isActive;
  return jsxs10("div", {
    className: "relative flex gap-3 px-0.5 py-1.5",
    children: [
      jsx10("span", {
        className: cn5("relative z-10 mt-1.5 size-2 shrink-0 rounded-full", isActive ? "bg-(--ui-accent)" : "bg-(--ui-stroke-secondary)")
      }),
      jsxs10("div", {
        className: "min-w-0 flex-1",
        children: [
          jsxs10("div", {
            className: "flex flex-wrap items-center gap-2",
            children: [
              jsx10("span", {
                className: cn5("min-w-0 truncate font-mono text-xs", isActive ? "font-semibold text-foreground" : "text-(--ui-text-secondary)"),
                children: `v${v.version}`
              }),
              v.title ? jsx10("span", { className: "min-w-0 truncate text-[0.625rem] text-(--ui-text-tertiary)", children: v.title }) : null,
              isActive ? jsx10(Badge2, { size: "xs", variant: "outline", children: "Active" }) : null,
              jsx10("span", { className: "font-mono text-[0.625rem] uppercase text-(--ui-text-tertiary)", children: v.state }),
              v.created_at ? jsx10("span", { className: "ml-auto text-[0.625rem] tabular-nums text-(--ui-text-quaternary)", children: formatDate(v.created_at) }) : null
            ]
          }),
          v.source ? jsxs10("div", {
            className: "mt-0.5 flex min-w-0 items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)",
            children: [jsx10("span", { className: "shrink-0 font-medium uppercase tracking-wide", children: "source" }), jsx10("span", { className: "truncate", children: v.source })]
          }) : null,
          v.reason ? jsx10("div", { className: "mt-0.5 line-clamp-2 text-[0.625rem] text-(--ui-text-tertiary)", children: v.reason }) : null,
          canActivate ? jsxs10("div", {
            className: "mt-1 flex items-center gap-1.5",
            children: [
              jsx10(Button6, {
                type: "button",
                size: "xs",
                variant: "secondary",
                disabled: activating !== null,
                onClick: () => onActivate(v.version),
                className: "gap-1",
                children: [jsx10(Codicon9, { name: "play", size: "0.7rem" }), activating === v.version ? "Activating\u2026" : "Activate"]
              }),
              jsx10("span", { className: "text-[0.625rem] text-(--ui-text-quaternary)", children: "Supersedes the currently active version." })
            ]
          }) : null
        ]
      })
    ]
  });
}
function PlanView({ snapshot, scope, actor, onMutated }) {
  const queryClient = useQueryClient2();
  const versions = planVersions(snapshot);
  const active = snapshot?.roadmap?.active_version;
  const activeSessionId = useValue(host5.state.activeSessionId);
  const [visionSession, setVisionSession] = useState8(null);
  const [busy, setBusy] = useState8(false);
  const [saveBusy, setSaveBusy] = useState8(false);
  const [activating, setActivating] = useState8(null);
  const [error, setError] = useState8(null);
  const { draftText, preview, reset } = useVisionDraft(visionSession?.runtimeSessionId ?? null);
  const scopeKey = scope ? `${scope.profile}/${scope.projectId}/${scope.roadmapId}` : "";
  useEffect4(() => {
    setVisionSession(null);
    setError(null);
  }, [scopeKey]);
  const start = useCallback6(async () => {
    if (!scope || busy) return;
    setBusy(true);
    setError(null);
    try {
      const rules = await getPlanningRules();
      const identity = await startVisionSession(scope.profile, rules.rules.prompt);
      await attachVisionSession(scope.profile, scope.projectId, scope.roadmapId, identity.storedSessionId, active ?? 0, actor, null);
      setVisionSession(identity);
      host5.notify({ kind: "success", title: "Vision ready", message: "The Vision session is ready. Plan first, then propose the plan." });
    } catch (err) {
      setError({ code: rpcError(err).code });
    } finally {
      setBusy(false);
    }
  }, [active, actor, busy, scope]);
  const savePlan = useCallback6(async () => {
    if (!scope || !preview || saveBusy) return;
    setSaveBusy(true);
    setError(null);
    try {
      await createPlan(
        scope.profile,
        scope.projectId,
        scope.roadmapId,
        {
          nodes: preview.nodes,
          relations: preview.relations,
          todos: preview.todos,
          title: preview.title,
          source: "vision",
          reason: "Draft created in the Vision session."
        },
        actor
      );
      await queryClient.invalidateQueries({ queryKey: [ID, "list", scope.profile] });
      await queryClient.invalidateQueries({ queryKey: [ID, "steer", scope.profile, scope.projectId, scope.roadmapId] });
      if (onMutated) onMutated();
      host5.notify({ kind: "success", title: "Plan saved", message: `Plan version saved (${preview.counts.nodes} nodes, ${preview.counts.relations} relations, ${preview.counts.todos} todos).` });
      reset();
    } catch (err) {
      setError({ code: rpcError(err).code });
    } finally {
      setSaveBusy(false);
    }
  }, [actor, onMutated, preview, queryClient, reset, saveBusy, scope]);
  const activate = useCallback6(
    async (version) => {
      if (!scope || activating !== null) return;
      const expected = snapshot?.roadmap?.active_version ?? 0;
      setActivating(version);
      setError(null);
      try {
        await activatePlan(scope.profile, scope.projectId, scope.roadmapId, version, expected, actor);
        await queryClient.invalidateQueries({ queryKey: [ID, "list", scope.profile] });
        await queryClient.invalidateQueries({ queryKey: [ID, "steer", scope.profile, scope.projectId, scope.roadmapId] });
        if (onMutated) onMutated();
        host5.notify({ kind: "success", title: "Plan activated", message: `Version ${version} is now active.` });
      } catch (err) {
        setError({ code: rpcError(err).code });
      } finally {
        setActivating(null);
      }
    },
    [activating, actor, onMutated, queryClient, scope, snapshot]
  );
  const ec = mutationErrorCopy(error);
  return jsxs10("div", {
    className: "flex min-h-0 flex-1 flex-col gap-2",
    children: [
      visionSession ? jsxs10("div", {
        className: "flex min-h-0 flex-1 gap-2",
        children: [
          jsx10("div", { className: "flex min-w-0 flex-1 flex-col", children: jsx10(VisionLane, { session: visionSession }) }),
          jsx10("div", {
            className: "flex w-[42%] min-w-0 flex-col overflow-auto border-l border-(--ui-stroke-tertiary) pl-2",
            children: jsx10(PlanDraftLive, {
              preview,
              draftText,
              activeSessionId,
              visionSid: visionSession?.runtimeSessionId,
              saveBusy,
              onSave: () => void savePlan()
            })
          })
        ]
      }) : null,
      error && ec ? jsxs10("div", {
        className: "flex items-start gap-1.5 rounded-[3px] bg-destructive/10 px-2 py-1 text-xs text-destructive",
        children: [
          jsx10(Codicon9, { name: "error", size: "0.75rem", className: "mt-px shrink-0" }),
          jsxs10("span", { children: [ec.hint, ec.code != null ? ` (code ${ec.code})` : ""] })
        ]
      }) : null,
      jsxs10("div", {
        className: "flex items-center justify-between gap-2 px-0.5",
        children: [
          jsx10(SectionTitle, {
            right: jsx10("span", { className: "tabular-nums text-(--ui-text-quaternary)", children: plural(versions.length, "version") }),
            children: "Plan versions"
          }),
          jsx10(Button6, {
            type: "button",
            size: "xs",
            variant: visionSession ? "secondary" : "default",
            disabled: !scope || busy,
            onClick: () => void start(),
            className: "gap-1",
            children: [jsx10(Codicon9, { name: visionSession ? "debug-restart" : "add", size: "0.7rem" }), busy ? "Starting\u2026" : "Start planning"]
          })
        ]
      }),
      versions.length === 0 ? jsx10(EmptyState4, {
        title: "No versions yet",
        description: "Start a Vision session to draft the roadmap plan \u2014 the first published version lands here once saved."
      }) : jsxs10("div", {
        className: "relative mt-1 flex flex-col",
        children: [
          jsx10("span", { className: "absolute bottom-2 left-[3px] top-2 w-px bg-(--ui-stroke-tertiary)" }),
          versions.map((v) => jsx10(VersionRow, { v, active, activating, onActivate: (version) => void activate(version) }, String(v.version)))
        ]
      })
    ]
  });
}

// src/views/team.js
import { jsx as jsx11, jsxs as jsxs11 } from "react/jsx-runtime";
import { Button as Button7, Codicon as Codicon10, EmptyState as EmptyState5, ErrorState as ErrorState2, Skeleton as Skeleton2 } from "@hermes/plugin-sdk";
function WorkerRow({ worker, todos }) {
  const modelLabel = worker.model ? [worker.provider, worker.model].filter(Boolean).join("/") : worker.provider;
  const meta = [modelLabel, worker.thinking_level ? `thinking ${worker.thinking_level}` : null].filter(Boolean);
  const capabilities = [
    worker.toolsets?.length ? `tools: ${worker.toolsets.join(", ")}` : null,
    worker.skills?.length ? `skills: ${worker.skills.join(", ")}` : null
  ].filter(Boolean);
  return jsxs11("div", {
    className: "flex flex-col gap-0.5 border-b border-(--ui-stroke-tertiary) py-1.5",
    children: [
      jsxs11("div", {
        className: "flex flex-wrap items-center gap-x-2 gap-y-0.5",
        children: [
          jsx11(Codicon10, { name: "person", size: "0.7rem", className: "shrink-0 text-(--ui-text-tertiary)" }),
          jsx11("span", { className: "text-xs font-medium", children: worker.lane || worker.worker_id }),
          meta.length ? jsx11("span", { className: "font-mono text-[0.625rem] text-(--ui-text-tertiary)", children: meta.join(" \xB7 ") }) : null,
          jsx11("span", { className: "ml-auto text-[0.625rem] text-(--ui-text-quaternary)", children: plural(todos.length, "todo") })
        ]
      }),
      capabilities.length ? jsx11("div", { className: "flex flex-wrap gap-x-2 text-[0.625rem] text-(--ui-text-quaternary)", children: capabilities.map((c) => jsx11("span", { children: c }, c)) }) : null
    ]
  });
}
function TeamView({ scope, version }) {
  const query = useRoadmapTeam(scope.profile, scope.projectId, scope.roadmapId, version, version != null);
  if (version == null) {
    return jsx11(EmptyState5, { title: "No active version", description: "This roadmap has no active version to team up." });
  }
  if (query.isLoading) {
    return jsx11(Skeleton2, { className: "h-24 w-full" });
  }
  if (query.isError) {
    const err = errorCopy(query.error);
    return jsx11(ErrorState2, {
      title: "Team unavailable",
      description: `${err.hint}${err.code != null ? ` (code ${err.code})` : ""}`,
      children: jsx11(Button7, { type: "button", size: "xs", variant: "secondary", onClick: () => void query.refetch(), children: "Retry" })
    });
  }
  const data = query.data ?? { workers: [], assignments: [], battery: { ok: false, failures: [] } };
  const workers = data.workers;
  const byWorker = /* @__PURE__ */ new Map();
  for (const w of workers) byWorker.set(w.worker_id, []);
  for (const a of data.assignments) {
    if (byWorker.has(a.worker_id)) byWorker.get(a.worker_id).push(a.todo_id);
  }
  return jsxs11("div", {
    className: "flex flex-col gap-2",
    children: [
      jsx11(SectionTitle, { right: plural(workers.length, "worker"), children: "Team" }),
      jsx11(BatteryBadge, { battery: data.battery, label: "Team battery" }),
      workers.length === 0 ? jsx11(EmptyState5, { title: "No team", description: "No lane workers are assigned for this version yet." }) : jsx11("div", { className: "flex flex-col", children: workers.map((w) => jsx11(WorkerRow, { worker: w, todos: byWorker.get(w.worker_id) ?? [] }, w.worker_id)) })
    ]
  });
}

// src/views/readiness.js
import { jsx as jsx12, jsxs as jsxs12 } from "react/jsx-runtime";
import { Button as Button8, Codicon as Codicon11, EmptyState as EmptyState6, ErrorState as ErrorState3, Skeleton as Skeleton3, StatusDot as StatusDot5 } from "@hermes/plugin-sdk";
var ITEM_TONE = { resolved: "good", verified: "good", open: "warn", missing: "bad", unresolved: "bad" };
function ItemRow({ item }) {
  const icon = item.kind === "blocker" ? "error" : "check";
  const tone = ITEM_TONE[item.status] ?? "muted";
  return jsxs12("div", {
    className: "flex flex-col gap-0.5 border-b border-(--ui-stroke-tertiary) py-1.5",
    children: [
      jsxs12("div", {
        className: "flex flex-wrap items-center gap-x-2 gap-y-0.5",
        children: [
          jsx12(Codicon11, { name: icon, size: "0.7rem", className: "shrink-0 text-(--ui-text-tertiary)" }),
          jsx12("span", { className: "min-w-0 flex-1 truncate text-xs", children: item.title || item.item_id }),
          jsx12("span", { className: "text-[0.625rem] text-(--ui-text-quaternary)", children: item.kind }),
          jsxs12("span", {
            className: "inline-flex items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)",
            children: [jsx12(StatusDot5, { tone }), item.status ?? "\u2014"]
          })
        ]
      }),
      item.detail ? jsx12("div", { className: "truncate text-[0.625rem] text-(--ui-text-quaternary)", children: item.detail }) : null
    ]
  });
}
function ReadinessView({ scope, version }) {
  const query = useRoadmapReadiness(scope.profile, scope.projectId, scope.roadmapId, version, version != null);
  if (version == null) {
    return jsx12(EmptyState6, { title: "No active version", description: "This roadmap has no active version to check readiness for." });
  }
  if (query.isLoading) {
    return jsx12(Skeleton3, { className: "h-24 w-full" });
  }
  if (query.isError) {
    const err = errorCopy(query.error);
    return jsx12(ErrorState3, {
      title: "Readiness unavailable",
      description: `${err.hint}${err.code != null ? ` (code ${err.code})` : ""}`,
      children: jsx12(Button8, { type: "button", size: "xs", variant: "secondary", onClick: () => void query.refetch(), children: "Retry" })
    });
  }
  const data = query.data ?? { items: [], battery: { ok: false, failures: [] } };
  const items = data.items;
  return jsxs12("div", {
    className: "flex flex-col gap-2",
    children: [
      jsx12(SectionTitle, { right: plural(items.length, "item"), children: "Readiness" }),
      jsx12(BatteryBadge, { battery: data.battery, label: "Readiness battery" }),
      items.length === 0 ? jsx12(EmptyState6, { title: "No readiness items", description: "No blockers or authorizations are recorded for this version yet." }) : jsx12("div", { className: "flex flex-col", children: items.map((it) => jsx12(ItemRow, { item: it }, it.item_id)) })
    ]
  });
}

// src/inspector.js
import { useCallback as useCallback7, useEffect as useEffect5, useMemo as useMemo6, useState as useState9 } from "react";
import { jsx as jsx13, jsxs as jsxs13 } from "react/jsx-runtime";
import { Button as Button9, Codicon as Codicon12, CopyButton as CopyButton3, EmptyState as EmptyState7, Input as Input2, Separator, StatusDot as StatusDot6, cn as cn6, host as host6 } from "@hermes/plugin-sdk";
function MutationButton({ label, codicon, onClick, busy, disabled, tone }) {
  return jsxs13(Button9, {
    type: "button",
    variant: tone === "danger" ? "destructive" : "secondary",
    size: "xs",
    onClick,
    disabled: disabled || busy,
    className: "gap-1",
    children: [jsx13(Codicon12, { name: codicon, size: "0.75rem" }), label]
  });
}
function TodoRow2({ todo, onMutate, busyTodoId }) {
  const done = todo.state === "done" || todo.state === "cancelled";
  return jsxs13("div", {
    className: "flex items-center gap-2 px-0.5 py-0.5 text-xs",
    children: [
      jsx13(StatusDot6, { tone: done ? "muted" : "good" }),
      jsx13("span", {
        className: cn6("min-w-0 flex-1 truncate", done && "line-through opacity-60"),
        children: todo.title
      }),
      jsxs13("div", {
        className: "flex shrink-0 items-center gap-1",
        children: [
          todo.state === "open" ? jsx13(MutationButton, {
            label: "Start",
            codicon: "play",
            onClick: () => onMutate(todo.todo_id, "in_progress"),
            busy: busyTodoId === todo.todo_id
          }) : null,
          todo.state === "in_progress" ? jsx13(MutationButton, {
            label: "Finish",
            codicon: "pass-filled",
            onClick: () => onMutate(todo.todo_id, "done"),
            busy: busyTodoId === todo.todo_id
          }) : null,
          !done ? jsx13(MutationButton, {
            label: "Cancel",
            codicon: "close",
            onClick: () => onMutate(todo.todo_id, "cancelled"),
            busy: busyTodoId === todo.todo_id,
            tone: "danger"
          }) : null,
          todo.state === "cancelled" ? jsx13(MutationButton, {
            label: "Reopen",
            codicon: "debug-restart",
            onClick: () => onMutate(todo.todo_id, "open"),
            busy: busyTodoId === todo.todo_id
          }) : null
        ]
      })
    ]
  });
}
function RelationChips({ title, codicon, items, onSelect, destructive }) {
  if (items.length === 0) return null;
  return jsxs13("div", {
    className: "flex items-start gap-2 text-[0.625rem]",
    children: [
      jsxs13("span", {
        className: "mt-px inline-flex w-16 shrink-0 items-center gap-1 font-medium uppercase tracking-wide text-(--ui-text-tertiary)",
        children: [jsx13(Codicon12, { name: codicon, size: "0.65rem" }), title]
      }),
      jsxs13("div", {
        className: "flex min-w-0 flex-wrap gap-1",
        children: items.map(
          (it) => jsx13(
            "button",
            {
              type: "button",
              onClick: () => onSelect(it.id),
              title: it.hint,
              className: cn6(
                "min-w-0 max-w-48 truncate rounded-[3px] px-1 py-px transition-colors",
                destructive ? "text-destructive hover:bg-(--chrome-action-hover)" : "text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground"
              ),
              children: it.label
            },
            it.id
          )
        )
      })
    ]
  });
}
function Inspector({ snapshot, version, nodeId, scope, onMutated, compact, actor, setActor, onSelect }) {
  const [progressInput, setProgressInput] = useState9("");
  const [reason, setReason] = useState9("");
  const [busyOp, setBusyOp] = useState9(null);
  const [busyTodoId, setBusyTodoId] = useState9(null);
  const [error, setError] = useState9(null);
  const node = (version?.nodes ?? []).find((n) => n.node_id === nodeId) ?? null;
  const todos = (version?.todos ?? []).filter((t) => t.node_id === nodeId);
  const expectedVersion = snapshot?.roadmap?.active_version;
  const deps = useMemo6(() => node ? nodeDepsInfo(node, version) : null, [node, version]);
  const dependants = useMemo6(() => node ? nodeDependants(node, version) : [], [node, version]);
  const blockers = useMemo6(() => node ? nodeBlockers(node, version) : [], [node, version]);
  const blocks = useMemo6(() => node ? nodeBlocks(node, version) : [], [node, version]);
  useEffect5(() => {
    setProgressInput("");
    setReason("");
    setError(null);
  }, [nodeId]);
  const guardActor = useCallback7(() => {
    const sent = actor.trim() || "user";
    if (isValidIdentifier(sent)) return true;
    setError({ code: null, hint: "Actor must be a valid identifier: non-empty, at most 128 characters, no control characters." });
    return false;
  }, [actor]);
  const mutate = useCallback7(
    async (op, extra) => {
      if (!node || !scope || !guardActor()) return;
      if (op === "update_progress") {
        const p = Number(extra?.progress);
        if (!validateProgress(p)) {
          setError({ code: null, hint: "Progress must be an integer between 0 and 100." });
          return;
        }
      }
      setBusyOp(op);
      setError(null);
      try {
        await host6.request(RPC[op], {
          profile: scope.profile,
          project_id: scope.projectId,
          roadmap_id: scope.roadmapId,
          node_id: node.node_id,
          actor: actor.trim() || "user",
          expected_version: expectedVersion,
          ...extra ?? {}
        });
        onMutated();
      } catch (err) {
        setError({ code: rpcError(err).code });
      } finally {
        setBusyOp(null);
      }
    },
    [actor, expectedVersion, guardActor, node, onMutated, scope]
  );
  const mutateTodo = useCallback7(
    async (todoId, state) => {
      if (!scope || !guardActor()) return;
      setBusyTodoId(todoId);
      setError(null);
      try {
        await host6.request(RPC.update_todo, {
          profile: scope.profile,
          project_id: scope.projectId,
          roadmap_id: scope.roadmapId,
          todo_id: todoId,
          actor: actor.trim() || "user",
          state,
          expected_version: expectedVersion
        });
        onMutated();
      } catch (err) {
        setError({ code: rpcError(err).code });
      } finally {
        setBusyTodoId(null);
      }
    },
    [actor, expectedVersion, guardActor, onMutated, scope]
  );
  if (!node) {
    return jsx13(EmptyState7, {
      title: "No node selected",
      description: "Pick a node in the Thread, Map, or Milestones view."
    });
  }
  const ec = mutationErrorCopy(error);
  return jsxs13("div", {
    className: "flex flex-col gap-2",
    children: [
      jsx13(SectionTitle, { children: "Inspector" }),
      jsxs13("div", {
        className: "flex items-start justify-between gap-2 px-0.5",
        children: [
          jsxs13("div", {
            className: "min-w-0",
            children: [
              jsxs13("div", {
                className: "flex items-center gap-1 text-[0.625rem] uppercase tracking-wide text-(--ui-text-tertiary)",
                children: [
                  jsx13("span", { className: "truncate", children: [`${node.kind} \xB7 ${node.node_id}`] }),
                  jsx13(CopyButton3, {
                    appearance: "icon",
                    buttonSize: "icon-xs",
                    buttonVariant: "ghost",
                    text: node.node_id,
                    title: "Copy node ID",
                    label: "Copy node ID"
                  })
                ]
              }),
              jsx13("div", { className: "truncate text-[0.8125rem] font-medium", children: nodeLabel(node) })
            ]
          }),
          jsx13(NodeStateTag, { state: node.state })
        ]
      }),
      node.description ? jsx13("p", {
        className: "whitespace-pre-wrap break-words px-0.5 text-xs leading-relaxed text-(--ui-text-tertiary)",
        children: node.description
      }) : null,
      jsxs13("div", {
        className: "flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-[0.625rem] text-(--ui-text-tertiary)",
        children: [
          jsxs13("span", { children: ["Progress: ", node.progress ?? 0, " %"] }),
          node.owner_agent ? jsxs13("span", { children: ["Owner: ", node.owner_agent] }) : jsx13("span", { children: "Owner: \u2014" }),
          node.parent_node_id ? jsxs13("span", { children: ["Parent: ", node.parent_node_id] }) : null,
          node.created_at ? jsxs13("span", { className: "tabular-nums", children: [formatDate(node.created_at)] }) : null
        ]
      }),
      // Dependencies — the depends_on drill-down (satisfied or not).
      jsxs13("div", {
        className: "flex flex-col gap-0.5 px-0.5",
        children: [
          jsxs13(SectionTitle, {
            right: deps ? jsx13("span", {
              className: cn6("tabular-nums", deps.satisfied === deps.total ? "text-(--ui-text-tertiary)" : "text-amber-500/90 dark:text-amber-300/90"),
              children: deps.total === 0 ? "none" : `${deps.satisfied}/${deps.total} satisfied`
            }) : null,
            children: "Dependencies"
          }),
          deps && deps.total > 0 ? jsxs13("div", {
            className: "flex flex-col divide-y divide-(--ui-stroke-tertiary)",
            children: deps.deps.map(
              (d) => jsxs13(
                "div",
                {
                  className: "flex items-center gap-1.5 py-0.5 text-[0.625rem]",
                  children: [
                    jsx13(Codicon12, {
                      name: d.satisfied ? "check" : "hourglass",
                      size: "0.65rem",
                      className: d.satisfied ? "shrink-0 text-(--ui-accent)" : "shrink-0 text-amber-500/90 dark:text-amber-300/90"
                    }),
                    d.target ? jsxs13("button", {
                      type: "button",
                      onClick: () => onSelect(d.target.node_id),
                      className: "min-w-0 truncate hover:underline",
                      children: nodeLabel(d.target)
                    }) : jsx13("span", { className: "min-w-0 truncate font-mono", children: d.targetId }),
                    jsx13("span", { className: "ml-auto shrink-0 text-(--ui-text-quaternary)", children: d.target ? d.target.state : "missing" })
                  ]
                },
                d.targetId
              )
            )
          }) : jsx13("div", { className: "px-0.5 text-[0.625rem] text-(--ui-text-quaternary)", children: "No depends_on relations on this node." })
        ]
      }),
      // Graph relations — blockers in, dependants, and what this node blocks.
      jsxs13("div", {
        className: "flex flex-col gap-1 px-0.5",
        children: [
          jsx13(RelationChips, {
            title: "Blockers",
            codicon: "debug-disconnect",
            destructive: true,
            items: blockers.map((b) => ({ id: b.from.node_id, label: nodeLabel(b.from), hint: b.reason || void 0 })),
            onSelect
          }),
          jsx13(RelationChips, {
            title: "Dependants",
            codicon: "arrow-down",
            items: dependants.map((n) => ({ id: n.node_id, label: nodeLabel(n) })),
            onSelect
          }),
          jsx13(RelationChips, {
            title: "Blocks",
            codicon: "arrow-up",
            items: blocks.map((n) => ({ id: n.node_id, label: nodeLabel(n) })),
            onSelect
          })
        ]
      }),
      todos.length > 0 ? jsxs13("div", {
        className: "flex flex-col gap-0.5 px-0.5",
        children: [
          jsx13(SectionTitle, {
            right: jsx13("span", { className: "tabular-nums text-(--ui-text-quaternary)", children: plural(todos.length, "todo") }),
            children: "Todos"
          }),
          jsxs13("div", {
            className: "flex flex-col divide-y divide-(--ui-stroke-tertiary)",
            children: todos.map((t) => jsx13(TodoRow2, { todo: t, onMutate: mutateTodo, busyTodoId }, t.todo_id))
          })
        ]
      }) : null,
      jsx13(Separator, { className: "my-0.5" }),
      // Actor + expected_version context row — always visible before acting.
      jsxs13("div", {
        className: "flex flex-wrap items-center gap-2 px-0.5",
        children: [
          jsxs13("label", {
            className: "flex items-center gap-1.5 text-[0.625rem] text-(--ui-text-tertiary)",
            children: [
              "Actor",
              jsx13(Input2, {
                value: actor,
                onChange: (ev) => setActor(ev.target.value),
                className: "h-6 w-28 px-1.5 text-xs",
                spellCheck: false,
                "aria-label": "Actor"
              })
            ]
          }),
          jsxs13("span", {
            className: "font-mono text-[0.6rem] text-(--ui-text-quaternary)",
            children: ["expected_version = ", String(expectedVersion)]
          })
        ]
      }),
      error && ec ? jsxs13("div", {
        className: "flex items-start gap-2 rounded-[3px] bg-destructive/10 px-2 py-1.5 text-xs text-destructive",
        children: [
          jsx13(Codicon12, { name: "error", size: "0.85rem", className: "mt-px shrink-0" }),
          jsxs13("div", {
            className: "min-w-0 flex-1",
            children: [
              jsxs13("div", {
                className: "font-medium",
                children: [ec.title, ec.code != null ? ` (code ${ec.code})` : ""]
              }),
              jsx13("div", { className: "mt-0.5 opacity-90", children: ec.hint })
            ]
          }),
          error.code === 5064 || error.code === 5065 ? jsx13(Button9, {
            type: "button",
            variant: "secondary",
            size: "xs",
            onClick: onMutated,
            children: "Reload snapshot"
          }) : null
        ]
      }) : null,
      // Node actions — availability mirrors the node's lifecycle state.
      jsxs13("div", {
        className: "flex flex-wrap items-center gap-1.5 px-0.5",
        children: [
          jsx13(MutationButton, {
            label: "Claim",
            codicon: "person-add",
            busy: busyOp === "claim_node",
            disabled: node.state !== "ready",
            onClick: () => mutate("claim_node")
          }),
          jsxs13("div", {
            className: "flex items-center gap-1.5",
            children: [
              jsx13(Input2, {
                value: progressInput,
                onChange: (ev) => setProgressInput(ev.target.value.replace(/[^0-9]/g, "")),
                placeholder: "0-100",
                className: "h-6 w-16 px-1.5 text-xs tabular-nums",
                inputMode: "numeric",
                "aria-label": "Progress (0-100)"
              }),
              jsx13(MutationButton, {
                label: "Progress",
                codicon: "arrow-up",
                busy: busyOp === "update_progress",
                disabled: node.state !== "in_progress" || progressInput === "",
                onClick: () => mutate("update_progress", { progress: Number(progressInput) })
              })
            ]
          }),
          jsx13(MutationButton, {
            label: "Complete",
            codicon: "pass-filled",
            busy: busyOp === "complete_node",
            disabled: node.state !== "in_progress",
            onClick: () => mutate("complete_node")
          }),
          node.state === "blocked" ? jsx13(MutationButton, {
            label: "Unblock",
            codicon: "debug-restart",
            busy: busyOp === "unblock_node",
            onClick: () => mutate("unblock_node")
          }) : jsxs13("div", {
            className: "flex items-center gap-1.5",
            children: [
              jsx13(Input2, {
                value: reason,
                onChange: (ev) => setReason(ev.target.value),
                placeholder: compact ? "reason\u2026" : "block reason (required)",
                className: "h-6 w-40 px-1.5 text-xs",
                "aria-label": "Block reason"
              }),
              jsx13(MutationButton, {
                label: "Block",
                codicon: "debug-disconnect",
                tone: "danger",
                busy: busyOp === "block_node",
                disabled: (node.state === "ready" || node.state === "in_progress") && !reason.trim(),
                onClick: () => mutate("block_node", { reason: reason.trim() })
              })
            ]
          })
        ]
      })
    ]
  });
}

// src/index.js
var INSPECTOR_TABS = /* @__PURE__ */ new Set(["map"]);
function ViewTabs({ active, onChange, locked }) {
  return jsxs14("div", {
    className: "flex flex-wrap items-center gap-4 px-0.5",
    children: config_default.tabs.map((t) => {
      const isLocked = locked?.[t.id] === true;
      return jsx14(
        "button",
        {
          type: "button",
          disabled: isLocked,
          onClick: () => onChange(t.id),
          title: isLocked ? `${t.label} \u2014 locked` : t.label,
          className: cn7(
            "inline-flex items-center gap-1 border-b-2 px-0.5 pb-1.5 pt-0.5 text-xs transition-colors",
            isLocked ? "cursor-not-allowed border-transparent text-(--ui-text-quaternary)" : active === t.id ? "border-(--ui-accent) font-medium text-foreground" : "border-transparent text-(--ui-text-tertiary) hover:text-foreground"
          ),
          children: [jsx14(Codicon13, { name: isLocked ? "lock" : t.codicon, size: "0.7rem" }), jsx14("span", { children: t.label })]
        },
        t.id
      );
    })
  });
}
function ActiveView({ tab, snapshot, version, selectedId, onSelect, scope, actor, onMutated }) {
  if (tab === "plan") {
    return jsx14(PlanView, { snapshot, scope, actor, onMutated });
  }
  if (tab === "map") {
    return jsx14(MapView, { version, selectedId, onSelect, scope });
  }
  if (tab === "team") {
    return jsx14(TeamView, { scope, version });
  }
  if (tab === "readiness") {
    return jsx14(ReadinessView, { scope, version });
  }
  return jsx14(BoardView, { scope, selectedId, onSelect });
}
function GridColumn({ header, divider, children }) {
  return jsxs14("div", {
    className: cn7("flex min-h-0 min-w-0 flex-col gap-1.5", divider && "border-l border-(--ui-stroke-tertiary) pl-2.5"),
    children: [
      header ?? null,
      jsx14(ScrollArea, { className: "min-h-0 flex-1 px-0.5", children })
    ]
  });
}
function MidPaneSwitch({ activeTab, pane, onPane }) {
  const tabMeta = config_default.tabs.find((t) => t.id === activeTab);
  const seg = (key, codicon, label) => jsx14(
    "button",
    {
      type: "button",
      onClick: () => onPane(key),
      title: label,
      className: cn7(
        "inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 text-[0.625rem] transition-colors",
        pane === key ? "bg-(--ui-bg-elevated) font-medium text-foreground" : "text-(--ui-text-tertiary) hover:text-foreground"
      ),
      children: [jsx14(Codicon13, { name: codicon, size: "0.65rem" }), jsx14("span", { children: label })]
    },
    key
  );
  return jsxs14("div", {
    className: "inline-flex items-center gap-0.5 self-start rounded-[3px] bg-(--ui-bg-quaternary) p-0.5",
    children: [
      seg("view", tabMeta?.codicon ?? "milestone", tabMeta?.label ?? activeTab),
      seg("inspector", "info", "Inspector")
    ]
  });
}
function RoadmapsGrid({
  mode,
  activeTab,
  canInspect,
  snapshot,
  version,
  selectedNodeId,
  onSelect,
  scope,
  onMutated,
  compact,
  actor,
  setActor,
  inspectorOpen
}) {
  const [midPane, setMidPane] = useState10("inspector");
  const pane = canInspect ? midPane : "view";
  const thread = jsx14(ThreadView, { version, selectedId: selectedNodeId, onSelect, dense: true });
  const view = jsx14(ActiveView, { tab: activeTab, snapshot, version, selectedId: selectedNodeId, onSelect, compact, dense: true, scope, actor, onMutated });
  const inspector = jsx14(Inspector, { snapshot, version, nodeId: selectedNodeId, scope, onMutated, compact, actor, setActor, onSelect });
  if (mode === "wide") {
    return jsxs14("div", {
      className: "grid min-h-0 flex-1 gap-2.5",
      style: { gridTemplateColumns: `minmax(0, 1.1fr) minmax(0, 1fr) ${config_default.layout.inspectorWidth}px` },
      children: [
        jsx14(GridColumn, { children: thread }),
        jsx14(GridColumn, { divider: true, children: view }),
        jsx14(GridColumn, { divider: true, children: inspector })
      ]
    });
  }
  if (mode === "mid") {
    return jsxs14("div", {
      className: "grid min-h-0 flex-1 grid-cols-2 gap-2.5",
      children: [
        jsx14(GridColumn, { children: thread }),
        jsx14(GridColumn, {
          divider: true,
          header: canInspect ? jsx14(MidPaneSwitch, { activeTab, pane, onPane: setMidPane }) : null,
          children: pane === "inspector" ? inspector : view
        })
      ]
    });
  }
  return jsxs14("div", {
    className: "flex min-h-0 flex-1 flex-col gap-2",
    children: [
      jsx14(ScrollArea, { className: "min-h-0 flex-1 px-0.5", children: view }),
      compact && canInspect && inspectorOpen ? jsxs14("div", {
        className: "flex min-h-0 flex-1 flex-col border-t border-(--ui-stroke-tertiary) pt-1.5",
        children: [jsx14(ScrollArea, { className: "min-h-0 flex-1 px-0.5", children: inspector })]
      }) : null
    ]
  });
}
function RoadmapsPage() {
  const profile = useValue2(host7.state.profile);
  const viewport = useValue2(host7.state.viewport);
  const [actor, setActor] = useState10("user");
  const [inspectorOpen, setInspectorOpen] = useState10(false);
  const { containerRef, mode, compact } = useLayoutMode(viewport?.width ?? 0);
  const profileReady = typeof profile === "string" && profile.trim() !== "";
  const listQuery = useRoadmapsList(profile, profileReady);
  const projectsQuery = useProjectsList(profile, profileReady);
  const roadmaps = listQuery.data?.roadmaps ?? [];
  const projectsData = projectsQuery.data?.projects ?? [];
  const { projectId, setProjectId, roadmapId, projectNameById, projects, roadmapOptions } = useScopeState(profile, projectsData, roadmaps);
  const [activeTab, setActiveTab] = usePersistedState(`roadmaps:${profile}:${projectId}:tab`, "plan");
  const [follow, setFollow] = usePersistedState(`roadmaps:${profile}:follow`, false);
  const [activeProjectId, setActiveProjectId] = useState10(null);
  useEffect6(() => {
    const atom = host7.state.activeProjectId;
    if (!atom) return void 0;
    return atom.listen(setActiveProjectId);
  }, []);
  useEffect6(() => {
    if (follow && activeProjectId && activeProjectId !== projectId) {
      setProjectId(activeProjectId);
    }
  }, [follow, activeProjectId, projectId, setProjectId]);
  const scopeReady = profileReady && projectId !== "" && roadmapId !== "";
  const snapshotQuery = useRoadmapSnapshot(profile, projectId, roadmapId, scopeReady);
  const snapshot = snapshotQuery.data;
  const found = snapshot?.found === true;
  const version = useMemo7(() => activeVersion(snapshot), [snapshot]);
  const { selectedNodeId, setSelectedNodeId, onSelect } = useNodeSelection([profile, projectId, roadmapId], version);
  const reloadSnapshot = useCallback8(() => {
    void snapshotQuery.refetch();
  }, [snapshotQuery]);
  const scope = scopeReady ? { profile, projectId, roadmapId } : null;
  const versionReady = version != null;
  const planBatteryQuery = useRoadmapPlanBattery(profile, projectId, roadmapId, version, scopeReady && versionReady);
  const teamBatteryQuery = useRoadmapTeamBattery(profile, projectId, roadmapId, version, scopeReady && versionReady);
  const readinessBatteryQuery = useRoadmapReadinessBattery(profile, projectId, roadmapId, version, scopeReady && versionReady);
  const planOk = planBatteryQuery.data?.ok === true;
  const teamOk = teamBatteryQuery.data?.ok === true;
  const readinessOk = readinessBatteryQuery.data?.ok === true;
  const lockedTabs = { plan: false, team: !planOk, readiness: !teamOk, map: !readinessOk };
  useEffect6(() => {
    if (activeTab === "team" && !planOk) setActiveTab("plan");
    else if (activeTab === "readiness" && !teamOk) setActiveTab("plan");
    else if (activeTab === "map" && !readinessOk) setActiveTab("plan");
  }, [activeTab, planOk, teamOk, readinessOk]);
  const canInspect = selectedNodeId !== "" && INSPECTOR_TABS.has(activeTab);
  if (!profileReady) {
    return jsx14(EmptyState8, {
      title: "Profile not initialized",
      description: 'No active profile identity is available. Roadmaps refuses to guess a profile (no silent fallback to "default").'
    });
  }
  const listError = listQuery.isError ? errorCopy(listQuery.error) : null;
  const snapshotError = snapshotQuery.isError ? errorCopy(snapshotQuery.error) : null;
  const panel = (content2) => jsx14(ScrollArea, { className: "min-h-0 flex-1 px-0.5", children: content2 });
  const needsVersion = activeTab === "map";
  let content;
  if (!scopeReady) {
    content = panel(
      jsx14(EmptyState8, {
        title: "Select a project\u2026",
        description: "The Plan, Team, Readiness, and Map views appear once a project is chosen."
      })
    );
  } else if (snapshotQuery.isLoading) {
    content = panel(jsx14(Skeleton4, { className: "h-24 w-full" }));
  } else if (snapshotQuery.isError) {
    content = panel(
      jsx14(ErrorState4, {
        title: "Snapshot unavailable",
        description: `${snapshotError.hint}${snapshotError.code != null ? ` (code ${snapshotError.code})` : ""}`,
        children: jsx14(Button10, {
          type: "button",
          size: "xs",
          variant: "secondary",
          onClick: () => void snapshotQuery.refetch(),
          children: snapshotError.code === 5064 ? "Reload" : "Retry"
        })
      })
    );
  } else if (!found) {
    content = panel(
      jsx14(EmptyState8, {
        title: "No roadmap for this scope",
        description: `No roadmap found for ${projectId} / ${roadmapId} in profile ${profile}.`
      })
    );
  } else if (needsVersion && !version) {
    content = panel(
      jsx14(EmptyState8, {
        title: "No active version",
        description: "This roadmap has no active version to display."
      })
    );
  } else {
    content = jsx14(RoadmapsGrid, {
      mode,
      activeTab,
      canInspect,
      snapshot,
      version,
      selectedNodeId,
      onSelect,
      scope,
      onMutated: reloadSnapshot,
      compact,
      actor,
      setActor,
      inspectorOpen
    });
  }
  return jsxs14("div", {
    ref: containerRef,
    className: "flex h-full min-h-0 flex-col gap-2 p-3",
    children: [
      // Scope bar: profile (read-only) → project → roadmap (+ / ⋮ input flows).
      // `actor` is the shared identity for versioned writes (roadmap CRUD and
      // the Inspector's node mutations), defaulting to 'user'.
      jsx14(ScopeBar, {
        profile,
        projectId,
        setProjectId,
        setSelectedNodeId,
        projects,
        projectNameById,
        compact,
        roadmapsCount: roadmaps.length,
        projectsError: projectsQuery.isError ? errorCopy(projectsQuery.error) : null,
        onRetryProjects: () => void projectsQuery.refetch(),
        follow,
        onToggleFollow: () => setFollow((v) => !v)
      }),
      // List states: explicit error (with retry) before any empty state.
      listError ? jsx14(ErrorState4, {
        title: "Roadmap list unavailable",
        description: `${listError.hint}${listError.code != null ? ` (code ${listError.code})` : ""}`,
        children: jsx14(Button10, {
          type: "button",
          size: "xs",
          variant: "secondary",
          onClick: () => void listQuery.refetch(),
          children: "Retry"
        })
      }) : projectId !== "" && roadmapOptions.length === 0 && !listQuery.isLoading ? jsx14(EmptyState8, {
        title: "No roadmaps for this scope",
        description: `Project "${projectNameById.get(projectId) || projectId}" has no roadmaps in profile ${profile}. Create one on the backend (projects.db remains the source of truth).`
      }) : null,
      // Roadmap header (title + lifecycle + version) once a roadmap is chosen.
      found && snapshot?.roadmap ? jsxs14("div", {
        className: "flex flex-wrap items-center gap-2 border-b border-(--ui-stroke-tertiary) px-0.5 pb-2",
        children: [
          jsxs14("div", {
            className: "min-w-0 flex-1",
            children: [
              jsx14("div", { className: "truncate text-[0.8125rem] font-medium", children: snapshot.roadmap.title || roadmapId }),
              !compact && snapshot.roadmap.purpose ? jsx14("div", { className: "truncate text-[0.625rem] text-(--ui-text-tertiary)", children: snapshot.roadmap.purpose }) : null
            ]
          }),
          jsxs14(Badge3, { size: "xs", variant: "outline", children: [jsx14(StatusDot7, { tone: "good" }), snapshot.roadmap.lifecycle_state] }),
          jsxs14("span", { className: "font-mono text-[0.625rem] text-(--ui-text-tertiary)", children: ["v", String(snapshot.roadmap.active_version)] }),
          jsx14(CopyButton4, {
            appearance: "icon",
            buttonSize: "icon-xs",
            buttonVariant: "ghost",
            text: `${profile} / ${projectId} / ${roadmapId}`,
            title: "Copy scope (profile / project / roadmap)",
            label: "Copy scope"
          })
        ]
      }) : null,
      // Orchestration copilot — data-driven, only once the snapshot is loaded.
      // Stays above the columns at every breakpoint; denser in compact.
      found && snapshot?.roadmap ? jsx14(CopilotBar, { version, selectedId: selectedNodeId, onSelect, dense: compact }) : null,
      // Module navigation — visible as soon as a scope is chosen. In compact
      // the tab row also hosts the "Details" toggle for the Inspector panel.
      scopeReady ? jsxs14("div", {
        className: "flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-(--ui-stroke-tertiary)",
        children: [
          jsx14(ViewTabs, { active: activeTab, onChange: setActiveTab, locked: lockedTabs }),
          compact && canInspect ? jsx14(Button10, {
            type: "button",
            variant: inspectorOpen ? "secondary" : "ghost",
            size: "xs",
            onClick: () => setInspectorOpen((v) => !v),
            className: "gap-1",
            children: [jsx14(Codicon13, { name: "info", size: "0.7rem" }), "Details"]
          }) : null
        ]
      }) : null,
      content
    ]
  });
}
var index_default = {
  id: ID,
  name: "Roadmaps",
  description: "Project roadmaps \u2014 orchestration thread, canonical relation map, versioned plan history, milestones, and a data-driven copilot with versioned manual steering.",
  defaultEnabled: true,
  register(ctx) {
    ctx.registerMany([
      {
        id: "page",
        area: ROUTES_AREA,
        data: { path: "/roadmaps" },
        render: () => jsx14(RoadmapsPage, {})
      },
      {
        id: "nav",
        area: SIDEBAR_NAV_AREA,
        order: 51,
        data: { codicon: "milestone", label: "Roadmaps", path: "/roadmaps" }
      }
    ]);
  }
};
export {
  index_default as default
};
