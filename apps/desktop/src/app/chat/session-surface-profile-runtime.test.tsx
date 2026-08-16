import { useStore } from '@nanostores/react'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessageStream } from '@/app/session/hooks/use-message-stream'
import { useSessionStateCache } from '@/app/session/hooks/use-session-state-cache'
import { chatMessageText } from '@/lib/chat-messages'
import { clearClarifyRequest, sessionClarifyRequest } from '@/store/clarify'
import { $activeGatewayProfile } from '@/store/profile'
import {
  clearAllPrompts,
  sessionApprovalRequest,
  sessionAwaitingInput,
  sessionSecretRequest,
  sessionSudoRequest
} from '@/store/prompts'
import {
  $sessionStates,
  bindSessionSurfaceRuntime,
  clearAllSessionStates,
  releaseSessionSurfaceReference,
  retainSessionSurfaceReference
} from '@/store/session-states'
import type { RpcEvent } from '@/types/hermes'

const RUNTIME_ID = 'shared-runtime'
let handleEvent: ((event: RpcEvent) => void) | null = null
let setMessages = vi.fn()

type UpdateSessionState = ReturnType<typeof useSessionStateCache>['updateSessionState']
let updateSessionState: UpdateSessionState | null = null

function SurfaceTranscript({ profile }: { profile: string }) {
  const states = useStore($sessionStates)
  const state = states[`${profile}\u0000${RUNTIME_ID}`]

  return <div data-testid={`surface-${profile}`}>{state?.messages.map(chatMessageText).join('|') ?? ''}</div>
}

function Harness({ active = false }: { active?: boolean }) {
  const busyRef = useRef(false)
  const queryClientRef = useRef(new QueryClient())
  const cache = useSessionStateCache({
    activeSessionId: active ? RUNTIME_ID : null,
    busyRef,
    selectedStoredSessionId: null,
    setAwaitingResponse: vi.fn(),
    setBusy: vi.fn(),
    setMessages
  })
  const stream = useMessageStream({
    activeGatewayProfile: 'profile-a',
    activeSessionIdRef: cache.activeSessionIdRef,
    hydrateFromStoredSession: vi.fn(async () => undefined),
    queryClient: queryClientRef.current,
    refreshHermesConfig: vi.fn(async () => undefined),
    refreshSessions: vi.fn(async () => undefined),
    sessionStateByRuntimeIdRef: cache.sessionStateByRuntimeIdRef,
    updateSessionState: cache.updateSessionState
  })

  useEffect(() => {
    handleEvent = stream.handleGatewayEvent
    updateSessionState = cache.updateSessionState
  }, [cache.updateSessionState, stream.handleGatewayEvent])

  return (
    <>
      <SurfaceTranscript profile="profile-a" />
      <SurfaceTranscript profile="profile-b" />
    </>
  )
}

function emit(profile: string, type: string, text?: string) {
  act(() =>
    handleEvent!({
      payload: text === undefined ? {} : { text },
      profile,
      session_id: RUNTIME_ID,
      type
    })
  )
}

describe('SessionSurface profile-qualified runtime isolation', () => {
  beforeEach(() => {
    handleEvent = null
    updateSessionState = null
    setMessages = vi.fn()
    $activeGatewayProfile.set('profile-a')
    clearAllSessionStates()
    clearAllPrompts()
    clearClarifyRequest()
  })

  afterEach(() => {
    cleanup()
    clearAllSessionStates()
    clearAllPrompts()
    clearClarifyRequest()
  })

  it('keeps distinct transcripts when two profile gateways emit the same runtime id', async () => {
    render(<Harness />)
    await waitFor(() => expect(updateSessionState).not.toBeNull())

    act(() => {
      retainSessionSurfaceReference('profile-a', 'stored-a')
      bindSessionSurfaceRuntime('profile-a', 'stored-a', RUNTIME_ID)
      retainSessionSurfaceReference('profile-b', 'stored-b')
      bindSessionSurfaceRuntime('profile-b', 'stored-b', RUNTIME_ID)
      updateSessionState!(RUNTIME_ID, state => state, 'stored-a', 'profile-a')
      updateSessionState!(RUNTIME_ID, state => state, 'stored-b', 'profile-b')
    })

    emit('profile-a', 'message.start')
    expect($sessionStates.get()[`profile-a\u0000${RUNTIME_ID}`]).toBeDefined()
    emit('profile-a', 'message.complete', 'answer from A')
    expect($sessionStates.get()[`profile-a\u0000${RUNTIME_ID}`]?.messages.map(chatMessageText).join('|')).toContain(
      'answer from A'
    )
    emit('profile-b', 'message.start')
    emit('profile-b', 'message.complete', 'answer from B')

    expect(screen.getByTestId('surface-profile-a').textContent).toContain('answer from A')
    expect(screen.getByTestId('surface-profile-a').textContent).not.toContain('answer from B')
    expect(screen.getByTestId('surface-profile-b').textContent).toContain('answer from B')
    expect(screen.getByTestId('surface-profile-b').textContent).not.toContain('answer from A')

    releaseSessionSurfaceReference('profile-a', 'stored-a')
    releaseSessionSurfaceReference('profile-b', 'stored-b')
  })

  it('does not repaint the foreground chat from a homonymous runtime owned by another profile', async () => {
    render(<Harness active />)
    await waitFor(() => expect(updateSessionState).not.toBeNull())

    act(() => {
      retainSessionSurfaceReference('profile-b', 'stored-b')
      bindSessionSurfaceRuntime('profile-b', 'stored-b', RUNTIME_ID)
      updateSessionState!(RUNTIME_ID, state => state, 'stored-b', 'profile-b')
    })

    emit('profile-a', 'message.start')
    emit('profile-a', 'message.complete', 'foreground answer')
    expect(
      setMessages.mock.calls.some(([messages]) =>
        (messages as { parts: unknown[] }[]).some(message => chatMessageText(message as never).includes('foreground answer'))
      )
    ).toBe(true)
    setMessages.mockClear()

    emit('profile-b', 'message.start')
    emit('profile-b', 'message.complete', 'private background answer')

    expect(
      setMessages.mock.calls.some(([messages]) =>
        (messages as { parts: unknown[] }[]).some(message => chatMessageText(message as never).includes('private background answer'))
      )
    ).toBe(false)
    releaseSessionSurfaceReference('profile-b', 'stored-b')
  })

  it('routes prompt events and terminal cleanup by event profile for equal runtime ids', async () => {
    render(<Harness />)
    await waitFor(() => expect(handleEvent).not.toBeNull())

    const promptEvents = (profile: string, suffix: string) => {
      act(() => {
        handleEvent!({
          payload: { choices: ['yes'], question: `question-${suffix}`, request_id: `clarify-${suffix}` },
          profile,
          session_id: RUNTIME_ID,
          type: 'clarify.request'
        })
        handleEvent!({
          payload: { command: `command-${suffix}`, description: suffix },
          profile,
          session_id: RUNTIME_ID,
          type: 'approval.request'
        })
        handleEvent!({
          payload: { request_id: `sudo-${suffix}` },
          profile,
          session_id: RUNTIME_ID,
          type: 'sudo.request'
        })
        handleEvent!({
          payload: { env_var: `KEY_${suffix}`, prompt: suffix, request_id: `secret-${suffix}` },
          profile,
          session_id: RUNTIME_ID,
          type: 'secret.request'
        })
      })
    }

    promptEvents('profile-a', 'a')
    promptEvents('profile-b', 'b')

    expect(sessionClarifyRequest(RUNTIME_ID, 'profile-a').get()?.question).toBe('question-a')
    expect(sessionClarifyRequest(RUNTIME_ID, 'profile-b').get()?.question).toBe('question-b')
    expect(sessionApprovalRequest(RUNTIME_ID, 'profile-a').get()?.command).toBe('command-a')
    expect(sessionApprovalRequest(RUNTIME_ID, 'profile-b').get()?.command).toBe('command-b')
    expect(sessionSudoRequest(RUNTIME_ID, 'profile-a').get()?.requestId).toBe('sudo-a')
    expect(sessionSudoRequest(RUNTIME_ID, 'profile-b').get()?.requestId).toBe('sudo-b')
    expect(sessionSecretRequest(RUNTIME_ID, 'profile-a').get()?.envVar).toBe('KEY_a')
    expect(sessionSecretRequest(RUNTIME_ID, 'profile-b').get()?.envVar).toBe('KEY_b')
    expect(sessionAwaitingInput(RUNTIME_ID, 'profile-a').get()).toBe(true)
    expect(sessionAwaitingInput(RUNTIME_ID, 'profile-b').get()).toBe(true)

    emit('profile-a', 'message.complete', 'done-a')

    expect(sessionAwaitingInput(RUNTIME_ID, 'profile-a').get()).toBe(false)
    expect(sessionClarifyRequest(RUNTIME_ID, 'profile-a').get()).toBeNull()
    expect(sessionAwaitingInput(RUNTIME_ID, 'profile-b').get()).toBe(true)
    expect(sessionClarifyRequest(RUNTIME_ID, 'profile-b').get()?.question).toBe('question-b')
  })
})
