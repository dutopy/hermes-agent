import { sessionDurableStateKey } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

const sessionIdentityKey = (session: Pick<SessionInfo, 'id' | 'profile'>): string =>
  sessionDurableStateKey(session.profile, session.id)

/** Persist an explicitly-owned pin under its profile-qualified durable key.
 * Missing ownership is the guarded compatibility path for legacy rows/pins. */
export function sidebarPinKey(sessionId: string, profile?: string): string {
  return sessionDurableStateKey(profile, sessionId)
}

/**
 * Index sessions by every id a pin might be stored under.
 *
 * The sidebar fetches three independent slices — recents, cron, and messaging
 * — and renders the latter two in self-managed sections. Any of them can be
 * pinned, so all three must be indexed here or the Pinned section can't
 * resolve the pin to a row. A pinned session is also filtered out of its own
 * section, so failing to index it doesn't merely misplace the row: it removes
 * the session from the sidebar entirely.
 *
 * Each session is keyed under both its live id and its lineage root, so a pin
 * stored before an auto-compression still resolves to the live continuation
 * tip. Recents are indexed last and win a direct id collision.
 */
export function buildSessionByAnyId(
  visibleSessions: SessionInfo[],
  cronSessions: SessionInfo[],
  messagingSessions: SessionInfo[]
): Map<string, SessionInfo> {
  const map = new Map<string, SessionInfo>()

  for (const session of [...cronSessions, ...messagingSessions, ...visibleSessions]) {
    map.set(session.id, session)
    map.set(sessionDurableStateKey(session.profile, session.id), session)

    if (session._lineage_root_id && !map.has(session._lineage_root_id)) {
      map.set(session._lineage_root_id, session)
    }

    if (session._lineage_root_id) {
      const qualifiedRoot = sessionDurableStateKey(session.profile, session._lineage_root_id)

      if (!map.has(qualifiedRoot)) {
        map.set(qualifiedRoot, session)
      }
    }
  }

  return map
}

/** Resolve persisted pins in their saved order. The resolved row identity,
 * rather than its naked stored id, is the dedupe key so A/same and B/same can
 * coexist. A naked legacy pin still resolves to the index's one deterministic
 * compatibility winner. */
export function resolvePinnedSessions(
  pinnedSessionIds: readonly string[],
  sessionByAnyId: ReadonlyMap<string, SessionInfo>
): SessionInfo[] {
  const seen = new Set<string>()
  const out: SessionInfo[] = []

  for (const pinId of pinnedSessionIds) {
    const session = sessionByAnyId.get(pinId)
    const identity = session ? sessionIdentityKey(session) : null

    if (session && identity && !seen.has(identity)) {
      seen.add(identity)
      out.push(session)
    }
  }

  return out
}

/** Qualified direct and lineage identities represented by resolved pins.
 * Raw naked pins are intentionally not copied in: doing so hides every
 * profiled homonym instead of only the deterministic legacy winner. */
export function buildPinnedIdentitySet(pinnedSessions: readonly SessionInfo[]): Set<string> {
  const identities = new Set<string>()

  for (const session of pinnedSessions) {
    identities.add(sessionIdentityKey(session))

    if (session._lineage_root_id) {
      identities.add(sessionDurableStateKey(session.profile, session._lineage_root_id))
    }
  }

  return identities
}

export function isPinnedSessionIdentity(session: SessionInfo, pinnedIdentities: ReadonlySet<string>): boolean {
  return (
    pinnedIdentities.has(sessionIdentityKey(session)) ||
    Boolean(
      session._lineage_root_id &&
        pinnedIdentities.has(sessionDurableStateKey(session.profile, session._lineage_root_id))
    )
  )
}
