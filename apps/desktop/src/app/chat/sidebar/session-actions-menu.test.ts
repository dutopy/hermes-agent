import { atom } from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $activeGatewayProfile } from '@/store/profile'
import { $activeSessionId, $selectedStoredSessionId, $sessions, setSessions } from '@/store/session'

import { renameSessionOptimistically, renameSessionPreferringRpc } from './session-actions-menu'

// The branched-session rename bug: a freshly branched session lives only in the
// gateway's runtime _sessions map (no state.db row yet), so REST PATCH
// /api/sessions/{id} 404s with "Session not found". renameSessionPreferringRpc
// must route the ACTIVE row through the session.title RPC (runtime id), which
// persists the row on demand, and otherwise fall back to REST.

// Hoisted so the vi.mock factories below (which vitest lifts to the top of the
// module) can reference these before the module body runs. This matters because
// projects.ts subscribes to $gateway at import and nanostores fires the
// subscriber synchronously — that reaches the @/store/gateway mock's
// activeGateway() during the transitive import on line 4, before a plain
// module-level const would be initialized (temporal dead zone).
const { renameSession, request, activeGateway } = vi.hoisted(() => ({
  renameSession: vi.fn(async () => ({ ok: true, title: 'rest-title' })),
  request: vi.fn(async () => ({ title: 'rpc-title' }) as never),
  activeGateway: vi.fn<() => { request: unknown } | null>(() => ({ request: undefined }))
}))

// Wire activeGateway's default return to the shared request mock now that it exists.
activeGateway.mockReturnValue({ request })

vi.mock('@/hermes', () => ({
  renameSession: (...args: unknown[]) => renameSession(...(args as [])),
  // profile.ts calls this at import (its $activeGatewayProfile subscribe fires
  // immediately), pulled in transitively via session-states.
  setApiRequestProfile: () => {},
  HermesGateway: class {}
}))

vi.mock('@/store/gateway', () => ({
  // projects.ts subscribes to $gateway at module load (its repo-scan sync fires
  // immediately), pulled in transitively via the session store. Provide a real
  // atom plus the hoisted activeGateway so the synchronous subscriber doesn't
  // throw on an incomplete mock or hit an uninitialized reference.
  $gateway: atom(null),
  activeGateway: () => activeGateway()
}))

const RUNTIME_ID = 'rt-runtime-1'
const STORED_ID = 'stored-branch-1'

afterEach(() => {
  renameSession.mockClear()
  request.mockClear()
  activeGateway.mockReset()
  activeGateway.mockReturnValue({ request })
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  $activeGatewayProfile.set('default')
  setSessions([])
})

describe('renameSessionPreferringRpc', () => {
  it('renames the active branched session via the session.title RPC, not REST', async () => {
    $selectedStoredSessionId.set(STORED_ID)
    $activeSessionId.set(RUNTIME_ID)

    const result = await renameSessionPreferringRpc(STORED_ID, 'My branch')

    expect(request).toHaveBeenCalledWith('session.title', { session_id: RUNTIME_ID, title: 'My branch' })
    expect(renameSession).not.toHaveBeenCalled()
    expect(result.title).toBe('rpc-title')
  })

  it('falls back to unprofiled REST when the legacy primary RPC fails (e.g. socket mid-reconnect)', async () => {
    $selectedStoredSessionId.set(STORED_ID)
    $activeSessionId.set(RUNTIME_ID)
    request.mockRejectedValueOnce(new Error('not connected'))

    const result = await renameSessionPreferringRpc(STORED_ID, 'My branch')

    expect(request).toHaveBeenCalledOnce()
    expect(renameSession).toHaveBeenCalledWith(STORED_ID, 'My branch', undefined)
    expect(result.title).toBe('rest-title')
  })

  it('uses REST for a non-active row (background/persisted session)', async () => {
    $selectedStoredSessionId.set('some-other-active-session')
    $activeSessionId.set(RUNTIME_ID)

    await renameSessionPreferringRpc(STORED_ID, 'My branch', 'work')

    expect(request).not.toHaveBeenCalled()
    expect(renameSession).toHaveBeenCalledWith(STORED_ID, 'My branch', 'work')
  })

  it('does not send an explicit profile rename to the colliding foreground runtime even when that RPC would succeed', async () => {
    $activeGatewayProfile.set('profile-a')
    $selectedStoredSessionId.set('same')
    $activeSessionId.set('runtime-a')

    const result = await renameSessionPreferringRpc('same', 'Profile B renamed', 'profile-b')

    expect(request).not.toHaveBeenCalled()
    expect(renameSession).toHaveBeenCalledWith('same', 'Profile B renamed', 'profile-b')
    expect(result.title).toBe('rest-title')
  })

  it('keeps explicit default isolated from the unprofiled legacy RPC path', async () => {
    $activeGatewayProfile.set('default')
    $selectedStoredSessionId.set(STORED_ID)
    $activeSessionId.set(RUNTIME_ID)

    await renameSessionPreferringRpc(STORED_ID, 'Explicit default', 'default')

    expect(request).not.toHaveBeenCalled()
    expect(renameSession).toHaveBeenCalledWith(STORED_ID, 'Explicit default', 'default')
  })

  it('uses REST when clearing the title (RPC rejects empty titles)', async () => {
    $selectedStoredSessionId.set(STORED_ID)
    $activeSessionId.set(RUNTIME_ID)

    await renameSessionPreferringRpc(STORED_ID, '')

    expect(request).not.toHaveBeenCalled()
    expect(renameSession).toHaveBeenCalledWith(STORED_ID, '', undefined)
  })

  it('uses REST when no gateway is connected', async () => {
    $selectedStoredSessionId.set(STORED_ID)
    $activeSessionId.set(RUNTIME_ID)
    activeGateway.mockReturnValue(null)

    await renameSessionPreferringRpc(STORED_ID, 'My branch')

    expect(request).not.toHaveBeenCalled()
    expect(renameSession).toHaveBeenCalledWith(STORED_ID, 'My branch', undefined)
  })
})

describe('renameSessionOptimistically', () => {
  const collidingRows = () =>
    [
      { id: 'same', profile: 'profile-a', title: 'Profile A' },
      { id: 'same', profile: 'profile-b', title: 'Profile B' }
    ] as never

  it('optimistically updates only the explicitly owned row while the durable rename is pending', async () => {
    let resolveRename!: (value: { ok: boolean; title: string }) => void
    renameSession.mockImplementationOnce(
      () => new Promise(resolve => (resolveRename = resolve)) as ReturnType<typeof renameSession>
    )
    $activeGatewayProfile.set('profile-a')
    $selectedStoredSessionId.set('same')
    $activeSessionId.set('runtime-a')
    setSessions(collidingRows())

    const pending = renameSessionOptimistically('same', 'Profile B pending', 'profile-b')

    expect($sessions.get().map(row => [row.profile, row.title])).toEqual([
      ['profile-a', 'Profile A'],
      ['profile-b', 'Profile B pending']
    ])
    expect(request).not.toHaveBeenCalled()
    resolveRename({ ok: true, title: 'Profile B durable' })
    await pending

    expect($sessions.get().map(row => [row.profile, row.title])).toEqual([
      ['profile-a', 'Profile A'],
      ['profile-b', 'Profile B durable']
    ])
  })

  it('rolls back only the explicitly owned row when the durable rename fails', async () => {
    renameSession.mockRejectedValueOnce(new Error('profile-b backend unavailable'))
    $activeGatewayProfile.set('profile-a')
    $selectedStoredSessionId.set('same')
    $activeSessionId.set('runtime-a')
    setSessions(collidingRows())

    await expect(renameSessionOptimistically('same', 'Profile B pending', 'profile-b')).rejects.toThrow(
      'profile-b backend unavailable'
    )

    expect(request).not.toHaveBeenCalled()
    expect($sessions.get().map(row => [row.profile, row.title])).toEqual([
      ['profile-a', 'Profile A'],
      ['profile-b', 'Profile B']
    ])
  })
})
