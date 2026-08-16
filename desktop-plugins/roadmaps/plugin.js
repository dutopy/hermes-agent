/**
 * Roadmaps — disk-mode Desktop plugin (branch feat/roadmaps).
 *
 * BUILT ARTIFACT — do not edit by hand. Source lives in src/; settings live
 * in src/config.json (embedded at build time). Rebuild with: node build.mjs
 * (esbuild bundle, format=esm, external @hermes/plugin-sdk / react /
 * react/jsx-runtime — the runtime loader rewrites those bare specifiers).
 */

// src/index.js
import { useCallback as useCallback9, useMemo as useMemo8, useState as useState7 } from "react";
import { jsx as jsx14, jsxs as jsxs11 } from "react/jsx-runtime";
import {
  Badge as Badge2,
  Button as Button6,
  Codicon as Codicon10,
  CopyButton as CopyButton4,
  EmptyState as EmptyState9,
  ErrorState as ErrorState2,
  ROUTES_AREA,
  ScrollArea,
  SIDEBAR_NAV_AREA,
  Skeleton as Skeleton2,
  StatusDot as StatusDot7,
  cn as cn8,
  host as host6,
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
    { id: "thread", label: "Thread", codicon: "list-ordered" },
    { id: "board", label: "Board", codicon: "project" },
    { id: "map", label: "Map", codicon: "graph" },
    { id: "plan", label: "Plan", codicon: "versions" },
    { id: "milestones", label: "Milestones", codicon: "milestone" },
    { id: "decisions", label: "Decisions", codicon: "checklist" },
    { id: "files", label: "Files", codicon: "files" }
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
  plans_activate: "plans.activate"
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
async function roadmapCreate(profile, projectId, title, actor) {
  const scope = assertRoadmapScope(profile, projectId, null);
  const sent = String(title ?? "").trim();
  if (!validateRoadmapTitle(sent)) {
    throw localValidationError("Roadmap title must be non-empty, at most 200 characters, and free of control characters.");
  }
  const sentActor = assertActor(actor);
  return host.request(RPC.roadmaps_create, {
    profile: scope.profile,
    project_id: scope.projectId,
    title: sent,
    actor: sentActor
  });
}
async function roadmapUpdate(profile, projectId, roadmapId, expectedVersion, title, actor) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId);
  const expected = assertExpectedVersion(expectedVersion);
  const sent = String(title ?? "").trim();
  if (!validateRoadmapTitle(sent)) {
    throw localValidationError("Roadmap title must be non-empty, at most 200 characters, and free of control characters.");
  }
  const sentActor = assertActor(actor);
  return host.request(RPC.roadmaps_update, {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId,
    expected_version: expected,
    title: sent,
    actor: sentActor
  });
}
async function roadmapArchive(profile, projectId, roadmapId, expectedVersion, actor) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId);
  const expected = assertExpectedVersion(expectedVersion);
  const sentActor = assertActor(actor);
  return host.request(RPC.roadmaps_archive, {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId,
    expected_version: expected,
    actor: sentActor
  });
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
function milestoneNodes(version) {
  return (version?.nodes ?? []).filter((n) => n.kind === "milestone" || n.kind === "objective").sort((a, b) => String(a.node_id).localeCompare(String(b.node_id)));
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
function groupMilestones(version) {
  const nodes = milestoneNodes(version);
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]));
  const groups = /* @__PURE__ */ new Map();
  const flat = [];
  for (const n of nodes) {
    const parent = n.parent_node_id ? byId.get(n.parent_node_id) ?? null : null;
    if (parent) {
      const arr = groups.get(parent.node_id) ?? [];
      arr.push(n);
      groups.set(parent.node_id, arr);
    } else {
      flat.push(n);
    }
  }
  const entries = [...groups.entries()].map(([parentId, groupNodes]) => ({
    label: nodeLabel(byId.get(parentId)),
    nodes: groupNodes
  }));
  if (flat.length > 0) entries.push({ label: null, nodes: flat });
  return entries;
}

// src/state.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { host as host2, useQuery } from "@hermes/plugin-sdk";
function useLayoutMode(initialWidth) {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(initialWidth);
  useEffect(() => {
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
function useScopeState(projects, roadmaps) {
  const [projectId, setProjectId] = useState("");
  const [roadmapId, setRoadmapId] = useState("");
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
  useEffect(() => {
    if (projectId !== "" && !projectIds.includes(projectId)) setProjectId("");
  }, [projectIds, projectId]);
  useEffect(() => {
    if (roadmapId !== "" && !roadmapOptions.some((r) => r.roadmap_id === roadmapId)) setRoadmapId("");
  }, [roadmapOptions, roadmapId]);
  return { projectId, setProjectId, roadmapId, setRoadmapId, projectNameById, projects: projectItems, roadmapOptions };
}
function useNodeSelection(scopeIdentity, version) {
  const [selectedNodeId, setSelectedNodeId] = useState("");
  useEffect(() => {
    setSelectedNodeId("");
  }, scopeIdentity);
  useEffect(() => {
    if (selectedNodeId !== "" && version && !version.nodes.some((n) => n.node_id === selectedNodeId)) {
      setSelectedNodeId("");
    }
  }, [version, selectedNodeId]);
  const onSelect = useCallback((nodeId) => {
    setSelectedNodeId((cur) => cur === nodeId ? "" : nodeId);
  }, []);
  return { selectedNodeId, setSelectedNodeId, onSelect };
}
function deriveProductState(snapshot) {
  if (snapshot == null) return "NO_PROJECT";
  if (snapshot.found !== true || !snapshot.roadmap) return "NO_ROADMAP";
  const roadmap = snapshot.roadmap;
  if (roadmap.active_version != null) return "ACTIVE";
  const versions = Array.isArray(roadmap.versions) ? roadmap.versions : [];
  if (versions.some((v) => v?.state === "validated")) return "VALIDATED_NON_ACTIVE";
  if (versions.some((v) => v?.state === "proposed")) return "PROPOSED";
  return "DRAFT_NO_PLAN";
}

// src/scope.js
import { useState as useState3 } from "react";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
import { Button as Button2, Codicon as Codicon2, CopyButton as CopyButton2, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tip, useQueryClient as useQueryClient2 } from "@hermes/plugin-sdk";

// src/scope-actions.js
import { useCallback as useCallback2, useState as useState2 } from "react";
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
  const [name, setName] = useState2("");
  const [busy, setBusy] = useState2(false);
  const [error, setError] = useState2(null);
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
  const [name, setName] = useState2(currentName);
  const [busy, setBusy] = useState2(false);
  const [error, setError] = useState2(null);
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
  const [confirmOpen, setConfirmOpen] = useState2(false);
  const [busy, setBusy] = useState2(false);
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
function RoadmapCreateForm({ profile, projectId, actor, onCreated, onCancel }) {
  const [title, setTitle] = useState2("");
  const [busy, setBusy] = useState2(false);
  const [error, setError] = useState2(null);
  const queryClient = useQueryClient();
  const submit = useCallback2(async () => {
    if (busy) return;
    const trimmed = title.trim();
    if (!validateRoadmapTitle(trimmed)) {
      setError({
        code: null,
        hint: "Roadmap title must be non-empty, at most 200 characters, and free of control characters."
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await roadmapCreate(profile, projectId, trimmed, actor);
      await queryClient.invalidateQueries({ queryKey: [ID, "list", profile] });
      const createdId = res?.roadmap_id ?? res?.scope?.roadmap_id ?? "";
      host3.notify({ kind: "success", title: "Roadmap created", message: `Created "${trimmed}".` });
      onCreated(createdId);
    } catch (err) {
      setError({ code: rpcError(err).code, hint: err?.hint });
    } finally {
      setBusy(false);
    }
  }, [actor, busy, onCreated, profile, projectId, queryClient, title]);
  return jsxs("div", {
    className: "flex flex-col gap-1 px-0.5",
    children: [
      jsxs("div", {
        className: "flex items-center gap-1.5",
        children: [
          jsx(Input, {
            value: title,
            onChange: (ev) => setTitle(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === "Enter") void submit();
              if (ev.key === "Escape") onCancel();
            },
            placeholder: "Roadmap title\u2026",
            autoFocus: true,
            disabled: busy,
            className: "h-6 w-48 px-1.5 text-xs",
            "aria-label": "New roadmap title"
          }),
          jsx(Button, {
            type: "button",
            size: "xs",
            variant: "secondary",
            onClick: () => void submit(),
            disabled: busy || title.trim() === "",
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
function RoadmapRenameForm({ profile, projectId, roadmapId, currentTitle, expectedVersion, actor, onRenamed, onCancel }) {
  const [title, setTitle] = useState2(currentTitle);
  const [busy, setBusy] = useState2(false);
  const [error, setError] = useState2(null);
  const queryClient = useQueryClient();
  const submit = useCallback2(async () => {
    if (busy) return;
    const trimmed = title.trim();
    if (!validateRoadmapTitle(trimmed)) {
      setError({
        code: null,
        hint: "Roadmap title must be non-empty, at most 200 characters, and free of control characters."
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await roadmapUpdate(profile, projectId, roadmapId, expectedVersion, trimmed, actor);
      await queryClient.invalidateQueries({ queryKey: [ID, "list", profile] });
      host3.notify({ kind: "success", title: "Roadmap renamed", message: `Renamed to "${trimmed}".` });
      onRenamed();
    } catch (err) {
      setError({ code: rpcError(err).code, hint: err?.hint });
    } finally {
      setBusy(false);
    }
  }, [actor, busy, expectedVersion, onRenamed, profile, projectId, queryClient, roadmapId, title]);
  return jsxs("div", {
    className: "flex flex-col gap-1 px-0.5",
    children: [
      jsxs("div", {
        className: "flex items-center gap-1.5",
        children: [
          jsx(Input, {
            value: title,
            onChange: (ev) => setTitle(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === "Enter") void submit();
              if (ev.key === "Escape") onCancel();
            },
            placeholder: "Roadmap title\u2026",
            autoFocus: true,
            disabled: busy,
            className: "h-6 w-48 px-1.5 text-xs",
            "aria-label": "Rename roadmap"
          }),
          jsx(Button, {
            type: "button",
            size: "xs",
            variant: "secondary",
            onClick: () => void submit(),
            disabled: busy || title.trim() === "",
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
function RoadmapMenu({ profile, projectId, roadmapId, roadmapTitle, expectedVersion, actor, onRequestRename, onArchived }) {
  const [confirmOpen, setConfirmOpen] = useState2(false);
  const [busy, setBusy] = useState2(false);
  const queryClient = useQueryClient();
  const archive = useCallback2(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await roadmapArchive(profile, projectId, roadmapId, expectedVersion, actor);
      await queryClient.invalidateQueries({ queryKey: [ID, "list", profile] });
      setConfirmOpen(false);
      host3.notify({ kind: "success", title: "Roadmap archived", message: `Archived "${roadmapTitle}".` });
      onArchived();
    } catch (err) {
      const ec = mutationErrorCopy({ code: rpcError(err).code });
      throw new Error(ec.hint);
    } finally {
      setBusy(false);
    }
  }, [actor, busy, expectedVersion, onArchived, profile, projectId, queryClient, roadmapId, roadmapTitle]);
  const hasRoadmap = roadmapId !== "";
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
              "aria-label": "Roadmap actions",
              disabled: !hasRoadmap,
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
                disabled: !hasRoadmap,
                children: [jsx(Codicon, { name: "edit", size: "0.75rem" }), "Rename"]
              }),
              jsx(CopyButton, { appearance: "menu-item", text: roadmapId, label: "Copy ID", disabled: !hasRoadmap }),
              jsx(DropdownMenuSeparator, {}),
              jsx(DropdownMenuItem, {
                variant: "destructive",
                disabled: !hasRoadmap,
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
        title: "Archive roadmap",
        description: `Archive "${roadmapTitle}"? The roadmap leaves the selector; its versions stay on the backend.`,
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
  roadmapId,
  setRoadmapId,
  setSelectedNodeId,
  projects,
  projectNameById,
  roadmapOptions,
  compact,
  roadmapsCount,
  projectsError,
  onRetryProjects,
  actor
}) {
  const [projectCreateOpen, setProjectCreateOpen] = useState3(false);
  const [projectRenameOpen, setProjectRenameOpen] = useState3(false);
  const [roadmapCreateOpen, setRoadmapCreateOpen] = useState3(false);
  const [roadmapRenameOpen, setRoadmapRenameOpen] = useState3(false);
  const queryClient = useQueryClient2();
  const selectProject = (v) => {
    setProjectId(v);
    setRoadmapId("");
    setSelectedNodeId("");
  };
  const selectRoadmap = (v) => {
    setRoadmapId(v);
    setSelectedNodeId("");
  };
  const currentName = projectNameById.get(projectId) || projectId;
  const selectedRoadmap = roadmapOptions.find((r) => r.roadmap_id === roadmapId) ?? null;
  const roadmapTitle = selectedRoadmap?.title || roadmapId;
  const roadmapActiveVersion = Number(selectedRoadmap?.active_version) || 0;
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
          jsxs2("div", {
            className: "flex items-center gap-1",
            children: [
              jsxs2("span", { className: "text-[0.625rem] text-(--ui-text-tertiary)", children: ["Roadmap"] }),
              jsx2(Select, {
                value: roadmapId,
                onValueChange: selectRoadmap,
                disabled: projectId === "",
                children: [
                  jsx2(SelectTrigger, {
                    className: "h-7 w-48 text-xs",
                    "aria-label": "Roadmap",
                    children: jsx2(SelectValue, { placeholder: projectId === "" ? "\u2014" : "select\u2026" })
                  }),
                  jsx2(SelectContent, {
                    children: roadmapOptions.length === 0 ? jsx2(SelectItem, { value: "__none__", disabled: true, children: "No roadmaps" }) : roadmapOptions.map(
                      (r) => jsx2(
                        SelectItem,
                        {
                          value: r.roadmap_id,
                          children: jsx2("span", {
                            className: "block min-w-0 truncate",
                            children: r.title || r.roadmap_id
                          })
                        },
                        r.roadmap_id
                      )
                    )
                  })
                ]
              }),
              // "+" — inline roadmap create form (roadmaps.create, T5b).
              jsx2(Button2, {
                type: "button",
                variant: "ghost",
                size: "icon-xs",
                "aria-label": "Create roadmap",
                disabled: projectId === "",
                onClick: () => setRoadmapCreateOpen((v) => !v),
                children: jsx2(Codicon2, { name: "add", size: "0.8rem" })
              }),
              // "⋮" — roadmap management menu (rename / archive / copy id).
              jsx2(RoadmapMenu, {
                profile,
                projectId,
                roadmapId,
                roadmapTitle,
                expectedVersion: roadmapActiveVersion,
                actor,
                onRequestRename: () => setRoadmapRenameOpen(true),
                onArchived: () => {
                  setRoadmapRenameOpen(false);
                  setRoadmapCreateOpen(false);
                }
              }),
              roadmapId !== "" ? jsx2(CopyButton2, {
                appearance: "icon",
                buttonSize: "icon-xs",
                buttonVariant: "ghost",
                text: roadmapId,
                title: "Copy roadmap ID",
                label: "Copy roadmap ID"
              }) : null
            ]
          }),
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
      }) : null,
      roadmapCreateOpen ? jsx2(RoadmapCreateForm, {
        profile,
        projectId,
        actor,
        onCreated: (id) => {
          selectRoadmap(id);
          setRoadmapCreateOpen(false);
        },
        onCancel: () => setRoadmapCreateOpen(false)
      }) : null,
      roadmapRenameOpen ? jsx2(RoadmapRenameForm, {
        profile,
        projectId,
        roadmapId,
        currentTitle: roadmapTitle,
        expectedVersion: roadmapActiveVersion,
        actor,
        onRenamed: () => {
          setRoadmapRenameOpen(false);
          void queryClient.invalidateQueries({ queryKey: [ID, "steer"] });
        },
        onCancel: () => setRoadmapRenameOpen(false)
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
import { useCallback as useCallback4, useMemo as useMemo4, useState as useState4 } from "react";
import { jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
import { Codicon as Codicon5, EmptyState as EmptyState2, cn as cn3 } from "@hermes/plugin-sdk";
var RELATION_LABEL = config_default.relation.label;
var RELATION_ICON = config_default.relation.icon;
function RelationRow({ rel, selectedNodeId, onSelect }) {
  const onFrom = useCallback4(() => onSelect(rel.from_node_id), [rel.from_node_id, onSelect]);
  const onTo = useCallback4(() => onSelect(rel.to_node_id), [rel.to_node_id, onSelect]);
  return jsxs6("div", {
    className: cn3(
      "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2 py-1.5 text-xs transition-colors",
      (rel.from_node_id === selectedNodeId || rel.to_node_id === selectedNodeId) && "bg-primary/[0.04]"
    ),
    children: [
      jsxs6("button", {
        type: "button",
        onClick: onFrom,
        className: cn3("min-w-0 truncate text-left hover:underline", rel.from_node_id === selectedNodeId ? "text-primary" : "text-foreground"),
        children: nodeLabel(rel.from)
      }),
      jsxs6("span", {
        className: "flex shrink-0 items-center gap-1 text-[0.625rem] uppercase tracking-wide text-(--ui-text-tertiary)",
        children: [jsx6(Codicon5, { name: RELATION_ICON[rel.kind] ?? "arrow-right", size: "0.65rem" }), RELATION_LABEL[rel.kind] ?? rel.kind]
      }),
      jsxs6("button", {
        type: "button",
        onClick: onTo,
        className: cn3("min-w-0 truncate text-right hover:underline", rel.to_node_id === selectedNodeId ? "text-primary" : "text-foreground"),
        children: nodeLabel(rel.to)
      })
    ]
  });
}
function MapView({ version, selectedId, onSelect }) {
  const [showInactive, setShowInactive] = useState4(false);
  const rels = useMemo4(() => mapRelations(version, { includeInactive: showInactive }), [version, showInactive]);
  return jsxs6("div", {
    className: "flex flex-col gap-1.5",
    children: [
      jsxs6(SectionTitle, {
        right: jsx6("button", {
          type: "button",
          onClick: () => setShowInactive((v) => !v),
          className: "rounded-[3px] px-1 text-[0.625rem] normal-case tracking-normal text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground",
          children: showInactive ? "active only" : "include inactive"
        }),
        children: ["Relations", ` (${rels.length})`]
      }),
      rels.length === 0 ? jsx6(EmptyState2, {
        title: showInactive ? "No relations" : "No active relations",
        description: "Each row is a canonical relation (depends on, blocks) of the active version."
      }) : jsxs6("div", {
        className: "flex flex-col divide-y divide-(--ui-stroke-tertiary)",
        children: rels.map((r) => jsx6(RelationRow, { rel: r, selectedNodeId: selectedId, onSelect }, r.relation_id))
      })
    ]
  });
}

// src/views/board.js
import { useCallback as useCallback5 } from "react";
import { jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
import { Button as Button3, Codicon as Codicon6, EmptyState as EmptyState3, ErrorState, Skeleton, StatusDot as StatusDot4, cn as cn4 } from "@hermes/plugin-sdk";
var CARD_TONE = config_default.board.cardTone;
function CardTag({ card }) {
  if (!card || card.found !== true) {
    return jsx7("span", {
      className: "inline-flex items-center text-[0.625rem] text-(--ui-text-quaternary)",
      children: "no card"
    });
  }
  return jsxs7("span", {
    className: "inline-flex items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)",
    children: [jsx7(StatusDot4, { tone: CARD_TONE[card.status] ?? "muted" }), jsx7("span", { children: card.status })]
  });
}
function WorkerTag({ worker }) {
  if (!worker) return null;
  const label = worker.lane ? worker.model ? `${worker.lane} \xB7 ${worker.model}` : worker.lane : worker.worker_id;
  return jsxs7("span", {
    className: "inline-flex min-w-0 items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)",
    children: [jsx7(Codicon6, { name: "person", size: "0.65rem" }), jsx7("span", { className: "truncate", children: label })]
  });
}
function TodoRow({ todo }) {
  return jsxs7("div", {
    className: "flex flex-col gap-0.5 py-0.5",
    children: [
      jsxs7("div", {
        className: "flex flex-wrap items-center gap-x-2 gap-y-0.5",
        children: [
          jsx7("span", { className: "min-w-0 flex-1 truncate text-xs", children: todo.todo.title }),
          jsx7(CardTag, { card: todo.card }),
          jsx7(WorkerTag, { worker: todo.worker })
        ]
      }),
      todo.todo.acceptance ? jsx7("div", { className: "truncate text-[0.625rem] text-(--ui-text-quaternary)", children: todo.todo.acceptance }) : null
    ]
  });
}
function PhaseGroup({ phase, selectedId, onSelect }) {
  const onClick = useCallback5(() => onSelect(phase.node_id), [phase.node_id, onSelect]);
  return jsxs7("div", {
    className: "flex flex-col border-l border-(--ui-stroke-tertiary) pl-2",
    children: [
      jsxs7("button", {
        type: "button",
        onClick,
        className: cn4(
          "flex items-center gap-1.5 px-1 py-1 text-left transition-colors",
          phase.node_id === selectedId ? "text-primary" : "text-(--ui-text-secondary) hover:text-foreground"
        ),
        children: [
          jsx7(Codicon6, { name: "chevron-right", size: "0.65rem", className: "shrink-0" }),
          jsx7("span", { className: "min-w-0 flex-1 truncate text-xs", children: nodeLabel(phase) }),
          jsx7(NodeStateTag, { state: phase.state })
        ]
      }),
      phase.todos.length === 0 ? jsx7("div", { className: "px-3 py-0.5 text-[0.625rem] text-(--ui-text-quaternary)", children: "No todos" }) : jsx7("div", {
        className: "flex flex-col pl-4",
        children: phase.todos.map((t) => jsx7(TodoRow, { todo: t }, t.todo.todo_id))
      })
    ]
  });
}
function MilestoneGroup({ milestone, selectedId, onSelect }) {
  const onClick = useCallback5(() => onSelect(milestone.node_id), [milestone.node_id, onSelect]);
  return jsxs7("div", {
    className: "flex flex-col",
    children: [
      jsxs7("button", {
        type: "button",
        onClick,
        className: cn4(
          "flex items-center gap-2 px-1 py-1.5 text-left transition-colors",
          milestone.node_id === selectedId ? "bg-primary/[0.06]" : "hover:bg-(--chrome-action-hover)"
        ),
        children: [
          jsx7(Codicon6, { name: "milestone", size: "0.7rem", className: "shrink-0 text-(--ui-text-tertiary)" }),
          jsx7("span", { className: "min-w-0 flex-1 truncate text-xs font-medium", children: nodeLabel(milestone) }),
          jsx7(NodeStateTag, { state: milestone.state })
        ]
      }),
      milestone.phases.length === 0 ? jsx7("div", { className: "px-2 py-0.5 text-[0.625rem] text-(--ui-text-quaternary)", children: "No phases" }) : jsx7("div", {
        className: "flex flex-col gap-1 pl-3",
        children: milestone.phases.map((p) => jsx7(PhaseGroup, { phase: p.phase, selectedId, onSelect }, p.phase.node_id))
      })
    ]
  });
}
function BoardView({ scope, selectedId, onSelect }) {
  const query = useRoadmapBoard(scope.profile, scope.projectId, scope.roadmapId, true);
  if (query.isLoading) {
    return jsx7(Skeleton, { className: "h-24 w-full" });
  }
  if (query.isError) {
    const err = errorCopy(query.error);
    return jsx7(ErrorState, {
      title: "Board unavailable",
      description: `${err.hint}${err.code != null ? ` (code ${err.code})` : ""}`,
      children: jsx7(Button3, {
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
    return jsx7(EmptyState3, {
      title: "No roadmap for this scope",
      description: "The board is unavailable for the selected roadmap."
    });
  }
  if (board.version == null) {
    return jsx7(EmptyState3, {
      title: "No active version",
      description: "This roadmap has no active version to display."
    });
  }
  const milestones = board.milestones ?? [];
  const objective = board.objective;
  const todoCount = milestones.reduce((n, m) => n + m.phases.reduce((p, ph) => p + ph.todos.length, 0), 0);
  return jsxs7("div", {
    className: "flex flex-col gap-2",
    children: [
      jsx7(SectionTitle, {
        right: jsx7("span", { className: "tabular-nums text-(--ui-text-quaternary)", children: plural(todoCount, "todo") }),
        children: "Board"
      }),
      objective ? jsxs7("div", {
        className: "flex flex-col gap-0.5 rounded-[3px] border border-(--ui-stroke-tertiary) px-2 py-1.5",
        children: [
          jsxs7("div", {
            className: "flex items-center gap-2",
            children: [
              jsx7(Codicon6, { name: "target", size: "0.7rem", className: "shrink-0 text-(--ui-text-tertiary)" }),
              jsx7("span", { className: "min-w-0 flex-1 truncate text-xs font-medium", children: nodeLabel(objective) }),
              jsx7(NodeStateTag, { state: objective.state })
            ]
          }),
          objective.description ? jsx7("div", { className: "truncate text-[0.625rem] text-(--ui-text-tertiary)", children: objective.description }) : null
        ]
      }) : null,
      milestones.length === 0 ? jsx7(EmptyState3, {
        title: "No milestones",
        description: "The active version contains no milestones to display."
      }) : jsx7("div", {
        className: "flex flex-col divide-y divide-(--ui-stroke-tertiary)",
        children: milestones.map((m) => jsx7(MilestoneGroup, { milestone: m, selectedId, onSelect }, m.milestone.node_id))
      })
    ]
  });
}

// src/views/plan.js
import { useCallback as useCallback6, useEffect as useEffect2, useMemo as useMemo5, useState as useState5 } from "react";
import { jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
import { Badge, Button as Button4, Codicon as Codicon7, EmptyState as EmptyState4, cn as cn5, host as host4, useQueryClient as useQueryClient3, useValue } from "@hermes/plugin-sdk";
function VersionRow({ v, active, activating, onActivate }) {
  const isActive = v.version === active;
  const canActivate = v.state === "validated" && !isActive;
  return jsxs8("div", {
    className: "relative flex gap-3 px-0.5 py-1.5",
    children: [
      jsx8("span", {
        className: cn5("relative z-10 mt-1.5 size-2 shrink-0 rounded-full", isActive ? "bg-(--ui-accent)" : "bg-(--ui-stroke-secondary)")
      }),
      jsxs8("div", {
        className: "min-w-0 flex-1",
        children: [
          jsxs8("div", {
            className: "flex flex-wrap items-center gap-2",
            children: [
              jsx8("span", {
                className: cn5("font-mono text-xs", isActive ? "font-semibold text-foreground" : "text-(--ui-text-secondary)"),
                children: `v${v.version}`
              }),
              isActive ? jsx8(Badge, { size: "xs", variant: "outline", children: "Active" }) : null,
              jsx8("span", { className: "font-mono text-[0.625rem] uppercase text-(--ui-text-tertiary)", children: v.state }),
              v.created_at ? jsx8("span", { className: "ml-auto text-[0.625rem] tabular-nums text-(--ui-text-quaternary)", children: formatDate(v.created_at) }) : null
            ]
          }),
          v.source ? jsxs8("div", {
            className: "mt-0.5 flex min-w-0 items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)",
            children: [jsx8("span", { className: "shrink-0 font-medium uppercase tracking-wide", children: "source" }), jsx8("span", { className: "truncate", children: v.source })]
          }) : null,
          v.reason ? jsx8("div", { className: "mt-0.5 line-clamp-2 text-[0.625rem] text-(--ui-text-tertiary)", children: v.reason }) : null,
          canActivate ? jsxs8("div", {
            className: "mt-1 flex items-center gap-1.5",
            children: [
              jsx8(Button4, {
                type: "button",
                size: "xs",
                variant: "secondary",
                disabled: activating !== null,
                onClick: () => onActivate(v.version),
                className: "gap-1",
                children: [jsx8(Codicon7, { name: "play", size: "0.7rem" }), activating === v.version ? "Activating\u2026" : "Activate"]
              }),
              jsx8("span", { className: "text-[0.625rem] text-(--ui-text-quaternary)", children: "Supersedes the currently active version." })
            ]
          }) : null
        ]
      })
    ]
  });
}
function VisionDraftCard({ preview, draftText, activeSessionId, visionSid, saveBusy, onSave }) {
  const hasPreview = preview !== null;
  return jsxs8("div", {
    className: "rounded-[3px] border border-(--ui-stroke-tertiary) px-2 py-1.5",
    children: [
      jsx8(SectionTitle, {
        right: jsx8(Button4, {
          type: "button",
          size: "xs",
          variant: "secondary",
          onClick: onSave,
          disabled: !hasPreview || saveBusy,
          className: "gap-1",
          children: [jsx8(Codicon7, { name: "pass-filled", size: "0.7rem" }), saveBusy ? "Saving\u2026" : "Save plan"]
        }),
        children: "Vision draft"
      }),
      hasPreview ? jsxs8("div", {
        className: "flex flex-col gap-1",
        children: [
          jsx8("div", { className: "truncate text-xs font-medium", children: preview.title || "Untitled plan" }),
          preview.kinds.length > 0 ? jsxs8("div", {
            className: "flex flex-wrap gap-1",
            children: preview.kinds.map((k) => jsx8(Badge, { size: "xs", variant: "outline", children: k }, k))
          }) : null,
          jsx8("div", {
            className: "flex flex-wrap items-center gap-1.5 text-[0.625rem] text-(--ui-text-quaternary)",
            children: `${plural(preview.counts.nodes, "node")} \xB7 ${plural(preview.counts.relations, "relation")} \xB7 ${plural(preview.counts.todos, "todo")}`
          })
        ]
      }) : jsxs8("div", {
        className: "flex items-center gap-1.5 text-[0.625rem] text-(--ui-text-tertiary)",
        children: [
          jsx8("span", {
            className: "truncate",
            children: activeSessionId === visionSid ? "Drafting in the Vision chat\u2026" : "Waiting for the Vision session to produce a plan draft\u2026"
          }),
          draftText ? jsx8("span", { className: "shrink-0 tabular-nums text-(--ui-text-quaternary)", children: `${draftText.length} chars` }) : null
        ]
      })
    ]
  });
}
function PlanView({ snapshot, scope, actor, onMutated }) {
  const queryClient = useQueryClient3();
  const versions = planVersions(snapshot);
  const active = snapshot?.roadmap?.active_version;
  const activeSessionId = useValue(host4.state.activeSessionId);
  const [createBusy, setCreateBusy] = useState5(false);
  const [visionSid, setVisionSid] = useState5(null);
  const [draftText, setDraftText] = useState5("");
  const [saveBusy, setSaveBusy] = useState5(false);
  const [activating, setActivating] = useState5(null);
  const [error, setError] = useState5(null);
  const scopeKey = scope ? `${scope.profile}/${scope.projectId}/${scope.roadmapId}` : "";
  useEffect2(() => {
    setVisionSid(null);
    setDraftText("");
    setError(null);
  }, [scopeKey]);
  useEffect2(() => {
    if (!visionSid) return void 0;
    return host4.onEvent("message.delta", (ev) => {
      if (ev.session_id !== visionSid) return;
      const text = ev.payload?.text;
      if (typeof text === "string" && text !== "") setDraftText((cur) => cur + text);
    });
  }, [visionSid]);
  useEffect2(() => {
    if (!visionSid) return void 0;
    return host4.onEvent("message.complete", (ev) => {
      if (ev.session_id !== visionSid) return;
      if (ev.payload?.status === "error") {
        setError(
          (cur) => cur ? cur : { code: null, hint: "The Vision session ended with an error before a plan draft was produced. Try Create again." }
        );
      }
    });
  }, [visionSid]);
  const preview = useMemo5(() => {
    if (!draftText.trim()) return null;
    const block = extractPlanJsonBlock(draftText);
    return block ? planPreviewFromJson(block) : null;
  }, [draftText]);
  const startVision = useCallback6(async () => {
    if (!scope || createBusy) return;
    setCreateBusy(true);
    setError(null);
    try {
      const rules = await getPlanningRules();
      const created = await visionSessionCreate(scope.profile, rules.rules.prompt);
      setVisionSid(created.session_id);
      setDraftText("");
      await host4.openSession(created.stored_session_id, { profile: scope.profile });
    } catch (err) {
      setError({ code: rpcError(err).code });
    } finally {
      setCreateBusy(false);
    }
  }, [createBusy, scope]);
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
          source: "vision",
          reason: "Draft created in the Vision session."
        },
        actor
      );
      await queryClient.invalidateQueries({ queryKey: [ID, "list", scope.profile] });
      await queryClient.invalidateQueries({ queryKey: [ID, "steer", scope.profile, scope.projectId, scope.roadmapId] });
      if (onMutated) onMutated();
      host4.notify({ kind: "success", title: "Plan saved", message: `Plan version saved (${preview.counts.nodes} nodes, ${preview.counts.relations} relations, ${preview.counts.todos} todos).` });
      setDraftText("");
    } catch (err) {
      setError({ code: rpcError(err).code });
    } finally {
      setSaveBusy(false);
    }
  }, [actor, onMutated, preview, queryClient, saveBusy, scope]);
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
        host4.notify({ kind: "success", title: "Plan activated", message: `Version ${version} is now active.` });
      } catch (err) {
        setError({ code: rpcError(err).code });
      } finally {
        setActivating(null);
      }
    },
    [activating, actor, onMutated, queryClient, scope, snapshot]
  );
  const ec = mutationErrorCopy(error);
  return jsxs8("div", {
    className: "flex flex-col gap-1.5",
    children: [
      jsxs8("div", {
        className: "flex items-center justify-between gap-2 px-0.5",
        children: [
          jsx8(SectionTitle, {
            right: jsx8("span", { className: "tabular-nums text-(--ui-text-quaternary)", children: plural(versions.length, "version") }),
            children: "Plan history"
          }),
          jsx8(Button4, {
            type: "button",
            size: "xs",
            variant: "secondary",
            disabled: !scope || createBusy,
            onClick: () => void startVision(),
            title: "Open a Vision session seeded with the planning rules",
            className: "gap-1",
            children: [jsx8(Codicon7, { name: "add", size: "0.7rem" }), createBusy ? "Starting\u2026" : "Create"]
          })
        ]
      }),
      visionSid ? jsx8(VisionDraftCard, { preview, draftText, activeSessionId, visionSid, saveBusy, onSave: () => void savePlan() }) : null,
      error && ec ? jsxs8("div", {
        className: "flex items-start gap-1.5 rounded-[3px] bg-destructive/10 px-2 py-1 text-xs text-destructive",
        children: [
          jsx8(Codicon7, { name: "error", size: "0.75rem", className: "mt-px shrink-0" }),
          jsxs8("span", { children: [ec.hint, ec.code != null ? ` (code ${ec.code})` : ""] })
        ]
      }) : null,
      versions.length === 0 ? jsx8(EmptyState4, {
        title: "No versions yet",
        description: "Create a plan draft from a Vision session \u2014 the first published version lands here once saved."
      }) : jsxs8("div", {
        className: "relative mt-1 flex flex-col",
        children: [
          jsx8("span", { className: "absolute bottom-2 left-[3px] top-2 w-px bg-(--ui-stroke-tertiary)" }),
          versions.map((v) => jsx8(VersionRow, { v, active, activating, onActivate: (version) => void activate(version) }, String(v.version)))
        ]
      })
    ]
  });
}

// src/views/milestones.js
import { useCallback as useCallback7, useMemo as useMemo6 } from "react";
import { jsx as jsx9, jsxs as jsxs9 } from "react/jsx-runtime";
import { Codicon as Codicon8, EmptyState as EmptyState5, StatusDot as StatusDot5, cn as cn6 } from "@hermes/plugin-sdk";
function MilestoneRow({ node, selected, onSelect, compact }) {
  const onClick = useCallback7(() => onSelect(node.node_id), [node.node_id, onSelect]);
  return jsxs9("button", {
    type: "button",
    onClick,
    className: cn6(
      "group flex w-full flex-col gap-1 px-2 py-1.5 text-left transition-colors",
      selected ? "bg-primary/[0.06]" : "hover:bg-(--chrome-action-hover)"
    ),
    children: [
      jsxs9("div", {
        className: "flex items-center gap-2",
        children: [
          jsx9(StatusDot5, { tone: NODE_TONE[node.state] ?? "muted" }),
          jsx9("span", { className: "min-w-0 flex-1 truncate text-xs font-medium", children: nodeLabel(node) }),
          !compact ? jsx9("span", { className: "font-mono text-[0.6rem] uppercase text-(--ui-text-quaternary)", children: node.kind }) : null,
          !compact ? jsx9(NodeStateTag, { state: node.state }) : null
        ]
      }),
      jsxs9("div", {
        className: "flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-3.5",
        children: [
          jsx9(ProgressBar, { value: node.progress }),
          node.owner_agent ? jsxs9("span", {
            className: "inline-flex min-w-0 items-center gap-1 truncate text-[0.625rem] text-(--ui-text-tertiary)",
            children: [jsx9(Codicon8, { name: "person", size: "0.65rem" }), jsx9("span", { className: "truncate", children: node.owner_agent })]
          }) : null
        ]
      })
    ]
  });
}
function MilestonesView({ version, selectedId, onSelect, compact }) {
  const nodes = useMemo6(() => milestoneNodes(version), [version]);
  const groups = useMemo6(() => groupMilestones(version), [version]);
  if (nodes.length === 0) {
    return jsx9(EmptyState5, {
      title: "No milestones",
      description: "The active version contains no milestones or objectives."
    });
  }
  return jsxs9("div", {
    className: "flex flex-col gap-2",
    children: [
      jsx9(SectionTitle, {
        right: jsx9("span", { className: "tabular-nums text-(--ui-text-quaternary)", children: plural(nodes.length, "item") }),
        children: "Milestones & objectives"
      }),
      groups.map(
        (g, gi) => jsxs9(
          "div",
          {
            className: "flex flex-col",
            children: [
              g.label ? jsxs9("div", {
                className: "flex items-center gap-1 px-1 py-1 text-[0.625rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)",
                children: [
                  jsx9(Codicon8, { name: "milestone", size: "0.65rem" }),
                  jsx9("span", { className: "truncate", children: g.label }),
                  jsx9("span", { className: "tabular-nums text-(--ui-text-quaternary)", children: g.nodes.length })
                ]
              }) : null,
              jsxs9("div", {
                className: "flex flex-col divide-y divide-(--ui-stroke-tertiary)",
                children: g.nodes.map((n) => jsx9(MilestoneRow, { node: n, selected: n.node_id === selectedId, onSelect, compact }, n.node_id))
              })
            ]
          },
          `group-${gi}`
        )
      )
    ]
  });
}

// src/views/decisions.js
import { jsx as jsx10 } from "react/jsx-runtime";
import { EmptyState as EmptyState6 } from "@hermes/plugin-sdk";
function DecisionsView() {
  return jsx10(EmptyState6, {
    title: "No decisions recorded",
    description: "Plan governance is coming (Phase 6) \u2014 proposing, validating, and revising a version will record each decision here."
  });
}

// src/views/files.js
import { jsx as jsx11 } from "react/jsx-runtime";
import { EmptyState as EmptyState7 } from "@hermes/plugin-sdk";
function FilesView() {
  return jsx11(EmptyState7, {
    title: "No attached files",
    description: "Evidence is coming (Phase 5) \u2014 files linked to nodes and versions will be listed here."
  });
}

// src/views/vision.js
import { jsx as jsx12 } from "react/jsx-runtime";
import { SessionSurface } from "@hermes/plugin-sdk";
function VisionLane({ session }) {
  return jsx12("div", {
    className: "flex min-h-0 flex-1 flex-col",
    children: jsx12(SessionSurface, { session })
  });
}

// src/inspector.js
import { useCallback as useCallback8, useEffect as useEffect3, useMemo as useMemo7, useState as useState6 } from "react";
import { jsx as jsx13, jsxs as jsxs10 } from "react/jsx-runtime";
import { Button as Button5, Codicon as Codicon9, CopyButton as CopyButton3, EmptyState as EmptyState8, Input as Input2, Separator, StatusDot as StatusDot6, cn as cn7, host as host5 } from "@hermes/plugin-sdk";
function MutationButton({ label, codicon, onClick, busy, disabled, tone }) {
  return jsxs10(Button5, {
    type: "button",
    variant: tone === "danger" ? "destructive" : "secondary",
    size: "xs",
    onClick,
    disabled: disabled || busy,
    className: "gap-1",
    children: [jsx13(Codicon9, { name: codicon, size: "0.75rem" }), label]
  });
}
function TodoRow2({ todo, onMutate, busyTodoId }) {
  const done = todo.state === "done" || todo.state === "cancelled";
  return jsxs10("div", {
    className: "flex items-center gap-2 px-0.5 py-0.5 text-xs",
    children: [
      jsx13(StatusDot6, { tone: done ? "muted" : "good" }),
      jsx13("span", {
        className: cn7("min-w-0 flex-1 truncate", done && "line-through opacity-60"),
        children: todo.title
      }),
      jsxs10("div", {
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
  return jsxs10("div", {
    className: "flex items-start gap-2 text-[0.625rem]",
    children: [
      jsxs10("span", {
        className: "mt-px inline-flex w-16 shrink-0 items-center gap-1 font-medium uppercase tracking-wide text-(--ui-text-tertiary)",
        children: [jsx13(Codicon9, { name: codicon, size: "0.65rem" }), title]
      }),
      jsxs10("div", {
        className: "flex min-w-0 flex-wrap gap-1",
        children: items.map(
          (it) => jsx13(
            "button",
            {
              type: "button",
              onClick: () => onSelect(it.id),
              title: it.hint,
              className: cn7(
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
  const [progressInput, setProgressInput] = useState6("");
  const [reason, setReason] = useState6("");
  const [busyOp, setBusyOp] = useState6(null);
  const [busyTodoId, setBusyTodoId] = useState6(null);
  const [error, setError] = useState6(null);
  const node = (version?.nodes ?? []).find((n) => n.node_id === nodeId) ?? null;
  const todos = (version?.todos ?? []).filter((t) => t.node_id === nodeId);
  const expectedVersion = snapshot?.roadmap?.active_version;
  const deps = useMemo7(() => node ? nodeDepsInfo(node, version) : null, [node, version]);
  const dependants = useMemo7(() => node ? nodeDependants(node, version) : [], [node, version]);
  const blockers = useMemo7(() => node ? nodeBlockers(node, version) : [], [node, version]);
  const blocks = useMemo7(() => node ? nodeBlocks(node, version) : [], [node, version]);
  useEffect3(() => {
    setProgressInput("");
    setReason("");
    setError(null);
  }, [nodeId]);
  const guardActor = useCallback8(() => {
    const sent = actor.trim() || "user";
    if (isValidIdentifier(sent)) return true;
    setError({ code: null, hint: "Actor must be a valid identifier: non-empty, at most 128 characters, no control characters." });
    return false;
  }, [actor]);
  const mutate = useCallback8(
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
        await host5.request(RPC[op], {
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
  const mutateTodo = useCallback8(
    async (todoId, state) => {
      if (!scope || !guardActor()) return;
      setBusyTodoId(todoId);
      setError(null);
      try {
        await host5.request(RPC.update_todo, {
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
    return jsx13(EmptyState8, {
      title: "No node selected",
      description: "Pick a node in the Thread, Map, or Milestones view."
    });
  }
  const ec = mutationErrorCopy(error);
  return jsxs10("div", {
    className: "flex flex-col gap-2",
    children: [
      jsx13(SectionTitle, { children: "Inspector" }),
      jsxs10("div", {
        className: "flex items-start justify-between gap-2 px-0.5",
        children: [
          jsxs10("div", {
            className: "min-w-0",
            children: [
              jsxs10("div", {
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
      jsxs10("div", {
        className: "flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-[0.625rem] text-(--ui-text-tertiary)",
        children: [
          jsxs10("span", { children: ["Progress: ", node.progress ?? 0, " %"] }),
          node.owner_agent ? jsxs10("span", { children: ["Owner: ", node.owner_agent] }) : jsx13("span", { children: "Owner: \u2014" }),
          node.parent_node_id ? jsxs10("span", { children: ["Parent: ", node.parent_node_id] }) : null,
          node.created_at ? jsxs10("span", { className: "tabular-nums", children: [formatDate(node.created_at)] }) : null
        ]
      }),
      // Dependencies — the depends_on drill-down (satisfied or not).
      jsxs10("div", {
        className: "flex flex-col gap-0.5 px-0.5",
        children: [
          jsxs10(SectionTitle, {
            right: deps ? jsx13("span", {
              className: cn7("tabular-nums", deps.satisfied === deps.total ? "text-(--ui-text-tertiary)" : "text-amber-500/90 dark:text-amber-300/90"),
              children: deps.total === 0 ? "none" : `${deps.satisfied}/${deps.total} satisfied`
            }) : null,
            children: "Dependencies"
          }),
          deps && deps.total > 0 ? jsxs10("div", {
            className: "flex flex-col divide-y divide-(--ui-stroke-tertiary)",
            children: deps.deps.map(
              (d) => jsxs10(
                "div",
                {
                  className: "flex items-center gap-1.5 py-0.5 text-[0.625rem]",
                  children: [
                    jsx13(Codicon9, {
                      name: d.satisfied ? "check" : "hourglass",
                      size: "0.65rem",
                      className: d.satisfied ? "shrink-0 text-(--ui-accent)" : "shrink-0 text-amber-500/90 dark:text-amber-300/90"
                    }),
                    d.target ? jsxs10("button", {
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
      jsxs10("div", {
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
      todos.length > 0 ? jsxs10("div", {
        className: "flex flex-col gap-0.5 px-0.5",
        children: [
          jsx13(SectionTitle, {
            right: jsx13("span", { className: "tabular-nums text-(--ui-text-quaternary)", children: plural(todos.length, "todo") }),
            children: "Todos"
          }),
          jsxs10("div", {
            className: "flex flex-col divide-y divide-(--ui-stroke-tertiary)",
            children: todos.map((t) => jsx13(TodoRow2, { todo: t, onMutate: mutateTodo, busyTodoId }, t.todo_id))
          })
        ]
      }) : null,
      jsx13(Separator, { className: "my-0.5" }),
      // Actor + expected_version context row — always visible before acting.
      jsxs10("div", {
        className: "flex flex-wrap items-center gap-2 px-0.5",
        children: [
          jsxs10("label", {
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
          jsxs10("span", {
            className: "font-mono text-[0.6rem] text-(--ui-text-quaternary)",
            children: ["expected_version = ", String(expectedVersion)]
          })
        ]
      }),
      error && ec ? jsxs10("div", {
        className: "flex items-start gap-2 rounded-[3px] bg-destructive/10 px-2 py-1.5 text-xs text-destructive",
        children: [
          jsx13(Codicon9, { name: "error", size: "0.85rem", className: "mt-px shrink-0" }),
          jsxs10("div", {
            className: "min-w-0 flex-1",
            children: [
              jsxs10("div", {
                className: "font-medium",
                children: [ec.title, ec.code != null ? ` (code ${ec.code})` : ""]
              }),
              jsx13("div", { className: "mt-0.5 opacity-90", children: ec.hint })
            ]
          }),
          error.code === 5064 || error.code === 5065 ? jsx13(Button5, {
            type: "button",
            variant: "secondary",
            size: "xs",
            onClick: onMutated,
            children: "Reload snapshot"
          }) : null
        ]
      }) : null,
      // Node actions — availability mirrors the node's lifecycle state.
      jsxs10("div", {
        className: "flex flex-wrap items-center gap-1.5 px-0.5",
        children: [
          jsx13(MutationButton, {
            label: "Claim",
            codicon: "person-add",
            busy: busyOp === "claim_node",
            disabled: node.state !== "ready",
            onClick: () => mutate("claim_node")
          }),
          jsxs10("div", {
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
          }) : jsxs10("div", {
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
var INSPECTOR_TABS = /* @__PURE__ */ new Set(["thread", "map", "milestones", "board"]);
function ViewTabs({ active, onChange }) {
  return jsxs11("div", {
    className: "flex flex-wrap items-center gap-4 px-0.5",
    children: config_default.tabs.map(
      (t) => jsx14(
        "button",
        {
          type: "button",
          onClick: () => onChange(t.id),
          title: t.label,
          className: cn8(
            "inline-flex items-center gap-1 border-b-2 px-0.5 pb-1.5 pt-0.5 text-xs transition-colors",
            active === t.id ? "border-(--ui-accent) font-medium text-foreground" : "border-transparent text-(--ui-text-tertiary) hover:text-foreground"
          ),
          children: [jsx14(Codicon10, { name: t.codicon, size: "0.7rem" }), jsx14("span", { children: t.label })]
        },
        t.id
      )
    )
  });
}
function ActiveView({ tab, snapshot, version, selectedId, onSelect, compact, dense, scope, actor, onMutated }) {
  if (tab === "thread") {
    return jsx14(ThreadView, { version, selectedId, onSelect, compact, dense });
  }
  if (tab === "map") {
    return jsx14(MapView, { version, selectedId, onSelect });
  }
  if (tab === "board") {
    return jsx14(BoardView, { scope, selectedId, onSelect });
  }
  if (tab === "plan") {
    return jsx14(PlanView, { snapshot, scope, actor, onMutated });
  }
  if (tab === "milestones") {
    return jsx14(MilestonesView, { version, selectedId, onSelect, compact });
  }
  if (tab === "decisions") {
    return jsx14(DecisionsView, {});
  }
  return jsx14(FilesView, {});
}
function GridColumn({ header, divider, children }) {
  return jsxs11("div", {
    className: cn8("flex min-h-0 min-w-0 flex-col gap-1.5", divider && "border-l border-(--ui-stroke-tertiary) pl-2.5"),
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
      className: cn8(
        "inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 text-[0.625rem] transition-colors",
        pane === key ? "bg-(--ui-bg-elevated) font-medium text-foreground" : "text-(--ui-text-tertiary) hover:text-foreground"
      ),
      children: [jsx14(Codicon10, { name: codicon, size: "0.65rem" }), jsx14("span", { children: label })]
    },
    key
  );
  return jsxs11("div", {
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
  const [midPane, setMidPane] = useState7("inspector");
  const pane = canInspect ? midPane : "view";
  const thread = jsx14(ThreadView, { version, selectedId: selectedNodeId, onSelect, dense: true });
  const view = jsx14(ActiveView, { tab: activeTab, snapshot, version, selectedId: selectedNodeId, onSelect, compact, dense: true, scope, actor, onMutated });
  const inspector = jsx14(Inspector, { snapshot, version, nodeId: selectedNodeId, scope, onMutated, compact, actor, setActor, onSelect });
  if (mode === "wide") {
    return jsxs11("div", {
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
    return jsxs11("div", {
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
  return jsxs11("div", {
    className: "flex min-h-0 flex-1 flex-col gap-2",
    children: [
      jsx14(ScrollArea, { className: "min-h-0 flex-1 px-0.5", children: view }),
      compact && canInspect && inspectorOpen ? jsxs11("div", {
        className: "flex min-h-0 flex-1 flex-col border-t border-(--ui-stroke-tertiary) pt-1.5",
        children: [jsx14(ScrollArea, { className: "min-h-0 flex-1 px-0.5", children: inspector })]
      }) : null
    ]
  });
}
function DraftPlanWorkspace({ actor, expectedVersion, scope }) {
  const [visionSession, setVisionSession] = useState7(null);
  const [busy, setBusy] = useState7(false);
  const [error, setError] = useState7(null);
  const start = useCallback9(async () => {
    if (!scope || busy) return;
    setBusy(true);
    setError(null);
    try {
      const rules = await getPlanningRules();
      const identity = await startVisionSession(scope.profile, rules.rules.prompt);
      await attachVisionSession(
        scope.profile,
        scope.projectId,
        scope.roadmapId,
        identity.storedSessionId,
        expectedVersion,
        actor,
        null
      );
      setVisionSession(identity);
      host6.notify({ kind: "success", title: "Vision ready", message: "The Vision session is ready. Plan first, then propose the plan." });
    } catch (err) {
      setError({ code: rpcError(err).code });
    } finally {
      setBusy(false);
    }
  }, [actor, busy, expectedVersion, scope]);
  const ec = mutationErrorCopy(error);
  return jsxs11("div", {
    className: "flex min-h-0 flex-1 flex-col gap-2",
    children: [
      visionSession ? jsx14(VisionLane, { session: visionSession }) : jsx14(EmptyState9, {
        title: "Planning required",
        description: "Start a Vision session to draft the roadmap plan. No execution workspace is available until a plan is proposed, validated, and started."
      }),
      error && ec ? jsxs11("div", {
        className: "flex items-start gap-1.5 rounded-[3px] bg-destructive/10 px-2 py-1 text-xs text-destructive",
        children: [
          jsx14(Codicon10, { name: "error", size: "0.75rem", className: "mt-px shrink-0" }),
          jsxs11("span", { children: [ec.hint, ec.code != null ? ` (code ${ec.code})` : ""] })
        ]
      }) : null,
      jsxs11("div", {
        className: "sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-(--ui-stroke-tertiary) bg-(--ui-bg) px-0.5 py-2",
        children: [
          jsx14("span", { className: "text-[0.625rem] text-(--ui-text-tertiary)", children: "Plan first \u2014 propose a plan to unlock execution." }),
          jsxs11("div", {
            className: "flex items-center gap-2",
            children: [
              jsx14(Button6, {
                type: "button",
                size: "xs",
                variant: visionSession ? "secondary" : "default",
                disabled: busy,
                onClick: () => void start(),
                className: "gap-1",
                children: [jsx14(Codicon10, { name: visionSession ? "debug-restart" : "add", size: "0.7rem" }), busy ? "Starting\u2026" : "Start planning"]
              }),
              jsx14(Button6, {
                type: "button",
                size: "xs",
                variant: "default",
                disabled: true,
                title: "Available once the Vision draft is parsed into a proposable plan.",
                className: "gap-1",
                children: [jsx14(Codicon10, { name: "pass-filled", size: "0.7rem" }), "Propose plan"]
              })
            ]
          })
        ]
      })
    ]
  });
}
function RoadmapsPage() {
  const profile = useValue2(host6.state.profile);
  const viewport = useValue2(host6.state.viewport);
  const [activeTab, setActiveTab] = useState7("thread");
  const [actor, setActor] = useState7("user");
  const [inspectorOpen, setInspectorOpen] = useState7(false);
  const { containerRef, mode, compact } = useLayoutMode(viewport?.width ?? 0);
  const profileReady = typeof profile === "string" && profile.trim() !== "";
  const listQuery = useRoadmapsList(profile, profileReady);
  const projectsQuery = useProjectsList(profile, profileReady);
  const roadmaps = listQuery.data?.roadmaps ?? [];
  const projectsData = projectsQuery.data?.projects ?? [];
  const { projectId, setProjectId, roadmapId, setRoadmapId, projectNameById, projects, roadmapOptions } = useScopeState(projectsData, roadmaps);
  const scopeReady = profileReady && projectId !== "" && roadmapId !== "";
  const snapshotQuery = useRoadmapSnapshot(profile, projectId, roadmapId, scopeReady);
  const snapshot = snapshotQuery.data;
  const found = snapshot?.found === true;
  const version = useMemo8(() => activeVersion(snapshot), [snapshot]);
  const productState = useMemo8(() => deriveProductState(snapshot), [snapshot]);
  const { selectedNodeId, setSelectedNodeId, onSelect } = useNodeSelection([profile, projectId, roadmapId], version);
  const reloadSnapshot = useCallback9(() => {
    void snapshotQuery.refetch();
  }, [snapshotQuery]);
  const scope = scopeReady ? { profile, projectId, roadmapId } : null;
  const canInspect = selectedNodeId !== "" && INSPECTOR_TABS.has(activeTab);
  if (!profileReady) {
    return jsx14(EmptyState9, {
      title: "Profile not initialized",
      description: 'No active profile identity is available. Roadmaps refuses to guess a profile (no silent fallback to "default").'
    });
  }
  const listError = listQuery.isError ? errorCopy(listQuery.error) : null;
  const snapshotError = snapshotQuery.isError ? errorCopy(snapshotQuery.error) : null;
  const panel = (content2) => jsx14(ScrollArea, { className: "min-h-0 flex-1 px-0.5", children: content2 });
  const needsVersion = activeTab === "thread" || activeTab === "map" || activeTab === "milestones";
  let content;
  if (!scopeReady) {
    content = panel(
      jsx14(EmptyState9, {
        title: "Select a project and a roadmap\u2026",
        description: "The Thread, Map, Plan, Milestones, Decisions, and Files views appear once a project and a roadmap are chosen."
      })
    );
  } else if (snapshotQuery.isLoading) {
    content = panel(jsx14(Skeleton2, { className: "h-24 w-full" }));
  } else if (snapshotQuery.isError) {
    content = panel(
      jsx14(ErrorState2, {
        title: "Snapshot unavailable",
        description: `${snapshotError.hint}${snapshotError.code != null ? ` (code ${snapshotError.code})` : ""}`,
        children: jsx14(Button6, {
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
      jsx14(EmptyState9, {
        title: "No roadmap for this scope",
        description: `No roadmap found for ${projectId} / ${roadmapId} in profile ${profile}.`
      })
    );
  } else if (productState === "DRAFT_NO_PLAN") {
    content = jsx14(DraftPlanWorkspace, {
      key: `${profile}/${projectId}/${roadmapId}`,
      actor,
      expectedVersion: snapshot.roadmap.active_version ?? 0,
      scope
    });
  } else if (needsVersion && !version) {
    content = panel(
      jsx14(EmptyState9, {
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
  return jsxs11("div", {
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
        roadmapId,
        setRoadmapId,
        setSelectedNodeId,
        projects,
        projectNameById,
        roadmapOptions,
        compact,
        roadmapsCount: roadmaps.length,
        projectsError: projectsQuery.isError ? errorCopy(projectsQuery.error) : null,
        onRetryProjects: () => void projectsQuery.refetch(),
        actor
      }),
      // List states: explicit error (with retry) before any empty state.
      listError ? jsx14(ErrorState2, {
        title: "Roadmap list unavailable",
        description: `${listError.hint}${listError.code != null ? ` (code ${listError.code})` : ""}`,
        children: jsx14(Button6, {
          type: "button",
          size: "xs",
          variant: "secondary",
          onClick: () => void listQuery.refetch(),
          children: "Retry"
        })
      }) : projectId !== "" && roadmapOptions.length === 0 && !listQuery.isLoading ? jsx14(EmptyState9, {
        title: "No roadmaps for this scope",
        description: `Project "${projectNameById.get(projectId) || projectId}" has no roadmaps in profile ${profile}. Create one on the backend (projects.db remains the source of truth).`
      }) : null,
      // Roadmap header (title + lifecycle + version) once a roadmap is chosen.
      found && snapshot?.roadmap ? jsxs11("div", {
        className: "flex flex-wrap items-center gap-2 border-b border-(--ui-stroke-tertiary) px-0.5 pb-2",
        children: [
          jsxs11("div", {
            className: "min-w-0 flex-1",
            children: [
              jsx14("div", { className: "truncate text-[0.8125rem] font-medium", children: snapshot.roadmap.title || roadmapId }),
              !compact && snapshot.roadmap.purpose ? jsx14("div", { className: "truncate text-[0.625rem] text-(--ui-text-tertiary)", children: snapshot.roadmap.purpose }) : null
            ]
          }),
          jsxs11(Badge2, { size: "xs", variant: "outline", children: [jsx14(StatusDot7, { tone: "good" }), snapshot.roadmap.lifecycle_state] }),
          jsxs11("span", { className: "font-mono text-[0.625rem] text-(--ui-text-tertiary)", children: ["v", String(snapshot.roadmap.active_version)] }),
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
      scopeReady ? jsxs11("div", {
        className: "flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-(--ui-stroke-tertiary)",
        children: [
          jsx14(ViewTabs, { active: activeTab, onChange: setActiveTab }),
          compact && canInspect ? jsx14(Button6, {
            type: "button",
            variant: inspectorOpen ? "secondary" : "ghost",
            size: "xs",
            onClick: () => setInspectorOpen((v) => !v),
            className: "gap-1",
            children: [jsx14(Codicon10, { name: "info", size: "0.7rem" }), "Details"]
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
