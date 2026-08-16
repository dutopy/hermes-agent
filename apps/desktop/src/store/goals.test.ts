import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestGatewayForProfile } from './gateway'
import {
  $goalsBySession,
  applyGoalStatusText,
  clearSessionGoal,
  refreshSessionGoal,
  setSessionGoal
} from './goals'
import { sessionRuntimeStateKey } from './session-states'

vi.mock('./gateway', () => ({
  $gateway: { get: vi.fn(() => null) },
  requestGatewayForProfile: vi.fn()
}))

describe('goal store', () => {
  afterEach(() => {
    vi.useRealTimers()
    $goalsBySession.set({})
  })

  it('stores active goals from /goal output', () => {
    applyGoalStatusText('s1', '⊙ Goal set (20-turn budget): ship the feature')

    expect($goalsBySession.get().s1).toMatchObject({
      status: 'active',
      title: 'ship the feature'
    })
  })

  it('keeps the current title for continuation and pause messages', () => {
    applyGoalStatusText('s1', '⊙ Goal set (20-turn budget): ship the feature')
    applyGoalStatusText('s1', '↻ Continuing toward goal (1/20): next step is tests')

    expect($goalsBySession.get().s1).toMatchObject({
      detail: 'Continuing toward goal (1/20): next step is tests',
      status: 'active',
      title: 'ship the feature'
    })

    applyGoalStatusText('s1', '⏸ Goal paused — 20/20 turns used. Use /goal resume to keep going.')

    expect($goalsBySession.get().s1).toMatchObject({
      status: 'paused',
      title: 'ship the feature'
    })
  })

  it('lingers done goals before clearing them', () => {
    vi.useFakeTimers()

    applyGoalStatusText('s1', '⊙ Goal set (20-turn budget): ship the feature')
    applyGoalStatusText('s1', '✓ Goal achieved: tests pass')

    expect($goalsBySession.get().s1).toMatchObject({ status: 'done' })

    vi.advanceTimersByTime(7_999)
    expect($goalsBySession.get().s1).toBeTruthy()

    vi.advanceTimersByTime(1)
    expect($goalsBySession.get().s1).toBeUndefined()
  })

  it('clears on no-goal output', () => {
    applyGoalStatusText('s1', '⊙ Goal set (20-turn budget): ship another feature')
    applyGoalStatusText('s1', 'No active goal. Set one with /goal <text>.')

    expect($goalsBySession.get().s1).toBeUndefined()
  })

  it('cancels pending done clears when replacing a goal', () => {
    vi.useFakeTimers()

    applyGoalStatusText('s1', '⊙ Goal set: first')
    applyGoalStatusText('s1', '✓ Goal achieved: first done')
    applyGoalStatusText('s1', '⊙ Goal set: second')

    vi.advanceTimersByTime(8_000)

    expect($goalsBySession.get().s1).toMatchObject({ status: 'active', title: 'second' })

    clearSessionGoal('s1')
  })

  it('isolates writes, clears, and done timers for colliding runtime ids by profile', () => {
    vi.useFakeTimers()
    const aKey = sessionRuntimeStateKey('profile-a', 'shared')
    const bKey = sessionRuntimeStateKey('profile-b', 'shared')

    applyGoalStatusText('shared', '⊙ Goal set: goal A', 'profile-a')
    applyGoalStatusText('shared', '✓ Goal done (1/1): goal B', 'profile-b')

    expect($goalsBySession.get()[aKey]?.title).toBe('goal A')
    expect($goalsBySession.get()[bKey]?.title).toBe('goal B')
    clearSessionGoal('shared', 'profile-a')
    vi.advanceTimersByTime(8_000)

    expect($goalsBySession.get()[aKey]).toBeUndefined()
    expect($goalsBySession.get()[bKey]).toBeUndefined()
  })

  it('does not let one profile cancel another profile done timer', () => {
    vi.useFakeTimers()
    const aKey = sessionRuntimeStateKey('profile-a', 'shared')
    const bKey = sessionRuntimeStateKey('profile-b', 'shared')

    setSessionGoal('shared', { status: 'done', title: 'done A', updatedAt: 1 }, 'profile-a')
    setSessionGoal('shared', { status: 'active', title: 'active B', updatedAt: 2 }, 'profile-b')
    vi.advanceTimersByTime(8_000)

    expect($goalsBySession.get()[aKey]).toBeUndefined()
    expect($goalsBySession.get()[bKey]?.title).toBe('active B')
  })

  it('hydrates through the owning profile requester and stores only its qualified goal', async () => {
    vi.mocked(requestGatewayForProfile).mockResolvedValue({ output: '⊙ Goal set: owned goal' })

    await refreshSessionGoal('shared', 'profile-b')

    expect(requestGatewayForProfile).toHaveBeenCalledWith('profile-b', 'slash.exec', {
      command: 'goal status',
      session_id: 'shared'
    })
    expect($goalsBySession.get()[sessionRuntimeStateKey('profile-b', 'shared')]?.title).toBe('owned goal')
    expect($goalsBySession.get().shared).toBeUndefined()
  })
})
