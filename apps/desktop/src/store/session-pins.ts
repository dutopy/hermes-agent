import type { SessionInfo } from '@/types/hermes'

import { $pinnedSessionIds, pinSession, unpinSession } from './layout'
import { normalizeProfileKey } from './profile'
import { sessionDurableStateKey, sessionMatchesStoredId, sessionPinId } from './session'

/** Canonical durable pin key for a stored session. Explicit owners are always
 * profile-qualified; omitted ownership is the guarded legacy compatibility path. */
export function sessionPinKeyForOwner(
  storedSessionId: string,
  profile: null | string | undefined,
  sessions: readonly SessionInfo[]
): string {
  const owner = profile == null ? null : normalizeProfileKey(profile)
  const session = sessions.find(
    candidate =>
      (owner === null || normalizeProfileKey(candidate.profile) === owner) &&
      sessionMatchesStoredId(candidate, storedSessionId)
  )
  const durableId = session ? sessionPinId(session) : storedSessionId

  return sessionDurableStateKey(owner, durableId)
}

/** Toggle exactly one durable profile-owned pin. */
export function toggleSessionPinForOwner(
  storedSessionId: string,
  profile: null | string | undefined,
  sessions: readonly SessionInfo[]
): string {
  const key = sessionPinKeyForOwner(storedSessionId, profile, sessions)

  toggleSessionPinKey(key)

  return key
}

export function toggleSessionPinKey(key: string): void {
  if ($pinnedSessionIds.get().includes(key)) {
    unpinSession(key)
  } else {
    pinSession(key)
  }
}
