import { beforeEach, describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/types/hermes'

import { $pinnedSessionIds } from './layout'
import { sessionPinKeyForOwner, toggleSessionPinForOwner } from './session-pins'

const row = (profile: string): SessionInfo =>
  ({
    _lineage_root_id: 'root',
    id: 'same',
    message_count: 1,
    profile,
    source: 'desktop',
    started_at: 1,
    title: profile
  }) as SessionInfo

describe('profile-owned session pins', () => {
  beforeEach(() => $pinnedSessionIds.set([]))

  it('pins and unpins B independently from homonymous A and legacy pins', () => {
    const sessions = [row('profile-a'), row('profile-b')]
    const aKey = sessionPinKeyForOwner('same', 'profile-a', sessions)
    const bKey = sessionPinKeyForOwner('same', 'profile-b', sessions)
    $pinnedSessionIds.set(['root', aKey])

    toggleSessionPinForOwner('same', 'profile-b', sessions)
    expect($pinnedSessionIds.get()).toEqual(['root', aKey, bKey])

    toggleSessionPinForOwner('same', 'profile-b', sessions)
    expect($pinnedSessionIds.get()).toEqual(['root', aKey])
  })
})
