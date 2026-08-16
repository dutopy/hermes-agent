import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import type { TodoItem } from '@/lib/todos'
import type { SessionInfo } from '@/types/hermes'

import { $backgroundRunningSessionIds, $backgroundStatusBySession } from './composer-status'
import { $sessions, $unreadFinishedSessionIds, lineageAliases, sessionDurableStateValue } from './session'
import { $sessionDotStateById } from './session-dot-state'
import {
  $stalledSessionIds,
  $workingSessionIds,
  clearAllSessionStates,
  publishSessionState,
  SESSION_WATCHDOG_TIMEOUT_MS,
  sessionRuntimeStateKey
} from './session-states'
import { $todoProgressBySession, $todosBySession, setSessionTodos } from './todos'

const durableKey = (profile: string, storedSessionId: string) => `${profile}\u0000${storedSessionId}`

const state = (storedSessionId: string, busy: boolean): ClientSessionState =>
  ({
    awaitingResponse: false,
    busy,
    messages: [],
    needsInput: false,
    storedSessionId
  }) as unknown as ClientSessionState

const todo = (id: string): TodoItem => ({ content: id, id, status: 'in_progress' })

const session = (profile: string, id: string, root: string): SessionInfo =>
  ({ _lineage_root_id: root, id, profile }) as SessionInfo

describe('profile-qualified durable projections', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearAllSessionStates()
    $sessions.set([])
    $todosBySession.set({})
    $backgroundStatusBySession.set({})
  })

  it('reads bare legacy state only when the profile is omitted', () => {
    expect(sessionDurableStateValue({ same: 'legacy', [durableKey('profile-a', 'same')]: 'owned' }, 'profile-a', 'same')).toBe(
      'owned'
    )
    expect(sessionDurableStateValue({ same: 'legacy' }, 'profile-a', 'same')).toBeUndefined()
    expect(sessionDurableStateValue({ [durableKey('profile-a', 'same')]: 'owned' }, 'profile-b', 'same')).toBeUndefined()
    expect(sessionDurableStateValue({ same: 'legacy' }, undefined, 'same')).toBe('legacy')
  })

  it('does not project one profile runtime state onto a colliding durable id in another profile', () => {
    $sessions.set([session('profile-a', 'same', 'same'), session('profile-b', 'same', 'same')])

    publishSessionState('runtime', state('same', true), 'profile-a')
    publishSessionState('runtime', state('same', false), 'profile-b')

    expect($workingSessionIds.get()).toContain(durableKey('profile-a', 'same'))
    expect($workingSessionIds.get()).not.toContain(durableKey('profile-b', 'same'))
    expect($sessionDotStateById.get()[durableKey('profile-a', 'same')]).toBe('working')
    expect($sessionDotStateById.get()[durableKey('profile-b', 'same')]).toBeUndefined()
  })

  it('keeps lineage aliases inside their owning profile', () => {
    const sessions = [session('profile-a', 'tip-a', 'root'), session('profile-b', 'tip-b', 'root')]

    expect(lineageAliases('root', sessions, 'profile-a')).toEqual(['root', 'tip-a'])
    expect(lineageAliases('root', sessions, 'profile-b')).toEqual(['root', 'tip-b'])
  })

  it('qualifies todo and background durable projections when runtime ids collide', () => {
    $sessions.set([session('profile-a', 'same', 'same'), session('profile-b', 'same', 'same')])
    publishSessionState('runtime', state('same', false), 'profile-a')
    publishSessionState('runtime', state('same', false), 'profile-b')

    setSessionTodos('runtime', [todo('a')], 'profile-a')
    $backgroundStatusBySession.set({
      [sessionRuntimeStateKey('profile-b', 'runtime')]: [
        { id: 'process', state: 'running', title: 'process', type: 'background' }
      ]
    })

    expect($todoProgressBySession.get()).toEqual({ [durableKey('profile-a', 'same')]: '0/1' })
    expect($backgroundRunningSessionIds.get()).toEqual([durableKey('profile-b', 'same')])
  })

  it('qualifies stalled and unread terminal-state projections', () => {
    $sessions.set([session('profile-a', 'same', 'same'), session('profile-b', 'same', 'same')])
    $unreadFinishedSessionIds.set([])

    publishSessionState('runtime', state('same', true), 'profile-a')
    vi.advanceTimersByTime(SESSION_WATCHDOG_TIMEOUT_MS)

    expect($stalledSessionIds.get()).toEqual([durableKey('profile-a', 'same')])

    publishSessionState('runtime', state('same', false), 'profile-a')

    expect($unreadFinishedSessionIds.get()).toEqual([durableKey('profile-a', 'same')])
    expect($sessionDotStateById.get()[durableKey('profile-b', 'same')]).toBeUndefined()
  })
})
