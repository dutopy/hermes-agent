import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $gateway, requestGatewayForProfile, setPrimaryGateway } from './gateway'
import {
  $mcpSetupRequests,
  clearMcpSetupRequest,
  hasMcpSetupRequest,
  sessionMcpSetupRequest,
  setMcpSetupRequest,
  skipMcpSetupRequest
} from './mcp-setup'
import { $notifications, clearNotifications } from './notifications'

const runtimeId = 'shared-runtime'

vi.mock('./gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestGatewayForProfile: vi.fn()
}))

const request = (profile: string, requestId: string) => ({
  action: 'install' as const,
  profile,
  reason: `reason-${profile}`,
  requestId,
  server: `server-${profile}`,
  sessionId: runtimeId
})

describe('profile-owned MCP setup requests', () => {
  const activeRequest = vi.fn().mockResolvedValue({})
  const ownerRequest = vi.fn().mockResolvedValue({})

  beforeEach(() => {
    $mcpSetupRequests.set({})
    clearNotifications()
    $gateway.set({ request: activeRequest } as never)
    setPrimaryGateway({ request: ownerRequest } as never, 'profile-b')
    vi.mocked(requestGatewayForProfile).mockResolvedValue({})
  })

  afterEach(() => {
    $mcpSetupRequests.set({})
    $gateway.set(null)
    setPrimaryGateway(null, 'profile-b')
    vi.clearAllMocks()
  })

  it('keeps colliding runtime requests isolated by profile', () => {
    const profileA = request('profile-a', 'request-a')
    const profileB = request('profile-b', 'request-b')

    setMcpSetupRequest(profileA)
    setMcpSetupRequest(profileB)

    expect(sessionMcpSetupRequest(runtimeId, 'profile-a').get()).toEqual(profileA)
    expect(sessionMcpSetupRequest(runtimeId, 'profile-b').get()).toEqual(profileB)
    expect(hasMcpSetupRequest(runtimeId, 'profile-a')).toBe(true)
    expect(hasMcpSetupRequest(runtimeId, 'profile-b')).toBe(true)

    clearMcpSetupRequest(profileB.requestId, runtimeId, 'profile-b')

    expect(sessionMcpSetupRequest(runtimeId, 'profile-a').get()).toEqual(profileA)
    expect(sessionMcpSetupRequest(runtimeId, 'profile-b').get()).toBeNull()
  })

  it('declines through the request owner gateway even when another profile is active', async () => {
    setMcpSetupRequest(request('profile-b', 'request-b'))

    await expect(skipMcpSetupRequest(runtimeId, 'profile-b')).resolves.toBe(true)

    expect(requestGatewayForProfile).toHaveBeenCalledWith('profile-b', 'mcp.setup.respond', {
      request_id: 'request-b',
      result: JSON.stringify({ server: 'server-profile-b', status: 'declined' })
    })
    expect(activeRequest).not.toHaveBeenCalled()
    expect(ownerRequest).not.toHaveBeenCalled()
    expect(sessionMcpSetupRequest(runtimeId, 'profile-b').get()).toBeNull()
  })

  it('keeps a typed-message skip retryable when the owner reconnect request fails', async () => {
    const secret = '/home/alice/private/state.db token=super-secret'
    vi.mocked(requestGatewayForProfile).mockRejectedValueOnce(new Error(secret))
    setMcpSetupRequest(request('profile-b', 'request-b'))

    await expect(skipMcpSetupRequest(runtimeId, 'profile-b')).resolves.toBe(true)

    expect(sessionMcpSetupRequest(runtimeId, 'profile-b').get()?.requestId).toBe('request-b')
    expect(JSON.stringify($notifications.get())).not.toContain(secret)
    expect($notifications.get()[0]).toMatchObject({
      kind: 'error',
      message: 'Could not send MCP setup response',
      title: 'Could not send MCP setup response'
    })
    expect(activeRequest).not.toHaveBeenCalled()
    expect(ownerRequest).not.toHaveBeenCalled()
  })

  it('preserves the unqualified legacy key and active gateway fallback', async () => {
    const legacy = { ...request('', 'legacy-request'), profile: undefined }
    setMcpSetupRequest(legacy)

    expect(sessionMcpSetupRequest(runtimeId).get()).toEqual(legacy)
    await skipMcpSetupRequest(runtimeId)

    expect(activeRequest).toHaveBeenCalledOnce()
  })
})
