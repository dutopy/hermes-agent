import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registerAgentTerminalWriter } from '@/app/right-sidebar/terminal/agent-terminal-stream'
import { $terminals, closeAllTerminals, ensureAgentTerminal } from '@/app/right-sidebar/terminal/terminals'
import type { ClientSessionState } from '@/app/types'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $gateway, setPrimaryGateway } from '@/store/gateway'
import { $goalsBySession } from '@/store/goals'
import { $mcpSetupRequests, sessionMcpSetupRequest, setMcpSetupRequest } from '@/store/mcp-setup'
import { $notifications } from '@/store/notifications'
import { $messages, $sessions, setMessages, setSessions } from '@/store/session'
import { sessionRuntimeStateKey } from '@/store/session-states'
import { getToolDiff, recordToolDiff } from '@/store/tool-diffs'
import type { RpcEvent, SessionInfo } from '@/types/hermes'

import { useMessageStream } from './index'

const SID = 'shared-runtime'
const PROFILE = 'profile-b'
let handleEvent: ((event: RpcEvent) => void) | null = null
let states: Map<string, ClientSessionState>
let activeProfile = 'profile-a'

function Harness() {
  const activeSessionIdRef = useRef<string | null>(SID)
  const sessionStateByRuntimeIdRef = useRef(states)
  const queryClientRef = useRef(new QueryClient())

  const stream = useMessageStream({
    activeGatewayProfile: 'profile-a',
    activeSessionIdRef,
    hydrateFromStoredSession: vi.fn(async () => undefined),
    queryClient: queryClientRef.current,
    refreshHermesConfig: vi.fn(async () => undefined),
    refreshSessions: vi.fn(async () => undefined),
    sessionStateByRuntimeIdRef,
    updateSessionState: (sessionId, updater, _storedId, profile) => {
      const key = sessionRuntimeStateKey(profile, sessionId)
      const next = updater(sessionStateByRuntimeIdRef.current.get(key) ?? createClientSessionState())
      sessionStateByRuntimeIdRef.current.set(key, next)

      return next
    }
  })

  useEffect(() => {
    handleEvent = stream.handleGatewayEvent
  }, [stream.handleGatewayEvent])

  return null
}

const event = (type: RpcEvent['type'], payload: RpcEvent['payload']) =>
  act(() => handleEvent!({ payload, profile: PROFILE, session_id: SID, type }))

describe('profile-owned auxiliary gateway events', () => {
  const activeRequest = vi.fn().mockResolvedValue({})
  const ownerRequest = vi.fn().mockResolvedValue({})

  beforeEach(async () => {
    handleEvent = null
    states = new Map()
    activeRequest.mockClear()
    ownerRequest.mockClear()
    closeAllTerminals()
    setPrimaryGateway({ request: ownerRequest } as unknown as ReturnType<typeof $gateway.get>, PROFILE)
    $gateway.set({ request: activeRequest } as unknown as ReturnType<typeof $gateway.get>)
    render(<Harness />)
    await waitFor(() => expect(handleEvent).not.toBeNull())
  })

  afterEach(() => {
    cleanup()
    setPrimaryGateway(null, PROFILE)
    $gateway.set(null)
    setMessages([])
    setSessions([])
    $goalsBySession.set({})
    $mcpSetupRequests.set({})
    $notifications.set([])
    vi.restoreAllMocks()
  })

  it('retitles only the event profile when stored session ids collide', () => {
    setSessions([
      { id: 'same-stored', profile: 'profile-a', title: 'Profile A' } as SessionInfo,
      { id: 'same-stored', profile: PROFILE, title: 'Profile B' } as SessionInfo
    ])

    event('session.title', { session_id: 'same-stored', title: 'Renamed B' })

    expect($sessions.get().map(session => [session.profile, session.title])).toEqual([
      ['profile-a', 'Profile A'],
      [PROFILE, 'Renamed B']
    ])
  })

  it('records inline tool diffs under the event profile and runtime', () => {
    const toolCallId = 'colliding-event-tool'

    recordToolDiff(toolCallId, 'profile A', { profile: 'profile-a', runtimeId: SID })
    event('tool.complete', { inline_diff: 'profile B', name: 'patch', tool_id: toolCallId })

    expect(getToolDiff(toolCallId, { profile: 'profile-a', runtimeId: SID })).toBe('profile A')
    expect(getToolDiff(toolCallId, { profile: PROFILE, runtimeId: SID })).toBe('profile B')
  })

  it('routes colliding profile output through the stream and closes only the event owner mirror', () => {
    const writeA = vi.fn()
    const writeB = vi.fn()
    registerAgentTerminalWriter('profile-a', 'same-proc', writeA)
    registerAgentTerminalWriter(PROFILE, 'same-proc', writeB)
    const idA = ensureAgentTerminal('profile-a', 'same-proc', 'A task')!
    const idB = ensureAgentTerminal(PROFILE, 'same-proc', 'B task')!

    event('agent.terminal.output', { chunk: 'B output', process_id: 'same-proc' })
    event('terminal.close', { process_id: 'same-proc' })

    expect(writeA).not.toHaveBeenCalled()
    expect(writeB).toHaveBeenCalledExactlyOnceWith('B output')
    expect($terminals.get().some(term => term.id === idA)).toBe(true)
    expect($terminals.get().some(term => term.id === idB)).toBe(false)
  })

  it('redacts a profiled background error everywhere except logs', () => {
    const rawDetail = 'token=super-secret at /home/profile-b/private.py'
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    event('error', { message: rawDetail })

    const renderedError = states
      .get(sessionRuntimeStateKey(PROFILE, SID))
      ?.messages.find(message => message.role === 'assistant')?.error

    const publishedText = $notifications
      .get()
      .map(notification => `${notification.message} ${notification.detail ?? ''}`)
      .join(' ')

    expect(renderedError).toBe('Hermes reported an error')
    expect(publishedText).toContain('Hermes reported an error')
    expect(publishedText).not.toContain('super-secret')
    expect(publishedText).not.toContain('/home/profile-b/private.py')
    expect(errorLog).toHaveBeenCalledWith(
      '[gateway] Profiled session error',
      expect.objectContaining({ error: rawDetail, profile: PROFILE, sessionId: SID })
    )
  })

  it('does not mutate foreground messages when a colliding background profile reacts', () => {
    const foreground = [
      { id: 'a', parts: [{ type: 'text' as const, text: 'A' }], role: 'assistant' as const, rowId: 7 }
    ]
    const background = [
      { id: 'b', parts: [{ type: 'text' as const, text: 'B' }], role: 'assistant' as const, rowId: 7 }
    ]
    setMessages(foreground)
    states.set(sessionRuntimeStateKey(PROFILE, SID), { ...createClientSessionState(), messages: background })

    event('message.reaction', { reactions: ['👍'], role: 'assistant', row_id: 7 })

    expect($messages.get()).toEqual(foreground)
    expect(states.get(sessionRuntimeStateKey(PROFILE, SID))?.messages[0]?.reactions).toEqual(['👍'])
  })

  it.each([
    ['terminal.read.request', 'terminal.read.respond'],
    ['preview.read.request', 'preview.read.respond'],
    ['window.read.request', 'window.read.respond']
  ] as const)('answers %s on the event owner socket', async (type, responseMethod) => {
    event(type, { request_id: `request-${type}` })

    await waitFor(() => expect(ownerRequest).toHaveBeenCalledWith(responseMethod, expect.any(Object)))
    expect(activeRequest).not.toHaveBeenCalled()
  })

  it('attributes goal status updates to the authoritative event profile', () => {
    event('status.update', { kind: 'goal', text: '⊙ Goal set: profile B goal' })

    expect($goalsBySession.get()[sessionRuntimeStateKey(PROFILE, SID)]?.title).toBe('profile B goal')
    expect($goalsBySession.get()[SID]).toBeUndefined()
  })

  it('parks MCP setup under the event profile without overwriting a colliding runtime', () => {
    setMcpSetupRequest({
      action: 'install',
      profile: 'profile-a',
      reason: 'A',
      requestId: 'request-a',
      server: 'server-a',
      sessionId: SID
    })

    event('mcp.setup.request', {
      action: 'install',
      reason: 'B',
      request_id: 'request-b',
      server: 'server-b'
    })

    expect(sessionMcpSetupRequest(SID, 'profile-a').get()?.requestId).toBe('request-a')
    expect(sessionMcpSetupRequest(SID, PROFILE).get()).toMatchObject({
      profile: PROFILE,
      reason: 'B',
      requestId: 'request-b',
      server: 'server-b',
      sessionId: SID
    })
  })
})
