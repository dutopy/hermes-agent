import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import type * as AssistantUi from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as HermesApi from '@/hermes'
import type * as GatewayStore from '@/store/gateway'
import { requestGatewayForProfile, setPrimaryGateway } from '@/store/gateway'
import { $mcpSetupRequests, setMcpSetupRequest } from '@/store/mcp-setup'

import { McpSetupTool } from './mcp-setup-tool'

const { notifyError, ownerRequest, setMcpServerEnabled } = vi.hoisted(() => ({
  notifyError: vi.fn(),
  ownerRequest: vi.fn().mockResolvedValue({}),
  setMcpServerEnabled: vi.fn().mockResolvedValue({ ok: true })
}))

vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<typeof GatewayStore>()),
  requestGatewayForProfile: ownerRequest
}))

vi.mock('@/store/notifications', () => ({ notifyError }))

vi.mock('@assistant-ui/react', async importOriginal => ({
  ...(await importOriginal<typeof AssistantUi>()),
  useAuiState: () => true
}))

vi.mock('@/app/chat/session-view', async () => {
  const { atom } = await import('nanostores')
  const $runtimeId = atom<string | null>('shared-runtime')

  return { useSessionView: () => ({ $runtimeId, kind: 'tile', profile: 'profile-b' }) }
})

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<typeof HermesApi>()),
  addMcpServer: vi.fn(),
  authMcpServer: vi.fn(),
  cancelMcpOAuthFlow: vi.fn(),
  getActionStatus: vi.fn(),
  getMcpCatalog: vi.fn(),
  getMcpOAuthFlow: vi.fn(),
  installMcpCatalogEntry: vi.fn(),
  removeMcpServer: vi.fn(),
  setMcpServerEnabled
}))

describe('MCP setup card profile ownership', () => {
  beforeEach(() => {
    ownerRequest.mockResolvedValue({})
    setMcpServerEnabled.mockResolvedValue({ ok: true })
    $mcpSetupRequests.set({})
    setPrimaryGateway({ request: ownerRequest } as never, 'profile-b')
    setMcpSetupRequest({
      action: 'enable',
      profile: 'profile-b',
      reason: 'needed',
      requestId: 'request-b',
      server: 'github',
      sessionId: 'shared-runtime'
    })
  })

  afterEach(() => {
    cleanup()
    $mcpSetupRequests.set({})
    setPrimaryGateway(null, 'profile-b')
    vi.clearAllMocks()
  })

  it('mutates and responds through the request owner profile', async () => {
    const props = {
      args: { action: 'enable', reason: 'needed', server: 'github' },
      argsText: '',
      result: undefined,
      status: { type: 'running' },
      toolCallId: 'tool-1',
      toolName: 'setup_mcp',
      type: 'tool-call'
    } as unknown as ToolCallMessagePartProps

    render(<McpSetupTool {...props} />)

    fireEvent.click(screen.getByRole('button', { name: /Enable/i }))

    await waitFor(() => expect(setMcpServerEnabled).toHaveBeenCalledWith('github', true, 'profile-b'))
    expect(requestGatewayForProfile).toHaveBeenCalledWith('profile-b', 'reload.mcp', {
      confirm: true,
      session_id: 'shared-runtime'
    })
    expect(requestGatewayForProfile).toHaveBeenCalledWith('profile-b', 'mcp.setup.respond', {
      request_id: 'request-b',
      result: JSON.stringify({ server: 'github', status: 'enabled' })
    })
  })

  it('redacts profiled setup failures from both toast and response outcome detail', async () => {
    const secret = '/home/alice/.config/hermes/token=super-secret'
    setMcpServerEnabled.mockRejectedValueOnce(new Error(secret))
    const props = {
      args: { action: 'enable', reason: 'needed', server: 'github' },
      argsText: '',
      result: undefined,
      status: { type: 'running' },
      toolCallId: 'tool-1',
      toolName: 'setup_mcp',
      type: 'tool-call'
    } as unknown as ToolCallMessagePartProps

    render(<McpSetupTool {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Enable/i }))

    await waitFor(() =>
      expect(requestGatewayForProfile).toHaveBeenCalledWith(
        'profile-b',
        'mcp.setup.respond',
        expect.objectContaining({ request_id: 'request-b' })
      )
    )

    const calls = JSON.stringify({ notifications: notifyError.mock.calls, requests: ownerRequest.mock.calls })
    expect(calls).not.toContain(secret)
    expect(calls).not.toContain('super-secret')
    const response = ownerRequest.mock.calls.find(([, method]) => method === 'mcp.setup.respond')?.[2] as {
      result?: string
    }
    expect(JSON.parse(response.result ?? '{}')).toMatchObject({ server: 'github', status: 'error' })
    expect(JSON.parse(response.result ?? '{}').detail).not.toContain('super-secret')
  })
})
