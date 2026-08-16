import { beforeEach, describe, expect, it } from 'vitest'

import { $backgroundResume } from './background-delegation'
import { $activeGatewayProfile } from './profile'
import { $activeSessionId, $busy } from './session'
import { sessionRuntimeStateKey } from './session-states'
import { $subagentsBySession, type SubagentProgress, type SubagentStreamEntry } from './subagents'

const sub = (over: Partial<SubagentProgress> = {}): SubagentProgress => ({
  id: over.id ?? 'deleg:1',
  parentId: null,
  goal: 'do the thing',
  status: 'running',
  taskCount: 1,
  taskIndex: 0,
  startedAt: 0,
  updatedAt: 0,
  filesRead: [],
  filesWritten: [],
  stream: [],
  ...over
})

const stream = (text: string): SubagentStreamEntry => ({ at: 0, kind: 'progress', text })
const PROFILE = 'profile-b'
const key = (sid: string) => sessionRuntimeStateKey(PROFILE, sid)

describe('$backgroundResume', () => {
  beforeEach(() => {
    $busy.set(false)
    $activeGatewayProfile.set(PROFILE)
    $activeSessionId.set('s1')
    $subagentsBySession.set({})
  })

  it('ignores naked legacy activity when the active session has an explicit profile', () => {
    $subagentsBySession.set({ s1: [sub({ id: 'legacy-a', stream: [stream('Profile A activity')] })] })

    expect($backgroundResume.get()).toBeNull()
  })

  it('uses only qualified running/queued children for the active profile', () => {
    $subagentsBySession.set({
      s1: [sub({ id: 'legacy-a', stream: [stream('Profile A activity')] })],
      [key('s1')]: [sub({ id: 'b', status: 'queued', stream: [stream('Profile B activity')] })]
    })

    expect($backgroundResume.get()).toEqual({ activity: 'Profile B activity', count: 1 })
  })

  it('surfaces the primary child latest stream line as live activity', () => {
    $subagentsBySession.set({ [key('s1')]: [sub({ id: 'a', stream: [stream('Searching the web…')] })] })
    expect($backgroundResume.get()?.activity).toBe('Searching the web…')
  })

  it('activity is null when no stream line has arrived (UI uses generic copy)', () => {
    $subagentsBySession.set({ [key('s1')]: [sub({ id: 'a' })] })
    expect($backgroundResume.get()?.activity).toBeNull()
  })

  it('is null while a turn is busy (the turn owns the main loader)', () => {
    $subagentsBySession.set({ [key('s1')]: [sub({ id: 'a' })] })
    $busy.set(true)
    expect($backgroundResume.get()).toBeNull()
  })

  it('is null when only terminal children or other sessions have work', () => {
    $subagentsBySession.set({
      [key('s1')]: [sub({ id: 'a', status: 'completed' }), sub({ id: 'b', status: 'failed' })],
      [key('s2')]: [sub({ id: 'c' })]
    })
    expect($backgroundResume.get()).toBeNull()
  })

  it('is null when there is no active session', () => {
    $subagentsBySession.set({ s1: [sub({ id: 'a' })] })
    $activeSessionId.set(null)
    expect($backgroundResume.get()).toBeNull()
  })
})
