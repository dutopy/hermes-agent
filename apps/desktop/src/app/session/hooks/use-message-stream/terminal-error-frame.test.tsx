import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import { chatMessageText } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $notifications, clearNotifications } from '@/store/notifications'
import type { RpcEvent } from '@/types/hermes'

import { useMessageStream } from './index'

const SID = 'session-1'

let handleEvent: ((event: RpcEvent) => void) | null = null
let sessionStates: Map<string, ClientSessionState>

function Harness() {
  const activeSessionIdRef = useRef<string | null>(SID)
  const sessionStateByRuntimeIdRef = useRef(new Map<string, ClientSessionState>())
  const queryClientRef = useRef(new QueryClient())

  const stream = useMessageStream({
    activeSessionIdRef,
    hydrateFromStoredSession: vi.fn(async () => undefined),
    queryClient: queryClientRef.current,
    refreshHermesConfig: vi.fn(async () => undefined),
    refreshSessions: vi.fn(async () => undefined),
    sessionStateByRuntimeIdRef,
    updateSessionState: (sessionId, updater, _storedSessionId, profile) => {
      const key = profile ? `${profile}\u0000${sessionId}` : sessionId
      const current = sessionStateByRuntimeIdRef.current.get(key) ?? createClientSessionState()
      const next = updater(current)
      sessionStateByRuntimeIdRef.current.set(key, next)
      sessionStates.set(key, next)

      return next
    }
  })

  useEffect(() => {
    handleEvent = stream.handleGatewayEvent
  }, [stream.handleGatewayEvent])

  return null
}

async function mountStream() {
  sessionStates = new Map()
  render(<Harness />)
  await waitFor(() => expect(handleEvent).not.toBeNull())
}

const start = () => act(() => handleEvent!({ payload: {}, session_id: SID, type: 'message.start' }))
const delta = (text: string) => act(() => handleEvent!({ payload: { text }, session_id: SID, type: 'message.delta' }))

const completeWithError = (payload: Record<string, unknown>) =>
  act(() => handleEvent!({ payload: { status: 'error', ...payload }, session_id: SID, type: 'message.complete' }))

const completeProfiledWithError = (profile: string, payload: Record<string, unknown>) =>
  act(() => handleEvent!({ payload: { status: 'error', ...payload }, profile, session_id: SID, type: 'message.complete' }))

function getState(): ClientSessionState {
  return sessionStates.get(SID) ?? createClientSessionState()
}

function lastAssistant() {
  return [...getState().messages].reverse().find(m => m.role === 'assistant' && !m.hidden)
}

describe('terminal error message.complete frames', () => {
  beforeEach(() => {
    handleEvent = null
    clearNotifications()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('marks the bubble failed from the structured error field, not the text heuristic', async () => {
    await mountStream()
    await start()
    await delta('…')

    // "Error: <detail>" does not match the legacy completionErrorText regexes.
    await completeWithError({ text: 'Error: invalid model slug', error: 'invalid model slug', recoverable: true })

    const bubble = lastAssistant()
    expect(bubble?.error).toBe('invalid model slug')
    expect(getState().busy).toBe(false)
    expect(getState().awaitingResponse).toBe(false)
  })

  it('keeps streamed partial text visible on a partial failure', async () => {
    await mountStream()
    await start()
    await delta('half an ans')

    await completeWithError({
      text: 'half an ans',
      error: 'connection reset mid-stream',
      partial: true,
      recoverable: true
    })

    const bubble = lastAssistant()
    expect(bubble?.error).toBe('connection reset mid-stream')
    expect(chatMessageText(bubble!)).toBe('half an ans')
    expect(bubble?.pending).toBe(false)
  })

  it('falls back to the frame text when no error field is present', async () => {
    await mountStream()
    await start()
    await delta('…')

    await completeWithError({ text: 'Error: something broke' })

    const bubble = lastAssistant()
    expect(bubble?.error).toBe('Error: something broke')
  })

  it('redacts profiled structured errors before transcript and keeps disk-full toast generic', async () => {
    const profile = 'profile-b'
    const secret = 'ENOSPC writing /home/alice/private/state.db token=super-secret'
    await mountStream()

    await completeProfiledWithError(profile, { error: secret, text: 'partial safe text' })

    const state = sessionStates.get(`${profile}\u0000${SID}`)
    const bubble = [...(state?.messages ?? [])].reverse().find(message => message.role === 'assistant' && !message.hidden)
    const presented = JSON.stringify({ bubble, notifications: $notifications.get() })
    expect(bubble?.error).toBe('Hermes reported an error')
    expect(presented).not.toContain('/home/alice')
    expect(presented).not.toContain('super-secret')
    expect($notifications.get().some(notification => /disk full/i.test(`${notification.title} ${notification.message}`))).toBe(
      true
    )
  })
})
