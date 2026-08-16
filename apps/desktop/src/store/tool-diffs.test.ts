import { describe, expect, it } from 'vitest'

import { $toolInlineDiff, getToolDiff, recordToolDiff } from './tool-diffs'

describe('tool-diffs per-tool subscriptions', () => {
  it('isolates identical tool ids by profile and runtime without profiled legacy fallback', () => {
    const runtimeId = 'shared-runtime'
    const toolCallId = 'shared-tool'

    recordToolDiff(toolCallId, 'legacy', undefined)
    recordToolDiff(toolCallId, 'profile A', { profile: 'profile-a', runtimeId })
    recordToolDiff(toolCallId, 'profile B', { profile: 'profile-b', runtimeId })

    expect(getToolDiff(toolCallId, { profile: 'profile-a', runtimeId })).toBe('profile A')
    expect(getToolDiff(toolCallId, { profile: 'profile-b', runtimeId })).toBe('profile B')
    expect(getToolDiff(toolCallId, { profile: 'profile-c', runtimeId })).toBe('')
    expect(getToolDiff(toolCallId)).toBe('legacy')
  })

  it('returns a stable cached atom per toolCallId', () => {
    expect($toolInlineDiff('a')).toBe($toolInlineDiff('a'))
    expect($toolInlineDiff('a')).not.toBe($toolInlineDiff('b'))
  })

  it('notifies only the tool whose diff changed', () => {
    const aCalls: string[] = []
    const bCalls: string[] = []
    const unsubA = $toolInlineDiff('notify-a').listen(v => aCalls.push(v))
    const unsubB = $toolInlineDiff('notify-b').listen(v => bCalls.push(v))

    recordToolDiff('notify-a', 'diffA')
    expect(aCalls).toEqual(['diffA'])
    expect(bCalls).toEqual([]) // the unrelated tool row is never notified

    recordToolDiff('notify-b', 'diffB')
    expect(aCalls).toEqual(['diffA']) // still not re-notified
    expect(bCalls).toEqual(['diffB'])

    unsubA()
    unsubB()
  })

  it('does not re-notify when the same diff is recorded again', () => {
    const calls: string[] = []
    const unsub = $toolInlineDiff('same').listen(v => calls.push(v))

    recordToolDiff('same', 'x')
    recordToolDiff('same', 'x')

    expect(calls).toEqual(['x'])
    unsub()
  })

  it('reads the current diff for a tool and empty for unknown/blank ids', () => {
    recordToolDiff('read-me', 'value')
    expect(getToolDiff('read-me')).toBe('value')
    expect(getToolDiff('missing')).toBe('')
    expect(getToolDiff('')).toBe('')
    expect($toolInlineDiff('').get()).toBe('')
  })
})
