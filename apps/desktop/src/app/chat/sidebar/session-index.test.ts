import { describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/types/hermes'

import {
  buildPinnedIdentitySet,
  buildSessionByAnyId,
  isPinnedSessionIdentity,
  resolvePinnedSessions,
  sidebarPinKey
} from './session-index'

const row = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({ id, message_count: 1, source: 'cli', started_at: 0, title: id, ...extra }) as SessionInfo

describe('buildSessionByAnyId', () => {
  it('resolves a pin from every slice the sidebar fetches', () => {
    // The contract that matters: a pin is looked up in this map no matter
    // which slice owns the row. Messaging is the one that regressed — a
    // pinned session is filtered out of its own section, so a miss here
    // removes it from the sidebar entirely rather than just misplacing it.
    const index = buildSessionByAnyId([row('recent')], [row('cron_job_1')], [row('telegram_42')])

    for (const id of ['recent', 'cron_job_1', 'telegram_42']) {
      expect(index.get(id)?.id).toBe(id)
    }
  })

  it('resolves a pin stored on the pre-compression lineage root', () => {
    const index = buildSessionByAnyId([], [], [row('tip', { _lineage_root_id: 'root' })])

    // Both identities point at the one live row.
    expect(index.get('root')?.id).toBe('tip')
    expect(index.get('tip')?.id).toBe('tip')
  })

  it('resolves homonymous pins by profile-qualified durable identity', () => {
    const index = buildSessionByAnyId(
      [row('same', { profile: 'profile-a', title: 'A' }), row('same', { profile: 'profile-b', title: 'B' })],
      [],
      []
    )

    expect(index.get('profile-a\u0000same')?.title).toBe('A')
    expect(index.get('profile-b\u0000same')?.title).toBe('B')
  })

  it('resolves a legacy naked homonym deterministically without treating every homonym as pinned', () => {
    const sessions = [
      row('same', { profile: 'profile-a', title: 'A' }),
      row('same', { profile: 'profile-b', title: 'B' })
    ]

    const pinned = resolvePinnedSessions(['same'], buildSessionByAnyId(sessions, [], []))
    const identities = buildPinnedIdentitySet(pinned)

    expect(pinned.map(session => session.title)).toEqual(['B'])
    expect(isPinnedSessionIdentity(sessions[0], identities)).toBe(false)
    expect(isPinnedSessionIdentity(sessions[1], identities)).toBe(true)
  })

  it('keeps qualified homonymous pins independent across direct and lineage identities', () => {
    const sessions = [
      row('same', { _lineage_root_id: 'root', profile: 'profile-a', title: 'A' }),
      row('same', { _lineage_root_id: 'root', profile: 'profile-b', title: 'B' })
    ]

    const index = buildSessionByAnyId(sessions, [], [])
    const onlyB = resolvePinnedSessions(['profile-b\u0000root'], index)
    const both = resolvePinnedSessions(['profile-a\u0000root', 'profile-b\u0000root'], index)

    expect(onlyB.map(session => session.title)).toEqual(['B'])
    expect(isPinnedSessionIdentity(sessions[0], buildPinnedIdentitySet(onlyB))).toBe(false)
    expect(isPinnedSessionIdentity(sessions[1], buildPinnedIdentitySet(onlyB))).toBe(true)
    expect(both.map(session => session.title)).toEqual(['A', 'B'])
  })

  it('builds qualified pin mutation keys only when the row provides a profile', () => {
    expect(sidebarPinKey('same', 'profile-b')).toBe('profile-b\u0000same')
    expect(sidebarPinKey('same')).toBe('same')
  })

  it('lets a recents row win a direct id collision', () => {
    const index = buildSessionByAnyId(
      [row('dupe', { title: 'from recents' })],
      [],
      [row('dupe', { title: 'from messaging' })]
    )

    expect(index.get('dupe')?.title).toBe('from recents')
  })

  it('does not let a lineage alias clobber a real row under that id', () => {
    // 'root' is a live session in its own right AND another row's lineage
    // root; the real row must win so the pin opens the right conversation.
    const index = buildSessionByAnyId([row('root')], [], [row('tip', { _lineage_root_id: 'root' })])

    expect(index.get('root')?.id).toBe('root')
  })

  it('does not let a qualified lineage alias clobber a qualified real row', () => {
    const index = buildSessionByAnyId(
      [row('tip', { _lineage_root_id: 'root', profile: 'profile-a' })],
      [row('root', { profile: 'profile-a' })],
      []
    )

    expect(index.get('profile-a\u0000root')?.id).toBe('root')
  })
})
