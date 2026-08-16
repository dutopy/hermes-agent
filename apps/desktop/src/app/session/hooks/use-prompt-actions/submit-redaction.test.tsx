import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Translations } from '@/i18n'
import { createClientSessionState } from '@/lib/chat-runtime'
import type { ComposerAttachment } from '@/store/composer'
import { $notifications, clearNotifications } from '@/store/notifications'
import { $sessions, setSessions } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import { useSubmitPrompt } from './submit'

const RUNTIME_ID = 'runtime-embedded'
const STORED_ID = 'stored-embedded'
const SAFE_COPY = 'Could not send message. Please try again.'

function session(profile: string, preview: string): SessionInfo {
  return {
    archived: false,
    cwd: null,
    ended_at: null,
    id: STORED_ID,
    input_tokens: 0,
    is_active: false,
    last_active: 1,
    message_count: 0,
    model: null,
    output_tokens: 0,
    preview,
    profile,
    source: null,
    started_at: 1,
    title: null,
    tool_call_count: 0
  }
}

function renderSubmit(options: { embedded: boolean; failAt: 'attachment' | 'none' | 'prompt' }) {
  let state = createClientSessionState()

  const requestGateway = vi.fn(async (method: string) => {
    if (options.failAt === 'prompt' && method === 'prompt.submit') {
      throw new Error('token=sk-backend-secret path=/srv/hermes/private/session.db')
    }

    return {} as never
  })

  const syncAttachmentsForSubmit = vi.fn(
    async (_sessionId: string, attachments: ComposerAttachment[]) => {
      if (options.failAt === 'attachment') {
        throw new Error('token=sk-backend-secret path=/srv/hermes/private/attachment.bin')
      }

      return { attachments, sessionId: RUNTIME_ID }
    }
  )

  const scope = options.embedded
    ? ({
        profile: 'work',
        clearAttachments: vi.fn(),
        readAttachments: () => [],
        setAwaitingResponse: vi.fn(),
        setBusy: vi.fn(),
        setMessages: vi.fn()
      } as never)
    : undefined

  const hook = renderHook(() =>
    useSubmitPrompt({
      activeSessionIdRef: { current: RUNTIME_ID },
      busyRef: { current: false },
      copy: { promptFailed: 'Legacy prompt failed' } as Translations['desktop'],
      createBackendSessionForSend: async () => RUNTIME_ID,
      getRoutedStoredSessionId: () => null,
      getRuntimeIdForStoredSession: () => RUNTIME_ID,
      getRouteToken: () => 'route',
      requestGateway,
      resumeStoredSession: () => undefined,
      selectedStoredSessionIdRef: { current: STORED_ID },
      syncAttachmentsForSubmit,
      updateSessionState: (_sessionId, updater) => {
        state = updater(state)

        return state
      },
      scope
    })
  )

  return { hook, readState: () => state }
}

afterEach(() => {
  cleanup()
  clearNotifications()
  setSessions([])
  vi.restoreAllMocks()
})

describe('useSubmitPrompt owned optimistic activity', () => {
  it("stamps B's preview and timestamp without leaking its first send into A's colliding row", async () => {
    const profileA = session('profile-a', 'A secret')
    const profileB = session('work', 'B old')
    setSessions([profileA, profileB])
    const { hook } = renderSubmit({ embedded: true, failAt: 'none' })

    await act(async () => {
      expect(await hook.result.current('B secret')).toBe(true)
    })

    expect($sessions.get()[0]).toBe(profileA)
    expect($sessions.get()[0]).toEqual(expect.objectContaining({ last_active: 1, preview: 'A secret' }))
    expect($sessions.get()[1]).toEqual(expect.objectContaining({ preview: 'B secret', profile: 'work' }))
    expect($sessions.get()[1]?.last_active).toBeGreaterThan(1)
  })
})

describe('useSubmitPrompt embedded error redaction', () => {
  it.each([
    { failAt: 'prompt' as const, attachments: undefined },
    {
      failAt: 'attachment' as const,
      attachments: [
        {
          id: 'file:secret.txt',
          kind: 'file' as const,
          label: 'secret.txt',
          path: '/home/backend/private/secret.txt',
          refText: '@file:/home/backend/private/secret.txt'
        }
      ]
    }
  ])('hides raw $failAt RPC errors from the transcript and notification', async ({ failAt, attachments }) => {
    const { hook, readState } = renderSubmit({ embedded: true, failAt })

    await act(async () => {
      expect(await hook.result.current('embedded send', { attachments })).toBe(false)
    })

    const transcript = JSON.stringify(readState().messages)
    const notifications = JSON.stringify($notifications.get())

    expect(transcript).toContain(SAFE_COPY)
    expect(notifications).toContain(SAFE_COPY)
    expect(transcript).not.toContain('sk-backend-secret')
    expect(transcript).not.toContain('/srv/hermes/private')
    expect(notifications).not.toContain('sk-backend-secret')
    expect(notifications).not.toContain('/srv/hermes/private')
  })

  it('preserves raw error detail for the primary legacy scope', async () => {
    const { hook, readState } = renderSubmit({ embedded: false, failAt: 'prompt' })

    await act(async () => {
      expect(await hook.result.current('legacy send')).toBe(false)
    })

    expect(JSON.stringify(readState().messages)).toContain('/srv/hermes/private/session.db')
    expect(JSON.stringify($notifications.get())).toContain('/srv/hermes/private/session.db')
  })
})
