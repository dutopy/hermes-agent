import { beforeEach, describe, expect, it, vi } from 'vitest'

const { FakeGateway, gateways } = vi.hoisted(() => {
  const instances: Array<{
    connectionState: 'closed' | 'open'
    request: ReturnType<typeof vi.fn>
  }> = []

  class Gateway {
    connectionState: 'closed' | 'open' = 'closed'
    readonly request = vi.fn(async (_method: string): Promise<{ socket: number }> => ({
      socket: instances.indexOf(this)
    }))
    private stateListeners: Array<(state: 'closed' | 'open') => void> = []

    constructor() {
      instances.push(this)
    }

    async connect(): Promise<void> {
      this.connectionState = 'open'
      this.stateListeners.forEach(listener => listener('open'))
    }

    close(): void {
      this.connectionState = 'closed'
    }

    onEvent(): () => void {
      return () => undefined
    }

    onState(listener: (state: 'closed' | 'open') => void): () => void {
      this.stateListeners.push(listener)
      return () => undefined
    }
  }

  return { FakeGateway: Gateway, gateways: instances }
})

vi.mock('@/hermes', () => ({ HermesGateway: FakeGateway }))
vi.mock('@hermes/shared', () => ({
  resolveGatewayWsUrl: vi.fn(async () => 'ws://profile')
}))

import {
  $gateway,
  activeGateway,
  closeSecondaryGateways,
  ensureGatewayForProfile,
  pruneSecondaryGateways,
  requestGatewayForProfile,
  setPrimaryGateway,
  subscribeProfileGateways
} from './gateway'

describe('profile-bound gateway requests', () => {
  beforeEach(() => {
    closeSecondaryGateways()
    gateways.length = 0
    window.hermesDesktop = {
      getConnection: vi.fn(async profile => ({ mode: 'local', profile, wsUrl: 'ws://profile' }))
    } as never
  })

  it('keeps using the owner socket across a foreground switch without activating it', async () => {
    const primary = new FakeGateway()
    primary.connectionState = 'open'
    setPrimaryGateway(primary as never, 'default')
    await ensureGatewayForProfile('default')

    const first = await requestGatewayForProfile<{ socket: number }>('work', 'prompt.submit', { session_id: 'same' })
    const workGateway = gateways.at(-1)!

    expect(activeGateway()).toBe(primary)
    expect($gateway.get()).toBe(primary)
    expect(first.socket).toBe(gateways.indexOf(workGateway))

    await ensureGatewayForProfile('default')
    const second = await requestGatewayForProfile<{ socket: number }>('work', 'session.interrupt', {
      session_id: 'same'
    })

    expect(second.socket).toBe(gateways.indexOf(workGateway))
    expect(workGateway.request).toHaveBeenCalledTimes(2)
    expect(primary.request).not.toHaveBeenCalled()
    expect(activeGateway()).toBe(primary)
    expect($gateway.get()).toBe(primary)
  })

  it('notifies mounted profile consumers when pruning replaces their owner socket', async () => {
    const primary = new FakeGateway()
    primary.connectionState = 'open'
    setPrimaryGateway(primary as never, 'default')
    await requestGatewayForProfile('work', 'session.status', { session_id: 'same' })
    const firstWorkGateway = gateways.at(-1)!
    const listener = vi.fn()
    const unsubscribe = subscribeProfileGateways(listener)

    pruneSecondaryGateways(new Set())
    expect(firstWorkGateway.connectionState).toBe('closed')
    expect(listener).toHaveBeenCalled()

    await requestGatewayForProfile('work', 'session.status', { session_id: 'same' })
    expect(gateways.at(-1)).not.toBe(firstWorkGateway)
    expect(activeGateway()).toBe(primary)
    unsubscribe()
  })
})
