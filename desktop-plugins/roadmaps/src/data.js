/**
 * Roadmaps plugin — data layer.
 *
 * Everything that talks to the gateway (host.request), validates RPC
 * responses/inputs, carries the stable English error copy, and derives data
 * from a roadmap snapshot. The backend owns the business rules; this module
 * only reads and labels them — the plugin stays a pure renderer.
 */

import { host } from '@hermes/plugin-sdk'
import config from './config.json'

/** Plugin id — stable identity used in query keys and registration. */
export const ID = 'roadmaps'

/** RPC surface used by this plugin (gateway JSON-RPC via host.request). */
export const RPC = {
  list: 'roadmaps.list',
  snapshot: 'roadmaps.snapshot',
  board: 'roadmaps.board',
  claim_node: 'roadmaps.claim_node',
  update_progress: 'roadmaps.update_progress',
  complete_node: 'roadmaps.complete_node',
  block_node: 'roadmaps.block_node',
  unblock_node: 'roadmaps.unblock_node',
  update_todo: 'roadmaps.update_todo',
  projects_list: 'projects.list',
  projects_create: 'projects.create',
  projects_update: 'projects.update',
  projects_archive: 'projects.archive',
  roadmaps_create: 'roadmaps.create',
  roadmaps_update: 'roadmaps.update',
  roadmaps_archive: 'roadmaps.archive',
  plans_list: 'plans.list',
  plans_get: 'plans.get',
  planning_rules: 'roadmaps.planning_rules',
  roadmap_sessions: 'roadmaps.sessions',
  attach_session: 'roadmaps.attach_session',
  plans_create: 'plans.create',
  plans_activate: 'plans.activate',
  plans_check: 'plans.check',
  team_list: 'team.list',
  team_check: 'team.check',
  readiness_list: 'readiness.list',
  readiness_check: 'readiness.check'
}

/** Machine-state sort order for the thread view (config-driven). */
export const NODE_ORDER = config.states.order

/**
 * Stable English copy per mutation/query error code. The backend message is
 * NEVER displayed — only this guidance, keyed by the structured code.
 */
export const ERROR_GUIDANCE = {
  5061: {
    title: 'Service unavailable',
    hint: 'The roadmaps backend is temporarily unavailable. Try again in a moment.'
  },
  5062: {
    title: 'Not found',
    hint: 'The project no longer exists in this profile. Reload the project list.'
  },
  5063: {
    title: 'Invalid parameters',
    hint: 'The scope (profile, project, roadmap) or one of the fields is invalid. Check the selection, then try again.'
  },
  5064: {
    title: 'Stale version',
    hint: 'The roadmap changed since this snapshot was loaded. Reload the snapshot, then retry the action.'
  },
  5065: {
    title: 'Not found',
    hint: 'The roadmap, node, or todo no longer exists in this scope. Reload the list.'
  },
  5066: {
    title: 'Invalid transition',
    hint: 'The current state does not allow this action (e.g. completing a blocked node). Fix the state, then try again.'
  },
  5067: {
    title: 'Conflict',
    hint: 'A roadmap or plan version with this identifier already exists. Reload the list and choose a different name.'
  }
}

export const UNKNOWN_ERROR_HINT =
  'Something unexpected went wrong. Retry, and reload the snapshot if the problem persists.'

/**
 * Extract the structured code from a host.request rejection. The backend
 * message is deliberately dropped here so it can never leak into the UI.
 * `code: null` marks a locally-authored validation failure (see
 * localValidationError) — null/undefined codes are NOT coerced to 0.
 */
export function rpcError(err) {
  const raw = err?.code
  if (raw == null) return { code: null }
  const code = typeof raw === 'number' ? raw : Number(raw)
  return { code: Number.isFinite(code) ? code : null }
}

/** Stable copy for query-level failures (list / snapshot): code + hint only. */
export function errorCopy(err) {
  const code = rpcError(err).code
  const entry = code != null ? ERROR_GUIDANCE[code] : null
  return { code, hint: entry?.hint ?? UNKNOWN_ERROR_HINT }
}

/**
 * Stable copy for inspector mutation failures. `error` is `{ code, hint }`
 * where `hint` is only ever a locally-authored validation text (never a
 * backend string): code == null → local validation, code != null → guidance.
 */
export function mutationErrorCopy(error) {
  if (!error) return null
  if (error.code == null) {
    return { title: 'Action failed', hint: error.hint || UNKNOWN_ERROR_HINT, code: null }
  }
  const entry = ERROR_GUIDANCE[error.code]
  return { title: entry?.title ?? 'Action failed', hint: entry?.hint ?? UNKNOWN_ERROR_HINT, code: error.code }
}

/**
 * Local identifier validation, mirroring the backend contract: non-empty
 * string, ≤ 128 chars, no control characters. Loop instead of a regex so the
 * shared ESLint config (no-control-regex) stays happy.
 */
export function isValidIdentifier(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 128) return false
  for (const ch of value) {
    const code = ch.codePointAt(0)
    if (code < 32 || code === 127) return false
  }
  return true
}

/**
 * Defense in depth: a RPC response must carry the scope it was asked for
 * before its data is consumed (protects against a mis-routed response).
 */
export function assertResponseScope(response, expected) {
  const got = response?.scope ?? {}
  const okProfile = expected.profile == null || got.profile_id === expected.profile
  const okProject = expected.projectId == null || got.project_id === expected.projectId
  const okRoadmap = expected.roadmapId == null || got.roadmap_id === expected.roadmapId
  return okProfile && okProject && okRoadmap
}

/** Human-readable date (en-US, matching the native English UI), raw fallback. */
export function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Display label: prefer the human title, fall back to the id. */
export const nodeLabel = (n) => n?.title || n?.node_id || '?'

/** "1 node" / "3 nodes" — English pluralization for counts. */
export const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`

/** Progress must be an integer in [0, 100] — mirrors the backend contract. */
export function validateProgress(value) {
  const p = Number(value)
  return Number.isInteger(p) && p >= 0 && p <= 100
}

/**
 * Locally-authored validation failure, thrown by the RPC drivers BEFORE any
 * host.request. `code: null` distinguishes it from a backend rejection;
 * `hint` is stable English text authored here (never a backend message).
 */
function localValidationError(hint) {
  return Object.assign(new Error(hint), { code: null, hint })
}

/**
 * Local project-name validation, mirroring the backend contract
 * (projects_db.create_project): non-empty after trimming. The backend owns
 * the rest (slug uniquing, folder normalization).
 */
export function validateProjectName(value) {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Local roadmap-title validation, mirroring the backend contract
 * (roadmaps_writer._non_empty_text): non-empty after trimming, at most 200
 * characters, no control characters. Loop instead of a regex so the shared
 * ESLint config (no-control-regex) stays happy.
 */
export function validateRoadmapTitle(value) {
  if (typeof value !== 'string') return false
  const t = value.trim()
  if (t === '' || t.length > 200) return false
  for (const ch of t) {
    const code = ch.codePointAt(0)
    if (code < 32 || code === 127) return false
  }
  return true
}

// ── projects RPC drivers (host.request — the sole write door) ───────────────

/** projects.list — the active profile's projects (archived included; the UI filters). */
export async function projectList() {
  return host.request(RPC.projects_list, {})
}

/** projects.create — `name` is the only required field (slug/folders/… optional). */
export async function projectCreate(name) {
  return host.request(RPC.projects_create, { name: String(name ?? '').trim() })
}

/** projects.update — the scope menu only renames; other fields stay untouched. */
export async function projectUpdate(id, name) {
  return host.request(RPC.projects_update, { id, name: String(name ?? '').trim() })
}

/** projects.archive — soft archive (never delete); response is the full list payload. */
export async function projectArchive(id) {
  return host.request(RPC.projects_archive, { id })
}

/**
 * Selector items for the project dropdown: non-archived projects, sorted by
 * display name. projects.list includes archived projects, so the plugin
 * filters them out — an archived project leaves the selector immediately.
 */
export function projectSelectorItems(projects) {
  return (projects ?? [])
    .filter((p) => p && !p.archived)
    .sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)))
}

/**
 * Selector items for the roadmap dropdown: roadmaps of the selected project,
 * archived excluded (consistent with projects), sorted by display title.
 * Each item keeps its backend fields (title, lifecycle_state, active_version)
 * so the selector can badge the lifecycle and compute expected_version.
 */
export function roadmapSelectorItems(roadmaps, projectId) {
  return (roadmaps ?? [])
    .filter((r) => r && r.project_id === projectId && r.lifecycle_state !== 'archived')
    .sort((a, b) => String(a.title ?? a.roadmap_id).localeCompare(String(b.title ?? b.roadmap_id)))
}

// ── roadmap CRUD + plans RPC drivers (T5b; host.request — the sole write door) ─

/** Shared scope validation for the T5b admin drivers. */
function assertRoadmapScope(profile, projectId, roadmapId) {
  const scopeProfile = String(profile ?? '').trim()
  const scopeProject = String(projectId ?? '').trim()
  const scopeRoadmap = roadmapId == null ? null : String(roadmapId).trim()
  if (!isValidIdentifier(scopeProfile)) throw localValidationError('A valid profile is required for this action.')
  if (!isValidIdentifier(scopeProject)) throw localValidationError('A valid project id is required for this action.')
  if (scopeRoadmap !== null && !isValidIdentifier(scopeRoadmap)) {
    throw localValidationError('A valid roadmap id is required for this action.')
  }
  return { profile: scopeProfile, projectId: scopeProject, roadmapId: scopeRoadmap }
}

/** `expected_version` must be the non-negative integer the caller observed. */
function assertExpectedVersion(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw localValidationError('expected_version must be a non-negative integer (0 when the roadmap has no active version).')
  }
  return value
}

/** actor defaults to 'user' (the desktop operator), validated like any id. */
function assertActor(actor) {
  const sent = String(actor ?? '').trim() || 'user'
  if (!isValidIdentifier(sent)) {
    throw localValidationError('Actor must be a valid identifier: non-empty, at most 128 characters, no control characters.')
  }
  return sent
}

/**
 * roadmaps.create — the + button flow. `title` is the only editable field;
 * roadmap_id stays backend-generated (r_ + 8 hex). The response carries the
 * created scope ({scope:{profile_id,project_id,roadmap_id}}) plus version 1.
 * Errors: 5062 (project gone), 5067 (roadmap_id exists), 5063 (bad title).
 */
export async function roadmapCreate(profile, projectId, title, actor) {
  const scope = assertRoadmapScope(profile, projectId, null)
  const sent = String(title ?? '').trim()
  if (!validateRoadmapTitle(sent)) {
    throw localValidationError('Roadmap title must be non-empty, at most 200 characters, and free of control characters.')
  }
  const sentActor = assertActor(actor)
  return host.request(RPC.roadmaps_create, {
    profile: scope.profile,
    project_id: scope.projectId,
    title: sent,
    actor: sentActor
  })
}

/**
 * roadmaps.update — the ⋮ → Rename flow. Only title is edited from the UI;
 * lifecycle_state is NOT writable here (backend rejects it with 5063 —
 * transitions go through plans.validate / plans.activate / roadmaps.archive).
 */
export async function roadmapUpdate(profile, projectId, roadmapId, expectedVersion, title, actor) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId)
  const expected = assertExpectedVersion(expectedVersion)
  const sent = String(title ?? '').trim()
  if (!validateRoadmapTitle(sent)) {
    throw localValidationError('Roadmap title must be non-empty, at most 200 characters, and free of control characters.')
  }
  const sentActor = assertActor(actor)
  return host.request(RPC.roadmaps_update, {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId,
    expected_version: expected,
    title: sent,
    actor: sentActor
  })
}

/**
 * roadmaps.archive — the ⋮ → Archive flow. Soft archive (never delete):
 * lifecycle_state becomes the terminal 'archived'; an already archived
 * roadmap is rejected (5066). expected_version is the observed active
 * version (0 when none).
 */
export async function roadmapArchive(profile, projectId, roadmapId, expectedVersion, actor) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId)
  const expected = assertExpectedVersion(expectedVersion)
  const sentActor = assertActor(actor)
  return host.request(RPC.roadmaps_archive, {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId,
    expected_version: expected,
    actor: sentActor
  })
}

/** plans.list — plan versions of a roadmap, newest first (read side). */
export async function planList(profile, projectId, roadmapId) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId)
  return host.request(RPC.plans_list, {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId
  })
}

/** plans.get — one complete plan version (nodes + relations + todos). */
export async function planGet(profile, projectId, roadmapId, version) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId)
  if (!Number.isInteger(version) || version < 1) {
    throw localValidationError('version must be a positive integer.')
  }
  return host.request(RPC.plans_get, {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId,
    version
  })
}

// ── Vision plan governance (T5c; host.request — the sole write door) ────────

/**
 * roadmaps.planning_rules — the versioned Vision system prompt (GLOBAL RPC,
 * no scope params). Returns `{version, rules}` where `rules.prompt` is the
 * system prompt for the Vision session. The backend defaults the version;
 * an unknown explicit version is rejected with 5063.
 */
export async function getPlanningRules() {
  const res = await host.request(RPC.planning_rules, {})
  if (!res || typeof res.rules?.prompt !== 'string' || res.rules.prompt.trim() === '') {
    throw localValidationError('The planning rules could not be loaded. Retry the action.')
  }
  return res
}

/**
 * Local structural validation of a parsed plan payload BEFORE plans.create:
 * ids ≤ 128, titles ≤ 200, arrays present, minimal item shape. The backend
 * owns the deep rules (kinds, cycles, parents); this only guards the write
 * door against a malformed Vision draft. Returns the validated payload.
 */
export function validatePlanPayload(payload) {
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes : []
  const relations = Array.isArray(payload?.relations) ? payload.relations : []
  const todos = Array.isArray(payload?.todos) ? payload.todos : []
  for (const [i, item] of nodes.entries()) {
    if (!item || typeof item !== 'object') throw localValidationError(`nodes[${i}] must be an object.`)
    if (!isValidIdentifier(item.node_id)) {
      throw localValidationError(`nodes[${i}].node_id must be a non-empty identifier of at most 128 characters.`)
    }
    if (!validateRoadmapTitle(item.title)) {
      throw localValidationError(`nodes[${i}].title must be non-empty, at most 200 characters.`)
    }
    if (typeof item.kind !== 'string' || item.kind.trim() === '') {
      throw localValidationError(`nodes[${i}].kind must be a non-empty string.`)
    }
  }
  for (const [i, item] of relations.entries()) {
    if (!item || typeof item !== 'object') throw localValidationError(`relations[${i}] must be an object.`)
    for (const key of ['relation_id', 'from_node_id', 'to_node_id']) {
      if (!isValidIdentifier(item[key])) {
        throw localValidationError(`relations[${i}].${key} must be a non-empty identifier of at most 128 characters.`)
      }
    }
    if (typeof item.kind !== 'string' || item.kind.trim() === '') {
      throw localValidationError(`relations[${i}].kind must be a non-empty string.`)
    }
  }
  for (const [i, item] of todos.entries()) {
    if (!item || typeof item !== 'object') throw localValidationError(`todos[${i}] must be an object.`)
    if (!isValidIdentifier(item.todo_id)) {
      throw localValidationError(`todos[${i}].todo_id must be a non-empty identifier of at most 128 characters.`)
    }
    if (!validateRoadmapTitle(item.title)) {
      throw localValidationError(`todos[${i}].title must be non-empty, at most 200 characters.`)
    }
  }
  return { nodes, relations, todos }
}

/**
 * plans.create — persist a parsed plan as a NEW 'proposed' version (default
 * max+1; validate-before-insert server-side). `payload` carries the
 * normalized {nodes, relations, todos} plus optional {source, reason};
 * `actor` defaults to 'user'. Errors: 5063 (bad payload/scope), 5065
 * (roadmap gone), 5066 (archived), 5067 (version exists).
 */
export async function createPlan(profile, projectId, roadmapId, payload, actor) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId)
  const clean = validatePlanPayload(payload)
  const sentActor = assertActor(actor)
  const params = {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId,
    actor: sentActor,
    nodes: clean.nodes,
    relations: clean.relations,
    todos: clean.todos
  }
  const source = typeof payload?.source === 'string' && payload.source.trim() !== '' ? payload.source.trim() : 'vision'
  const reason = typeof payload?.reason === 'string' && payload.reason.trim() !== '' ? payload.reason.trim() : undefined
  if (source) params.source = source
  if (reason) params.reason = reason
  const title = typeof payload?.title === 'string' && payload.title.trim() !== '' ? payload.title.trim() : undefined
  if (title) params.title = title
  return host.request(RPC.plans_create, params)
}

/**
 * plans.activate — point the roadmap's active_version at a 'validated'
 * plan version (the previously active version is superseded). Requires the
 * caller's observed active version as expected_version (0 when none).
 */
export async function activatePlan(profile, projectId, roadmapId, version, expectedVersion, actor) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId)
  if (!Number.isInteger(version) || version < 1) {
    throw localValidationError('version must be a positive integer.')
  }
  const expected = assertExpectedVersion(expectedVersion)
  const sentActor = assertActor(actor)
  return host.request(RPC.plans_activate, {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId,
    version,
    expected_version: expected,
    actor: sentActor
  })
}

/** Read durable sessions attached to one fully-qualified roadmap. */
export async function listRoadmapSessions(profile, projectId, roadmapId) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId)
  const res = await host.request(RPC.roadmap_sessions, {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId
  })
  if (!assertResponseScope(res, scope) || !Array.isArray(res?.sessions)) {
    throw localValidationError('The Vision session response did not match the selected roadmap.')
  }
  return res
}

/** Return the unique active Vision link, or null for an absent/invalid list. */
export function activeVisionSession(response) {
  const active = Array.isArray(response?.sessions)
    ? response.sessions.filter(
        (row) =>
          row?.kind === 'vision' &&
          row?.state === 'active' &&
          isValidIdentifier(row?.stored_session_id)
      )
    : []
  return active.length === 1 ? active[0] : null
}

/** Atomically replace the roadmap's active Vision link with a durable id. */
export async function attachVisionSession(
  profile,
  projectId,
  roadmapId,
  storedSessionId,
  expectedVersion,
  actor,
  planVersion
) {
  const scope = assertRoadmapScope(profile, projectId, roadmapId)
  if (!isValidIdentifier(storedSessionId)) {
    throw localValidationError('A valid stored session id is required for Vision.')
  }
  const expected = assertExpectedVersion(expectedVersion)
  const sentActor = assertActor(actor)
  if (planVersion != null && (!Number.isInteger(planVersion) || planVersion < 1)) {
    throw localValidationError('plan_version must be a positive integer when provided.')
  }
  const params = {
    profile: scope.profile,
    project_id: scope.projectId,
    roadmap_id: scope.roadmapId,
    stored_session_id: storedSessionId,
    kind: 'vision',
    expected_version: expected,
    actor: sentActor
  }
  if (planVersion != null) params.plan_version = planVersion
  const res = await host.request(RPC.attach_session, params)
  if (
    !assertResponseScope(res, scope) ||
    res?.session?.stored_session_id !== storedSessionId ||
    res?.session?.kind !== 'vision' ||
    res?.session?.state !== 'active'
  ) {
    throw localValidationError('The Vision session response did not match the requested association.')
  }
  return res
}

/**
 * session.create — a fresh native-chat session seeded with the planning
 * rules as its first system message (source 'vision'). The gateway coerces
 * `messages` through _coerce_seed_history (roles user|assistant|system,
 * non-empty string content). Returns {session_id, stored_session_id,
 * message_count, messages, info}; the caller opens it in the native chat
 * with host.openSession(stored_session_id, {profile}).
 */
export async function visionSessionCreate(profile, rulesPrompt) {
  const scopeProfile = String(profile ?? '').trim()
  if (!isValidIdentifier(scopeProfile)) {
    throw localValidationError('A valid profile is required to start a Vision session.')
  }
  const prompt = String(rulesPrompt ?? '').trim()
  if (prompt === '') {
    throw localValidationError('The planning rules prompt is empty — cannot start a Vision session.')
  }
  return host.request('session.create', {
    profile: scopeProfile,
    source: 'vision',
    messages: [{ role: 'system', content: prompt }]
  })
}

/**
 * Start the Vision session — the Plan-first primary action (spec §6.5).
 * Seeds a fresh native-chat session with the versioned planning rules
 * (session.create source 'vision') and returns the durable identity plus the
 * ephemeral runtime hint for SessionSurface:
 *
 *   { profile, storedSessionId, runtimeSessionId }
 *
 * It does NOT call host.openSession: the surface stays embedded in the
 * Workbench. Only the durable lineage is persisted (via attachVisionSession);
 * runtimeSessionId is never stored by Roadmaps.
 */
export async function startVisionSession(profile, rulesPrompt) {
  const created = await visionSessionCreate(profile, rulesPrompt)

  return {
    profile: String(profile ?? '').trim(),
    storedSessionId: created?.stored_session_id,
    runtimeSessionId: created?.session_id
  }
}

// ── Vision draft parsing (pure, over the streamed assistant text) ───────────

/**
 * Extract the LAST ```json … ``` fence from the streamed assistant text and
 * parse it. Returns the parsed value (or null when no complete JSON fence is
 * present yet — the agent is still drafting, or the fence is malformed).
 */
export function extractPlanJsonBlock(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)]
  if (fences.length === 0) return null
  const last = fences[fences.length - 1]
  if (!last || last[1].trim() === '') return null
  try {
    return JSON.parse(last[1].trim())
  } catch {
    return null
  }
}

/**
 * Compact preview of a parsed plan payload: proposed title + counts
 * (nodes/relations/todos) + distinct node-kind badges (first-appearance
 * order). Returns null when the payload has no nodes (a plan needs at
 * least one node) or is not an object.
 */
export function planPreviewFromJson(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const nodes = Array.isArray(obj.nodes) ? obj.nodes : []
  if (nodes.length === 0) return null
  const relations = Array.isArray(obj.relations) ? obj.relations : []
  const todos = Array.isArray(obj.todos) ? obj.todos : []
  const kinds = []
  const seenKinds = new Set()
  for (const n of nodes) {
    const kind = typeof n?.kind === 'string' ? n.kind : ''
    if (kind !== '' && !seenKinds.has(kind)) {
      seenKinds.add(kind)
      kinds.push(kind)
    }
  }
  return {
    title: typeof obj.title === 'string' && obj.title.trim() !== '' ? obj.title.trim() : '',
    counts: { nodes: nodes.length, relations: relations.length, todos: todos.length },
    kinds,
    nodes,
    relations,
    todos
  }
}

/** Build the structured preview only from persisted assistant messages. */
export function planPreviewFromMessages(messages) {
  if (!Array.isArray(messages)) return null
  const assistantText = messages
    .filter((message) => message?.role === 'assistant' && typeof message.content === 'string')
    .map((message) => message.content)
    .join('\n')
  const parsed = extractPlanJsonBlock(assistantText)
  return parsed ? planPreviewFromJson(parsed) : null
}

// ── data layer (pure functions over the snapshot) ───────────────────────────

export function activeVersion(snapshot) {
  const roadmap = snapshot?.roadmap
  const v = roadmap?.active_version
  return roadmap?.versions?.find((x) => x.version === v) ?? null
}

/** Thread: actionable nodes, blocked first, then in_progress, then ready. */
export function threadNodes(version) {
  const nodes = version?.nodes ?? []
  return nodes
    .filter((n) => n.state === 'ready' || n.state === 'in_progress' || n.state === 'blocked')
    .sort(
      (a, b) =>
        (NODE_ORDER[a.state] ?? 9) - (NODE_ORDER[b.state] ?? 9) || String(a.node_id).localeCompare(String(b.node_id))
    )
}

const CANONICAL_RELATIONS = new Set(['depends_on', 'blocks'])

/** Map: canonical relations of the active version (active by default). */
export function mapRelations(version, { includeInactive = false } = {}) {
  const nodes = version?.nodes ?? []
  const byId = new Map(nodes.map((n) => [n.node_id, n]))
  return (version?.relations ?? [])
    .filter((r) => includeInactive || r.state === 'active')
    .filter((r) => CANONICAL_RELATIONS.has(r.kind))
    .map((r) => ({ ...r, from: byId.get(r.from_node_id) ?? null, to: byId.get(r.to_node_id) ?? null }))
    .filter((r) => r.from && r.to)
    .sort((a, b) => String(a.relation_id).localeCompare(String(b.relation_id)))
}

/** Plan: every roadmap version, newest first. */
export function planVersions(snapshot) {
  const versions = snapshot?.roadmap?.versions ?? []
  return [...versions].sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))
}

/** Milestones: milestone/objective nodes of the active version. */
export function milestoneNodes(version) {
  return (version?.nodes ?? [])
    .filter((n) => n.kind === 'milestone' || n.kind === 'objective')
    .sort((a, b) => String(a.node_id).localeCompare(String(b.node_id)))
}

/** A node's depends_on relations are satisfied when every target is done. */
export function depsSatisfied(node, version) {
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]))
  const deps = (version?.relations ?? [])
    .filter((r) => r.state === 'active' && r.kind === 'depends_on' && r.from_node_id === node.node_id)
    .map((r) => byId.get(r.to_node_id))
  // A missing target node counts as satisfied (nothing verifiable blocks it).
  return deps.every((d) => !d || d.state === 'completed' || d.state === 'cancelled')
}

/**
 * Direct depends_on relations of a node (active version), each tagged with
 * whether its target is done. Missing targets count as satisfied.
 */
export function nodeDepsInfo(node, version) {
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]))
  const deps = (version?.relations ?? [])
    .filter((r) => r.state === 'active' && r.kind === 'depends_on' && r.from_node_id === node.node_id)
    .map((r) => {
      const target = byId.get(r.to_node_id) ?? null
      return {
        target,
        targetId: r.to_node_id,
        satisfied: !target || target.state === 'completed' || target.state === 'cancelled'
      }
    })
  const total = deps.length
  const satisfied = deps.filter((d) => d.satisfied).length
  return { deps, total, satisfied }
}

/** Nodes that wait on this node (incoming depends_on), active version. */
export function nodeDependants(node, version) {
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]))
  return (version?.relations ?? [])
    .filter((r) => r.state === 'active' && r.kind === 'depends_on' && r.to_node_id === node.node_id)
    .map((r) => byId.get(r.from_node_id))
    .filter(Boolean)
}

/** Incoming blocks relations: who is holding this node down. */
export function nodeBlockers(node, version) {
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]))
  return (version?.relations ?? [])
    .filter((r) => r.state === 'active' && r.kind === 'blocks' && r.to_node_id === node.node_id)
    .map((r) => ({ from: byId.get(r.from_node_id) ?? null, reason: r.reason, relationId: r.relation_id }))
    .filter((b) => b.from)
}

/** Outgoing blocks relations: nodes this node is holding down. */
export function nodeBlocks(node, version) {
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]))
  return (version?.relations ?? [])
    .filter((r) => r.state === 'active' && r.kind === 'blocks' && r.from_node_id === node.node_id)
    .map((r) => byId.get(r.to_node_id))
    .filter(Boolean)
}

/**
 * Orchestration buckets, computed ONLY from the active version's real data:
 * - Now: ready nodes whose depends_on relations are satisfied (claimable).
 * - In flight: in_progress nodes.
 * - Waiting: ready nodes whose dependencies are not satisfied yet.
 * - Blocked: blocked nodes carrying a block_reason.
 */
export function copilotSections(version) {
  const nodes = version?.nodes ?? []
  if (nodes.length === 0) return null
  const now = nodes.filter((n) => n.state === 'ready' && depsSatisfied(n, version))
  const inflight = nodes.filter((n) => n.state === 'in_progress')
  const waiting = nodes.filter((n) => n.state === 'ready' && !depsSatisfied(n, version))
  const blocked = nodes.filter((n) => n.state === 'blocked' && n.block_reason)
  return { now, inflight, waiting, blocked }
}

/**
 * The single most critical actionable node, by tier:
 *   0 unblockable blocked node (no pending dependency left) → Unblock
 *   1 ready, deps satisfied, no owner → Claim
 *   2 ready, deps satisfied, owned → Advance
 *   3 blocked with pending dependencies → Wait
 *   4 ready with pending dependencies → Wait
 *   5 in_progress without an owner → Assign
 *   6 in_progress with an owner → Advance (already being worked)
 * Ties break on fewer pending dependencies, then node_id.
 */
export function nextAction(version) {
  const nodes = version?.nodes ?? []
  if (nodes.length === 0) return null
  let best = null
  for (const n of nodes) {
    if (!['ready', 'in_progress', 'blocked'].includes(n.state)) continue
    const { total, satisfied } = nodeDepsInfo(n, version)
    const pending = total - satisfied
    let tier
    let kind
    if (n.state === 'blocked') {
      if (pending === 0) {
        tier = 0
        kind = 'unblock'
      } else {
        tier = 3
        kind = 'wait-deps'
      }
    } else if (n.state === 'ready') {
      if (pending === 0 && !n.owner_agent) {
        tier = 1
        kind = 'claim'
      } else if (pending === 0 && n.owner_agent) {
        tier = 2
        kind = 'advance'
      } else {
        tier = 4
        kind = 'wait-deps'
      }
    } else if (!n.owner_agent) {
      tier = 5
      kind = 'assign'
    } else {
      tier = 6
      kind = 'advance'
    }
    const cand = { node: n, tier, kind, pending, satisfied, total }
    if (
      !best ||
      tier < best.tier ||
      (tier === best.tier && pending < best.pending) ||
      (tier === best.tier && pending === best.pending && String(n.node_id) < String(best.node.node_id))
    ) {
      best = cand
    }
  }
  return best
}

/**
 * Implicit critical path: the longest depends_on chain among actionable
 * nodes (ready / in_progress), guarded against cycles. Returns node_ids from
 * the deepest dependant down to the leaf dependency.
 */
export function criticalChain(version) {
  const nodes = version?.nodes ?? []
  const byId = new Map(nodes.map((n) => [n.node_id, n]))
  const depsOf = new Map()
  for (const r of version?.relations ?? []) {
    if (r.state !== 'active' || r.kind !== 'depends_on') continue
    const arr = depsOf.get(r.from_node_id) ?? []
    arr.push(r.to_node_id)
    depsOf.set(r.from_node_id, arr)
  }
  const memo = new Map()
  const depth = (id, seen) => {
    if (memo.has(id)) return memo.get(id)
    if (seen.has(id)) return 0
    seen.add(id)
    let d = 0
    for (const depId of depsOf.get(id) ?? []) d = Math.max(d, 1 + depth(depId, seen))
    seen.delete(id)
    memo.set(id, d)
    return d
  }
  const actionable = nodes.filter((n) => n.state === 'ready' || n.state === 'in_progress')
  if (actionable.length === 0) return []
  let best = null
  let bestDepth = -1
  for (const n of actionable) {
    const d = depth(n.node_id, new Set())
    if (d > bestDepth) {
      bestDepth = d
      best = n
    }
  }
  if (!best || bestDepth <= 0) return best ? [best.node_id] : []
  const chain = [best.node_id]
  let cur = best
  const seen = new Set([best.node_id])
  while (chain.length <= nodes.length) {
    const deps = (depsOf.get(cur.node_id) ?? [])
      .filter((d) => !seen.has(d))
      .map((dId) => ({ dId, depth: depth(dId, new Set()) }))
      .sort((a, b) => b.depth - a.depth)
    if (deps.length === 0) break
    cur = byId.get(deps[0].dId)
    if (!cur) break
    seen.add(cur.node_id)
    chain.push(cur.node_id)
  }
  return chain
}

/** Group milestones by their parent node (when one exists); flat otherwise. */
export function groupMilestones(version) {
  const nodes = milestoneNodes(version)
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]))
  const groups = new Map()
  const flat = []
  for (const n of nodes) {
    const parent = n.parent_node_id ? byId.get(n.parent_node_id) ?? null : null
    if (parent) {
      const arr = groups.get(parent.node_id) ?? []
      arr.push(n)
      groups.set(parent.node_id, arr)
    } else {
      flat.push(n)
    }
  }
  const entries = [...groups.entries()].map(([parentId, groupNodes]) => ({
    label: nodeLabel(byId.get(parentId)),
    nodes: groupNodes
  }))
  if (flat.length > 0) entries.push({ label: null, nodes: flat })
  return entries
}
