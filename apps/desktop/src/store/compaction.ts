import { atom, computed } from 'nanostores'

import { sessionRuntimeStateKey } from './session-states'

// Per-session flag while auto-compaction runs mid-turn. Without it the
// transcript looks like it reset; per-session so a background chat can't
// clobber the foreground view.
const keyFor = (sessionId: string | null | undefined, profile?: null | string): string =>
  sessionRuntimeStateKey(profile, sessionId ?? '')

export const $compactingSessions = atom<Record<string, true>>({})

/** Is `sessionId` compacting? Per-session because a transcript may be a tile,
 *  and a tile must never wear the primary chat's compaction state. */
export function sessionCompacting(sessionId: null | string, profile?: null | string) {
  return computed($compactingSessions, sessions => keyFor(sessionId, profile) in sessions)
}

export function setSessionCompacting(
  sessionId: string | null | undefined,
  active: boolean,
  profile?: null | string
): void {
  const key = keyFor(sessionId, profile)
  const sessions = $compactingSessions.get()

  if (active) {
    if (key in sessions) {
      return
    }

    $compactingSessions.set({ ...sessions, [key]: true })

    return
  }

  if (!(key in sessions)) {
    return
  }

  const next = { ...sessions }
  delete next[key]
  $compactingSessions.set(next)
}
