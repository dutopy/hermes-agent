import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $gateway, requestGatewayForProfile } from '@/store/gateway'
import { notifyError, notifyPromptResponseError } from '@/store/notifications'
import {
  $secretRequest,
  $sudoRequest,
  clearAllPrompts,
  sessionSecretRequest,
  setSecretRequest,
  setSudoRequest
} from '@/store/prompts'
import { $activeSessionId } from '@/store/session'

import { PromptOverlays } from './prompt-overlays'

vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))
vi.mock('@/store/notifications', () => ({ notifyError: vi.fn(), notifyPromptResponseError: vi.fn() }))
vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestGatewayForProfile: vi.fn()
}))

function renderPrompts(sessionId: string | null = 's1', profile?: string) {
  render(
    <I18nProvider configClient={null}>
      <PromptOverlays profile={profile} sessionId={sessionId} />
    </I18nProvider>
  )
}

afterEach(() => {
  cleanup()
  clearAllPrompts()
  $activeSessionId.set(null)
  $gateway.set(null)
  vi.clearAllMocks()
})

describe('PromptOverlays', () => {
  it('dismisses a stale sudo dialog when the gateway no longer has the password request', async () => {
    const request = vi.fn().mockRejectedValue(new Error('no pending password request'))

    $activeSessionId.set('s1')
    $gateway.set({ request } as never)
    setSudoRequest({ requestId: 'sudo-1', sessionId: 's1' })

    renderPrompts()

    expect(screen.getByText('Administrator password')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect($sudoRequest.get()).toBeNull())
    expect(request).toHaveBeenCalledWith('sudo.respond', { password: '', request_id: 'sudo-1' })
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('dismisses a stale secret dialog when the gateway no longer has the value request', async () => {
    const request = vi.fn().mockRejectedValue(new Error('no pending value request'))

    $activeSessionId.set('s1')
    $gateway.set({ request } as never)
    setSecretRequest({ envVar: 'TEST_SECRET', prompt: 'Paste a secret', requestId: 'secret-1', sessionId: 's1' })

    renderPrompts()

    expect(screen.getByText('TEST_SECRET')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect($secretRequest.get()).toBeNull())
    expect(request).toHaveBeenCalledWith('secret.respond', { request_id: 'secret-1', value: '' })
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('renders, responds, and clears only the owning profile when runtime ids collide', async () => {
    const runtimeId = 'shared-runtime'
    vi.mocked(requestGatewayForProfile).mockResolvedValue({ status: 'ok' })
    setSecretRequest({
      envVar: 'PROFILE_A_KEY',
      profile: 'profile-a',
      prompt: 'Profile A secret',
      requestId: 'secret-a',
      sessionId: runtimeId
    })
    setSecretRequest({
      envVar: 'PROFILE_B_KEY',
      profile: 'profile-b',
      prompt: 'Profile B secret',
      requestId: 'secret-b',
      sessionId: runtimeId
    })

    renderPrompts(runtimeId, 'profile-b')

    expect(screen.queryByText('PROFILE_A_KEY')).toBeNull()
    expect(screen.getByText('PROFILE_B_KEY')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('PROFILE_B_KEY'), { target: { value: 'value-b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(requestGatewayForProfile).toHaveBeenCalledWith('profile-b', 'secret.respond', {
        request_id: 'secret-b',
        value: 'value-b'
      })
    )
    expect(sessionSecretRequest(runtimeId, 'profile-b').get()).toBeNull()
    expect(sessionSecretRequest(runtimeId, 'profile-a').get()?.requestId).toBe('secret-a')
  })

  it.each(['sudo', 'secret'] as const)('redacts %s response failures only for the request owner profile', async kind => {
    vi.mocked(requestGatewayForProfile).mockRejectedValue(new Error('/srv/private/state.db token=secret'))

    if (kind === 'sudo') {
      setSudoRequest({ profile: 'work', requestId: 'sudo-work', sessionId: 'shared' })
    } else {
      setSecretRequest({ envVar: 'KEY', profile: 'work', prompt: 'Secret', requestId: 'secret-work', sessionId: 'shared' })
    }

    renderPrompts('shared', 'work')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(notifyPromptResponseError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('/srv/private') }),
        expect.any(String),
        'work'
      )
    )
  })
})
