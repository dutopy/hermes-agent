import { atom } from 'nanostores'

import { $gateway, requestGatewayForProfile } from './gateway'
import { sessionRuntimeStateKey } from './session-states'

export type GoalStatus = 'active' | 'done' | 'paused' | 'waiting'

export interface SessionGoal {
  detail?: string
  status: GoalStatus
  title: string
  updatedAt: number
}

export const $goalsBySession = atom<Record<string, SessionGoal>>({})

const DONE_LINGER_MS = 8_000
const clearTimers = new Map<string, ReturnType<typeof setTimeout>>()

function cancelScheduledClear(key: string) {
  const timer = clearTimers.get(key)

  if (timer !== undefined) {
    clearTimeout(timer)
    clearTimers.delete(key)
  }
}

export function setSessionGoal(sid: string, goal: SessionGoal, profile?: null | string) {
  if (!sid) {
    return
  }

  const key = sessionRuntimeStateKey(profile, sid)
  cancelScheduledClear(key)
  $goalsBySession.set({ ...$goalsBySession.get(), [key]: goal })

  if (goal.status === 'done') {
    clearTimers.set(
      key,
      setTimeout(() => {
        clearTimers.delete(key)
        clearSessionGoal(sid, profile)
      }, DONE_LINGER_MS)
    )
  }
}

export function clearSessionGoal(sid: string, profile?: null | string) {
  const key = sessionRuntimeStateKey(profile, sid)
  cancelScheduledClear(key)

  const map = $goalsBySession.get()

  if (!(key in map)) {
    return
  }

  const { [key]: _drop, ...rest } = map
  $goalsBySession.set(rest)
}

const clean = (value: string): string => value.replace(/\r/g, '').trim()

const firstLine = (value: string): string => clean(value).split('\n')[0]?.trim() ?? ''

function goalTitleFromLine(line: string, pattern: RegExp): string {
  return (line.match(pattern)?.[1] ?? '').trim()
}

function nextGoalFromText(text: string, previous?: SessionGoal): SessionGoal | null | undefined {
  const body = clean(text)
  const line = firstLine(body)

  if (!line) {
    return undefined
  }

  if (
    /^No active goal\b/i.test(line) ||
    /^No goal (?:set|to resume)\b/i.test(line) ||
    /^✓ Goal cleared\b/i.test(line)
  ) {
    return null
  }

  const now = Date.now()
  const fromSet = goalTitleFromLine(line, /^⊙ Goal set(?:\s*\([^)]*\))?:\s*(.+)$/)
  const fromActive = goalTitleFromLine(line, /^⊙ Goal\s*\([^)]*active[^)]*\):\s*(.+)$/)
  const fromResume = goalTitleFromLine(line, /^▶ Goal resumed:\s*(.+)$/)

  if (fromSet || fromActive || fromResume) {
    return { status: 'active', title: fromSet || fromActive || fromResume, updatedAt: now }
  }

  const fromWaiting = goalTitleFromLine(line, /^⏳ Goal\s*\([^)]*(?:parked|active)[^)]*\):\s*(.+)$/)

  if (fromWaiting) {
    return { status: 'waiting', title: fromWaiting, updatedAt: now }
  }

  const fromPaused = goalTitleFromLine(line, /^⏸ Goal(?:\s*\([^)]*\)| paused)?:\s*(.+)$/)

  if (fromPaused) {
    return { status: 'paused', title: fromPaused, updatedAt: now }
  }

  const fromDone = goalTitleFromLine(line, /^✓ Goal done\s*\([^)]*\):\s*(.+)$/)

  if (fromDone) {
    return { status: 'done', title: fromDone, updatedAt: now }
  }

  if (/^↻ Continuing toward goal\b/i.test(line)) {
    return {
      detail: line.replace(/^↻\s*/, ''),
      status: 'active',
      title: previous?.title || 'Standing goal',
      updatedAt: now
    }
  }

  if (/^⏳ Goal parked\b/i.test(line)) {
    return {
      detail: line.replace(/^⏳\s*/, ''),
      status: 'waiting',
      title: previous?.title || 'Standing goal',
      updatedAt: now
    }
  }

  if (/^⏸ Goal paused\b/i.test(line)) {
    return {
      detail: line.replace(/^⏸\s*/, ''),
      status: 'paused',
      title: previous?.title || 'Standing goal',
      updatedAt: now
    }
  }

  if (/^✓ Goal achieved\b/i.test(line)) {
    return {
      detail: line.replace(/^✓\s*/, ''),
      status: 'done',
      title: previous?.title || 'Standing goal',
      updatedAt: now
    }
  }

  return undefined
}

export function applyGoalStatusText(sid: string, text: string, profile?: null | string) {
  if (!sid) {
    return
  }

  const key = sessionRuntimeStateKey(profile, sid)
  const next = nextGoalFromText(text, $goalsBySession.get()[key])

  if (next === null) {
    clearSessionGoal(sid, profile)
  } else if (next) {
    setSessionGoal(sid, next, profile)
  }
}

export async function refreshSessionGoal(sid: string, profile?: null | string): Promise<void> {
  const gateway = profile == null ? $gateway.get() : null

  if (!sid || (profile == null && !gateway)) {
    return
  }

  try {
    const params = { command: 'goal status', session_id: sid }
    const result = profile
      ? await requestGatewayForProfile<{ output?: string }>(profile, 'slash.exec', params)
      : await gateway!.request<{ output?: string }>('slash.exec', params)
    applyGoalStatusText(sid, result?.output ?? '', profile)
  } catch {
    // Best-effort: older gateways or detached sessions simply won't hydrate it.
  }
}
