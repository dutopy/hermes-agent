/**
 * Pure Plan-first Workbench state, routing, and gate policy.
 *
 * This module deliberately has no React, RPC, host, or data-layer dependency.
 * Its inputs must already come from the explicitly selected scope and the
 * authoritative backend response; it never falls back to another selection or
 * to roadmap.versions.
 */

export const NO_PROJECT = 'NO_PROJECT'
export const NO_ROADMAP = 'NO_ROADMAP'
export const DRAFT_NO_PLAN = 'DRAFT_NO_PLAN'
export const PROPOSED = 'PROPOSED'
export const VALIDATED_NON_ACTIVE = 'VALIDATED_NON_ACTIVE'
export const ACTIVE = 'ACTIVE'

export const WORKBENCH_STATES = Object.freeze({
  NO_PROJECT,
  NO_ROADMAP,
  DRAFT_NO_PLAN,
  PROPOSED,
  VALIDATED_NON_ACTIVE,
  ACTIVE
})

const STATE_VALUES = new Set(Object.values(WORKBENCH_STATES))

/** Match the backend's public identifier constraints without importing data.js. */
export function isValidWorkbenchIdentifier(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 128) return false
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code < 32 || code === 127) return false
  }
  return true
}

/**
 * Derive the product state from explicit scope and plan-list data only.
 * `plans` is the array returned in the `plans.list` response's `plans` field.
 */
export function deriveWorkbenchState({ projectId, roadmap, plans } = {}) {
  if (!isValidWorkbenchIdentifier(projectId)) return NO_PROJECT
  if (!roadmap || !isValidWorkbenchIdentifier(roadmap.roadmap_id)) return NO_ROADMAP

  // An active version remains authoritative while a newer revision is being
  // proposed or validated. The backend represents "not active" as null.
  if (Number.isInteger(roadmap.active_version) && roadmap.active_version > 0) {
    return ACTIVE
  }

  const candidates = Array.isArray(plans)
    ? plans.filter(
        (candidate) =>
          candidate &&
          Number.isInteger(candidate.version) &&
          candidate.version > 0 &&
          (candidate.state === 'proposed' || candidate.state === 'validated')
      )
    : []

  if (candidates.length === 0) return DRAFT_NO_PLAN

  const latest = candidates.reduce((current, candidate) =>
    candidate.version > current.version ? candidate : current
  )
  return latest.state === 'proposed' ? PROPOSED : VALIDATED_NON_ACTIVE
}

function requireIdentifier(name, value) {
  if (!isValidWorkbenchIdentifier(value)) {
    throw new TypeError(`${name} must be a valid explicit identifier`)
  }
  return encodeURIComponent(value)
}

/** Return the sole canonical route for a derived Workbench state. */
export function canonicalWorkbenchRoute(state, { projectId, roadmapId } = {}) {
  switch (state) {
    case NO_PROJECT:
      return '/roadmaps'
    case NO_ROADMAP:
      return `/roadmaps?project=${requireIdentifier('projectId', projectId)}`
    case DRAFT_NO_PLAN:
      return `/roadmaps/${requireIdentifier('roadmapId', roadmapId)}/setup/vision`
    case PROPOSED:
      return `/roadmaps/${requireIdentifier('roadmapId', roadmapId)}/setup/review`
    case VALIDATED_NON_ACTIVE:
      return `/roadmaps/${requireIdentifier('roadmapId', roadmapId)}/setup/launch`
    case ACTIVE:
      return `/roadmaps/${requireIdentifier('roadmapId', roadmapId)}/overview`
    default:
      throw new TypeError('state must be a recognized Workbench state')
  }
}

const EXECUTION_LOCK_COPY = 'Validate and start a plan to unlock execution'

const GATES = Object.freeze({
  [NO_PROJECT]: Object.freeze({
    indicator: 'Choose a project to begin',
    primaryAction: 'Create project',
    canExecute: false,
    stage: 'Define',
    executeHint: EXECUTION_LOCK_COPY
  }),
  [NO_ROADMAP]: Object.freeze({
    indicator: 'Create your first roadmap',
    primaryAction: 'New roadmap',
    canExecute: false,
    stage: 'Define',
    executeHint: EXECUTION_LOCK_COPY
  }),
  [PROPOSED]: Object.freeze({
    indicator: 'Awaiting validation',
    primaryAction: 'Validate plan',
    canExecute: false,
    stage: 'Validate',
    executeHint: EXECUTION_LOCK_COPY
  }),
  [VALIDATED_NON_ACTIVE]: Object.freeze({
    indicator: 'Validated · Not started',
    primaryAction: 'Start roadmap',
    canExecute: false,
    stage: 'Validate',
    executeHint: EXECUTION_LOCK_COPY
  })
})

/**
 * Return authoritative UI gate copy and capability as a fresh object.
 * Draft readiness must be supplied by the caller; it is never inferred here.
 */
export function workbenchGate(state, { planDraftReady = false, activeVersion } = {}) {
  if (!STATE_VALUES.has(state)) throw new TypeError('state must be a recognized Workbench state')

  if (state === DRAFT_NO_PLAN) {
    return {
      indicator: 'Planning required',
      primaryAction: planDraftReady === true ? 'Propose plan' : 'Start planning',
      canExecute: false,
      stage: planDraftReady === true ? 'Shape' : 'Define',
      executeHint: EXECUTION_LOCK_COPY
    }
  }

  if (state === ACTIVE) {
    const versionLabel = Number.isInteger(activeVersion) && activeVersion > 0 ? ` · v${activeVersion}` : ''
    return {
      indicator: `Active${versionLabel}`,
      primaryAction: 'Continue work',
      canExecute: true,
      stage: 'Run',
      executeHint: null
    }
  }

  return { ...GATES[state] }
}

/** Validate the two primary mode destinations against the derived state. */
export function isWorkbenchDestinationValid(state, destination) {
  if (destination === 'Plan') {
    return state === DRAFT_NO_PLAN || state === PROPOSED || state === VALIDATED_NON_ACTIVE || state === ACTIVE
  }
  if (destination === 'Execute') return state === ACTIVE
  return false
}
