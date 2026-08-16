import { atom, computed } from 'nanostores'

import { translateNow } from '@/i18n'
import { stableArray } from '@/lib/stable-array'
import type { TodoItem, TodoStatus } from '@/lib/todos'

import { $gateway, requestGatewayForProfile } from './gateway'
import { $goalsBySession, type GoalStatus } from './goals'
import { dispatchNativeNotification } from './native-notifications'
import { notifyError, profiledPresentationError } from './notifications'
import { $sessions, lineageAliases, sessionDurableStateKey } from './session'
import { $sessionStates, sessionRuntimeStateIdentity, sessionRuntimeStateKey } from './session-states'
import { $subagentsBySession, type SubagentProgress } from './subagents'
import { $todosBySession } from './todos'

/** Composer status stack feed — merged todos, subagents, background per session. */
export type StatusItemState = 'done' | 'failed' | 'running'
export type StatusItemType = 'background' | 'goal' | 'subagent' | 'todo'

export interface ComposerStatusItem {
  /** background: non-zero exit shown inline when failed. */
  exitCode?: number
  /** subagent: active tool label shown on the right. */
  currentTool?: string
  /** goal: active | paused | waiting | done. */
  goalStatus?: GoalStatus
  id: string
  /** background process: captured stdout/stderr tail for the inline viewer. */
  output?: string
  /** subagent: its own stored session id — row click opens that session window
   *  (livestreamed by the gateway's child-session mirror). */
  sessionId?: string
  state: StatusItemState
  title: string
  /** todo: the full four-state status driving the row's checkmark glyph. */
  todoStatus?: TodoStatus
  type: StatusItemType
}

// Writable source for background work, synced from the gateway's process
// registry (`terminal(background=true)` spawns) via `process.list`.
export const $backgroundStatusBySession = atom<Record<string, ComposerStatusItem[]>>({})

// Stored session ids that have at least one RUNNING background process. The
// sidebar row reads this for a hollow dot — distinct from the filled dot of an
// active LLM turn — so the user can tell at a glance "this session has
// something chugging along in the background" even when the turn is idle.
//
// $backgroundStatusBySession is keyed by RUNTIME session id (gateway events
// and process.list both speak that); the sidebar row knows only the STORED id.
// $sessionStates bridges the two: runtime id → state.storedSessionId, then
// lineageAliases covers whichever tip of that conversation a surface holds.
// Perf: recomputes on every $sessionStates change (message deltas, tens/sec),
// but the background-running set rarely moves. `stableArray` keeps the prior
// reference when unchanged so rows reading this don't re-render per token.
let backgroundRunningIds: readonly string[] = []
export const $backgroundRunningSessionIds = computed(
  [$backgroundStatusBySession, $sessionStates, $sessions],
  (bg, states, sessions) => {
    const ids = new Set<string>()

    for (const [runtimeKey, items] of Object.entries(bg)) {
      if (!items.some(i => i.state === 'running')) {
        continue
      }

      // Same fresh-chat fallback as the working/attention projections: before a
      // conversation is persisted its runtime id is the id surfaces key on.
      const { profile, runtimeSessionId } = sessionRuntimeStateIdentity(runtimeKey)

      for (const alias of lineageAliases(states[runtimeKey]?.storedSessionId ?? runtimeSessionId, sessions, profile)) {
        ids.add(sessionDurableStateKey(profile, alias))
      }
    }

    return (backgroundRunningIds = stableArray(backgroundRunningIds, [...ids]))
  }
)

// Rows the user X-ed away. The registry keeps finished processes around for a
// while, so without this every refresh would resurrect a dismissed row.
const dismissedBySession = new Map<string, Set<string>>()

// Finished tasks self-clear so the stack only ever holds running work. Success
// goes quick; failure lingers longer so its exit code stays readable (the output
// also lives in the transcript). A manual X still drops either at once.
const SUCCESS_LINGER_MS = 4_000
const FAILURE_LINGER_MS = 12_000
const autoClearTimers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>()

function scheduleAutoDismiss(sid: string, id: string, delayMs: number) {
  let timers = autoClearTimers.get(sid)

  if (timers?.has(id)) {
    return
  }

  if (!timers) {
    timers = new Map()
    autoClearTimers.set(sid, timers)
  }

  timers.set(
    id,
    setTimeout(() => {
      autoClearTimers.get(sid)?.delete(id)
      dismissBackgroundProcess(sid, id)
    }, delayMs)
  )
}

function cancelAutoDismiss(sid: string, id: string) {
  const timers = autoClearTimers.get(sid)

  if (!timers) {
    return
  }

  const timer = timers.get(id)

  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(id)
  }
}

const subToItem = (s: SubagentProgress): ComposerStatusItem => ({
  currentTool: s.currentTool,
  id: s.id,
  sessionId: s.sessionId,
  state: 'running',
  title: s.goal,
  type: 'subagent'
})

const todoToItem = (t: TodoItem): ComposerStatusItem => ({
  id: `todo:${t.id}`,
  state: t.status === 'in_progress' ? 'running' : 'done',
  title: t.content,
  todoStatus: t.status,
  type: 'todo'
})

const goalToItem = (goal: { detail?: string; status: GoalStatus; title: string }): ComposerStatusItem => ({
  currentTool: goal.detail,
  goalStatus: goal.status,
  id: 'goal:standing',
  state: goal.status === 'active' || goal.status === 'waiting' ? 'running' : 'done',
  title: goal.title,
  type: 'goal'
})

// The single thing the stack reads: a typed, merged item list per session.
//
// Identity contract: this computed's inputs churn constantly during a turn (a
// subagent tick, a 5s background poll, a todo update — in ANY session), but
// the merged output for most sessions is unchanged. Rebuilding fresh arrays
// and item objects every time handed every mounted composer stack a new
// reference per recompute — cross-session churn × open tiles. Stabilize both
// levels: an unchanged session keeps its previous array (and item objects),
// and a fully-unchanged map keeps its previous reference so `computed` skips
// the notify entirely ("preserve reference identity on no-ops").
const sameStatusItem = (a: ComposerStatusItem, b: ComposerStatusItem) =>
  a.id === b.id &&
  a.type === b.type &&
  a.state === b.state &&
  a.title === b.title &&
  a.output === b.output &&
  a.exitCode === b.exitCode &&
  a.currentTool === b.currentTool &&
  a.goalStatus === b.goalStatus &&
  a.todoStatus === b.todoStatus &&
  a.sessionId === b.sessionId

const stabilizeItems = (prev: ComposerStatusItem[] | undefined, next: ComposerStatusItem[]): ComposerStatusItem[] => {
  if (!prev) {
    return next
  }

  const merged = next.map((item, i) => (prev[i] && sameStatusItem(prev[i], item) ? prev[i] : item))

  return merged.length === prev.length && merged.every((item, i) => item === prev[i]) ? prev : merged
}

let prevStatusItems: Record<string, ComposerStatusItem[]> = {}

export const $statusItemsBySession = computed(
  [$goalsBySession, $subagentsBySession, $backgroundStatusBySession, $todosBySession],
  (goals, subs, background, todos) => {
    const out: Record<string, ComposerStatusItem[]> = {}

    const push = (sid: string, items: ComposerStatusItem[]) => {
      if (items.length > 0) {
        out[sid] = out[sid] ? [...out[sid], ...items] : items
      }
    }

    for (const [sid, list] of Object.entries(todos)) {
      push(sid, list.map(todoToItem))
    }

    for (const [sid, goal] of Object.entries(goals)) {
      push(sid, [goalToItem(goal)])
    }

    for (const [sid, list] of Object.entries(subs)) {
      push(sid, list.filter(s => s.status === 'running' || s.status === 'queued').map(subToItem))
    }

    for (const [sid, list] of Object.entries(background)) {
      push(sid, list)
    }

    let unchanged = Object.keys(prevStatusItems).length === Object.keys(out).length

    for (const sid of Object.keys(out)) {
      out[sid] = stabilizeItems(prevStatusItems[sid], out[sid]!)
      unchanged &&= out[sid] === prevStatusItems[sid]
    }

    return (prevStatusItems = unchanged ? prevStatusItems : out)
  }
)

// Fixed render order for the groups in the stack (top → bottom, above queue).
const TYPE_ORDER: readonly StatusItemType[] = ['goal', 'todo', 'subagent', 'background']

export interface StatusGroup {
  items: ComposerStatusItem[]
  type: StatusItemType
}

export function groupStatusItems(items: readonly ComposerStatusItem[]): StatusGroup[] {
  const byType = new Map<StatusItemType, ComposerStatusItem[]>()

  for (const item of items) {
    const list = byType.get(item.type)

    if (list) {
      list.push(item)
    } else {
      byType.set(item.type, [item])
    }
  }

  return TYPE_ORDER.filter(type => byType.has(type)).map(type => ({ items: byType.get(type)!, type }))
}

const writeBackground = (sid: string, items: ComposerStatusItem[]) => {
  const current = $backgroundStatusBySession.get()
  const next = { ...current }

  if (items.length > 0) {
    next[sid] = items
  } else {
    delete next[sid]
  }

  $backgroundStatusBySession.set(next)
}

// `tui_gateway` process.list entry (tools/process_registry.list_sessions + output_tail).
interface GatewayProcessEntry {
  command?: string
  exit_code?: number
  output_tail?: string
  session_id?: string
  status?: string
}

const toBackgroundItem = (proc: GatewayProcessEntry): ComposerStatusItem => {
  const exited = proc.status === 'exited'
  const exitCode = typeof proc.exit_code === 'number' ? proc.exit_code : undefined

  return {
    exitCode,
    id: proc.session_id ?? '',
    output: proc.output_tail || undefined,
    state: exited ? (exitCode ? 'failed' : 'done') : 'running',
    title: (proc.command ?? '').split('\n')[0]!.trim() || 'background process',
    type: 'background'
  }
}

const sameItem = (a: ComposerStatusItem, b: ComposerStatusItem) =>
  a.state === b.state && a.title === b.title && a.output === b.output && a.exitCode === b.exitCode

/**
 * Layout-stable sync of the registry snapshot into the store: existing rows
 * keep their position (status flips happen in place, never reorder), new
 * processes append, dismissed ids stay gone, and unchanged rows keep their
 * object identity so memoised rows skip re-rendering.
 */
export function reconcileBackgroundProcesses(sid: string, procs: GatewayProcessEntry[], profile?: null | string) {
  const runtimeSid = sid
  sid = sessionRuntimeStateKey(profile, sid)
  const dismissed = dismissedBySession.get(sid)

  const fresh = new Map(
    procs
      .filter(proc => proc.session_id && !dismissed?.has(proc.session_id))
      .map(proc => [proc.session_id!, toBackgroundItem(proc)])
  )

  const prev = $backgroundStatusBySession.get()[sid] ?? []

  // running → exited since the last snapshot = a background process just finished.
  const prevState = new Map(prev.map(item => [item.id, item.state]))

  for (const [id, item] of fresh) {
    if (item.state !== 'running' && prevState.get(id) === 'running') {
      dispatchNativeNotification({
        body: item.title,
        kind: 'backgroundDone',
        profile,
        sessionId: runtimeSid,
        title: translateNow(
          item.state === 'failed'
            ? 'notifications.native.backgroundFailedTitle'
            : 'notifications.native.backgroundDoneTitle'
        )
      })
    }
  }

  const kept = prev.flatMap(old => {
    const next = fresh.get(old.id)
    fresh.delete(old.id)

    return next ? [sameItem(old, next) ? old : next] : []
  })

  const next = [...kept, ...fresh.values()]

  // Dismissals only need remembering while the registry still reports the id.
  if (dismissed) {
    const reported = new Set(procs.map(proc => proc.session_id))

    for (const id of dismissed) {
      if (!reported.has(id)) {
        dismissed.delete(id)
      }
    }
  }

  // Arm the self-clear on every finished task (failures linger longer); cancel
  // it for anything running again or gone from the snapshot.
  const finishedDelay = new Map(
    next
      .filter(item => item.state !== 'running')
      .map(item => [item.id, item.state === 'failed' ? FAILURE_LINGER_MS : SUCCESS_LINGER_MS])
  )

  for (const [id, delay] of finishedDelay) {
    scheduleAutoDismiss(sid, id, delay)
  }

  for (const id of [...(autoClearTimers.get(sid)?.keys() ?? [])]) {
    if (!finishedDelay.has(id)) {
      cancelAutoDismiss(sid, id)
    }
  }

  if (next.length === prev.length && next.every((item, i) => item === prev[i])) {
    return
  }

  writeBackground(sid, next)
}

/** Pull the session's live process snapshot from the gateway. */
export async function refreshBackgroundProcesses(sid: string, profile?: null | string): Promise<void> {
  if (!sid) {
    return
  }

  try {
    const result =
      profile == null
        ? await $gateway.get()?.request<{ processes?: GatewayProcessEntry[] }>('process.list', { session_id: sid })
        : await requestGatewayForProfile<{ processes?: GatewayProcessEntry[] }>(profile, 'process.list', {
            session_id: sid
          })

    if (!result) {
      return
    }

    reconcileBackgroundProcesses(sid, result?.processes ?? [], profile)
  } catch (error) {
    // Transient socket loss — the next trigger (event or poll) retries.
    console.error('Failed to refresh background processes', { error, profile, sessionId: sid })
  }
}

/** X on a finished row: drop it now and keep it dropped across refreshes. */
export function dismissBackgroundProcess(sid: string, id: string, profile?: null | string) {
  sid = sessionRuntimeStateKey(profile, sid)
  cancelAutoDismiss(sid, id)

  const dismissed = dismissedBySession.get(sid) ?? new Set<string>()
  dismissed.add(id)
  dismissedBySession.set(sid, dismissed)

  const list = $backgroundStatusBySession.get()[sid] ?? []

  writeBackground(
    sid,
    list.filter(item => item.id !== id)
  )
}

/** Renderer-only terminal cleanup after the backend has archived/deleted the
 * owning session. No process RPC is issued: the successful destructive session
 * mutation is already authoritative, and cleanup must not be retargeted. */
export function discardSessionBackground(sid: string, profile: string): void {
  const key = sessionRuntimeStateKey(profile, sid)
  const timers = autoClearTimers.get(key)

  for (const timer of timers?.values() ?? []) {
    clearTimeout(timer)
  }

  autoClearTimers.delete(key)
  dismissedBySession.delete(key)
  writeBackground(key, [])
}

/** X on a running row: kill the process for real, THEN drop the row. Only drop
 *  on a confirmed kill — dismissing unconditionally (the old behavior) hid the
 *  row while the process lived on, stranding rogue tasks. On failure the row
 *  stays so the user can retry / see it didn't die. */
export async function stopBackgroundProcess(sid: string, id: string, profile?: null | string): Promise<void> {
  try {
    const params = { process_id: id, session_id: sid }

    if (profile == null) {
      const gateway = $gateway.get()

      if (!gateway) {
        throw new Error('Hermes gateway unavailable')
      }

      await gateway.request('process.kill', params)
    } else {
      await requestGatewayForProfile(profile, 'process.kill', params)
    }

    dismissBackgroundProcess(sid, id, profile)
  } catch (err) {
    console.error('Failed to stop background process', { error: err, processId: id, profile, sessionId: sid })
    const fallback = 'Could not stop the process'
    notifyError(profiledPresentationError(err, fallback, profile), fallback)
  }
}

/**
 * Rewind cleanup: a restore/edit discards the turns that spawned these
 * processes, so they belong to an abandoned timeline. Finished rows disappear
 * immediately; running rows disappear only after their owner confirms the kill.
 * A failed kill remains visible and retryable instead of hiding live work.
 */
export async function resetSessionBackground(sid: string, profile?: null | string): Promise<void> {
  if (!sid) {
    return
  }

  const runtimeSid = sid
  const stateKey = sessionRuntimeStateKey(profile, sid)
  const list = $backgroundStatusBySession.get()[stateKey] ?? []

  await Promise.all(
    list.map(async item => {
      if (item.state !== 'running') {
        dismissBackgroundProcess(runtimeSid, item.id, profile)

        return
      }

      await stopBackgroundProcess(runtimeSid, item.id, profile)
    })
  )
}
