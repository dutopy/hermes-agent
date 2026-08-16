import { afterEach, describe, expect, it, vi } from 'vitest'

import { readStoredSessionMessages } from './index'

describe('readStoredSessionMessages', () => {
  afterEach(() => {
    delete (window as { hermesDesktop?: unknown }).hermesDesktop
  })

  it('reads the complete durable transcript with an explicit owner profile', async () => {
    const api = vi.fn(async () => ({ messages: [], session_id: 'stored-1' }))

    ;(window as { hermesDesktop?: unknown }).hermesDesktop = { api }

    await expect(readStoredSessionMessages('work', 'stored-1')).resolves.toEqual({
      messages: [],
      session_id: 'stored-1'
    })
    expect(api).toHaveBeenCalledWith({
      path: '/api/sessions/stored-1/messages?profile=work&limit=500&offset=0&order=oldest',
      profile: 'work'
    })
  })

  it.each([
    [' ', 'stored-1'],
    ['work', '\n'],
    ['work\u0000other', 'stored-1']
  ])('rejects invalid identity before REST access', async (profile, storedSessionId) => {
    const api = vi.fn()

    ;(window as { hermesDesktop?: unknown }).hermesDesktop = { api }

    await expect(readStoredSessionMessages(profile, storedSessionId)).rejects.toThrow('Invalid stored session identity')
    expect(api).not.toHaveBeenCalled()
  })
})
