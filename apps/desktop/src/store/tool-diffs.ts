import { atom, computed, type ReadableAtom } from 'nanostores'

import { sessionRuntimeStateKey } from './session-states'

const $toolDiffs = atom<Record<string, string>>({})

export interface ToolDiffScope {
  profile: string
  runtimeId: string
}

export interface ToolDiffReadScope extends ToolDiffScope {
  /** Primary-chat compatibility for diffs recorded by an unprofiled legacy event. */
  legacyFallback?: boolean
}

function toolDiffKey(toolCallId: string, scope?: ToolDiffScope): string {
  if (!toolCallId) {
    return ''
  }

  return scope ? `${sessionRuntimeStateKey(scope.profile, scope.runtimeId)}\u0000${toolCallId}` : toolCallId
}

function readToolDiff(diffs: Record<string, string>, toolCallId: string, scope?: ToolDiffReadScope): string {
  const key = toolDiffKey(toolCallId, scope)

  if (!key) {
    return ''
  }

  const scoped = diffs[key] || ''

  return scoped || (scope?.legacyFallback ? diffs[toolCallId] || '' : '')
}

// Per-tool derived atoms, cached by complete ownership scope. A `ToolEntry`
// subscribes only to its own (profile, runtime, toolCallId) diff, so recording
// another profile's colliding tool id cannot repaint this row.
const inlineDiffCache = new Map<string, ReadableAtom<string>>()

export function recordToolDiff(toolCallId: string, diff: string, scope?: ToolDiffScope) {
  const key = toolDiffKey(toolCallId, scope)

  if (!key || !diff) {
    return
  }

  const current = $toolDiffs.get()

  if (current[key] === diff) {
    return
  }

  $toolDiffs.set({ ...current, [key]: diff })
}

export function getToolDiff(toolCallId: string, scope?: ToolDiffReadScope): string {
  return readToolDiff($toolDiffs.get(), toolCallId, scope)
}

/** Drop every inline diff owned by one qualified runtime. Legacy bare tool ids
 * are intentionally untouched when a profile is explicit. */
export function clearSessionToolDiffs(runtimeId: string, profile: string): void {
  const prefix = `${sessionRuntimeStateKey(profile, runtimeId)}\u0000`
  const current = $toolDiffs.get()
  const next = Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix)))

  if (Object.keys(next).length !== Object.keys(current).length) {
    $toolDiffs.set(next)
  }

  for (const key of inlineDiffCache.keys()) {
    if (key.startsWith(prefix)) {
      inlineDiffCache.delete(key)
    }
  }
}

export function $toolInlineDiff(toolCallId: string, scope?: ToolDiffReadScope): ReadableAtom<string> {
  const key = `${toolDiffKey(toolCallId, scope)}\u0000fallback:${scope?.legacyFallback === true}`
  let cached = inlineDiffCache.get(key)

  if (!cached) {
    cached = computed($toolDiffs, diffs => readToolDiff(diffs, toolCallId, scope))
    inlineDiffCache.set(key, cached)
  }

  return cached
}
