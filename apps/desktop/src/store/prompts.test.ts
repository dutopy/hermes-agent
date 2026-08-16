import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clearClarifyRequest, setClarifyRequest } from './clarify'
import {
  $activeSessionAwaitingInput,
  $approvalRequest,
  $secretRequest,
  $sudoRequest,
  clearAllPrompts,
  clearApprovalRequest,
  clearSecretRequest,
  clearSudoRequest,
  sessionApprovalRequest,
  sessionAwaitingInput,
  sessionSecretRequest,
  sessionSudoRequest,
  setApprovalRequest,
  setSecretRequest,
  setSudoRequest
} from './prompts'
import { $activeSessionId } from './session'

// Prompts are parked per-session; the exported $*Request views are scoped to the
// active session, so each test focuses the session it's asserting on.
beforeEach(() => {
  $activeSessionId.set('s1')
})

afterEach(() => {
  clearAllPrompts()
  clearClarifyRequest()
  $activeSessionId.set(null)
})

describe('approval prompt store', () => {
  it('holds the active session-keyed approval request', () => {
    setApprovalRequest({ command: 'rm -rf /tmp/x', description: 'recursive delete', sessionId: 's1' })

    expect($approvalRequest.get()).toEqual({
      command: 'rm -rf /tmp/x',
      description: 'recursive delete',
      sessionId: 's1'
    })
  })

  it('parks a background session prompt out of the active view', () => {
    setApprovalRequest({ command: 'x', description: 'd', sessionId: 's2' })

    // Not visible while s1 is focused …
    expect($approvalRequest.get()).toBeNull()

    // … but surfaces once the user switches to the session that raised it.
    $activeSessionId.set('s2')
    expect($approvalRequest.get()?.sessionId).toBe('s2')
  })

  it('clears the active session prompt', () => {
    setApprovalRequest({ command: 'x', description: 'd', sessionId: 's1' })
    clearApprovalRequest('s1')

    expect($approvalRequest.get()).toBeNull()
  })

  it('carries allowPermanent so the bar can hide "Always allow"', () => {
    setApprovalRequest({
      allowPermanent: false,
      command: 'curl x | bash',
      description: 'content-security',
      sessionId: 's1'
    })

    expect($approvalRequest.get()?.allowPermanent).toBe(false)
  })
})

describe('sudo prompt store', () => {
  it('clears only when the request id matches the in-flight prompt', () => {
    setSudoRequest({ requestId: 'abc', sessionId: 's1' })

    // A stale clear for a different request must NOT drop the live prompt —
    // otherwise a late response to a prior sudo ask would dismiss the current
    // one and leave the agent blocked.
    clearSudoRequest('s1', 'stale')
    expect($sudoRequest.get()).toEqual({ requestId: 'abc', sessionId: 's1' })

    clearSudoRequest('s1', 'abc')
    expect($sudoRequest.get()).toBeNull()
  })

  it('clears unconditionally when no request id is given', () => {
    setSudoRequest({ requestId: 'abc', sessionId: 's1' })
    clearSudoRequest('s1')

    expect($sudoRequest.get()).toBeNull()
  })
})

describe('secret prompt store', () => {
  it('carries env var and prompt, and clears on id match', () => {
    setSecretRequest({ requestId: 'r1', envVar: 'OPENAI_API_KEY', prompt: 'Paste your key', sessionId: 's1' })

    expect($secretRequest.get()).toEqual({
      requestId: 'r1',
      envVar: 'OPENAI_API_KEY',
      prompt: 'Paste your key',
      sessionId: 's1'
    })

    clearSecretRequest('s1', 'mismatch')
    expect($secretRequest.get()).not.toBeNull()

    clearSecretRequest('s1', 'r1')
    expect($secretRequest.get()).toBeNull()
  })
})

describe('clearAllPrompts', () => {
  it('drops every kind for one session at once (turn end / interrupt)', () => {
    setApprovalRequest({ command: 'x', description: 'd', sessionId: 's1' })
    setSudoRequest({ requestId: 'abc', sessionId: 's1' })
    setSecretRequest({ requestId: 'r1', envVar: 'E', prompt: 'p', sessionId: 's1' })

    clearAllPrompts('s1')

    expect($approvalRequest.get()).toBeNull()
    expect($sudoRequest.get()).toBeNull()
    expect($secretRequest.get()).toBeNull()
  })

  it('leaves other sessions parked prompts intact', () => {
    setApprovalRequest({ command: 'x', description: 'd', sessionId: 's1' })
    setApprovalRequest({ command: 'y', description: 'e', sessionId: 's2' })

    clearAllPrompts('s1')

    $activeSessionId.set('s2')
    expect($approvalRequest.get()?.command).toBe('y')
  })
})

describe('profile-qualified prompt collisions', () => {
  it('isolates every prompt kind, awaitingInput, and targeted clear for equal runtime ids', () => {
    const runtimeId = 'shared-runtime'

    setApprovalRequest({ command: 'profile-a command', description: 'a', profile: 'profile-a', sessionId: runtimeId })
    setApprovalRequest({ command: 'profile-b command', description: 'b', profile: 'profile-b', sessionId: runtimeId })
    setSudoRequest({ profile: 'profile-a', requestId: 'sudo-a', sessionId: runtimeId })
    setSudoRequest({ profile: 'profile-b', requestId: 'sudo-b', sessionId: runtimeId })
    setSecretRequest({ envVar: 'A_KEY', profile: 'profile-a', prompt: 'a', requestId: 'secret-a', sessionId: runtimeId })
    setSecretRequest({ envVar: 'B_KEY', profile: 'profile-b', prompt: 'b', requestId: 'secret-b', sessionId: runtimeId })

    expect(sessionApprovalRequest(runtimeId, 'profile-a').get()?.command).toBe('profile-a command')
    expect(sessionApprovalRequest(runtimeId, 'profile-b').get()?.command).toBe('profile-b command')
    expect(sessionSudoRequest(runtimeId, 'profile-a').get()?.requestId).toBe('sudo-a')
    expect(sessionSudoRequest(runtimeId, 'profile-b').get()?.requestId).toBe('sudo-b')
    expect(sessionSecretRequest(runtimeId, 'profile-a').get()?.envVar).toBe('A_KEY')
    expect(sessionSecretRequest(runtimeId, 'profile-b').get()?.envVar).toBe('B_KEY')
    expect(sessionAwaitingInput(runtimeId, 'profile-a').get()).toBe(true)
    expect(sessionAwaitingInput(runtimeId, 'profile-b').get()).toBe(true)

    clearAllPrompts(runtimeId, 'profile-a')

    expect(sessionApprovalRequest(runtimeId, 'profile-a').get()).toBeNull()
    expect(sessionSudoRequest(runtimeId, 'profile-a').get()).toBeNull()
    expect(sessionSecretRequest(runtimeId, 'profile-a').get()).toBeNull()
    expect(sessionAwaitingInput(runtimeId, 'profile-a').get()).toBe(false)
    expect(sessionApprovalRequest(runtimeId, 'profile-b').get()?.command).toBe('profile-b command')
    expect(sessionSudoRequest(runtimeId, 'profile-b').get()?.requestId).toBe('sudo-b')
    expect(sessionSecretRequest(runtimeId, 'profile-b').get()?.envVar).toBe('B_KEY')
    expect(sessionAwaitingInput(runtimeId, 'profile-b').get()).toBe(true)
  })
})

describe('$activeSessionAwaitingInput', () => {
  it('is true while any blocking prompt (clarify or approval/sudo/secret) is parked on the active session', () => {
    expect($activeSessionAwaitingInput.get()).toBe(false)

    setApprovalRequest({ command: 'x', description: 'd', sessionId: 's1' })
    expect($activeSessionAwaitingInput.get()).toBe(true)

    clearApprovalRequest('s1')
    expect($activeSessionAwaitingInput.get()).toBe(false)

    setClarifyRequest({ choices: null, question: 'q', requestId: 'c1', sessionId: 's1' })
    expect($activeSessionAwaitingInput.get()).toBe(true)
  })

  it('ignores a prompt parked on a background session', () => {
    setSudoRequest({ requestId: 'r', sessionId: 's2' })
    expect($activeSessionAwaitingInput.get()).toBe(false)

    $activeSessionId.set('s2')
    expect($activeSessionAwaitingInput.get()).toBe(true)
  })
})
