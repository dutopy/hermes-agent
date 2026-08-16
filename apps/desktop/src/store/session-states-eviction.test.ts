import { beforeEach, describe, expect, it } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { $activeGatewayProfile } from '@/store/profile'
import { $activeSessionId, $selectedStoredSessionId, $sessions, $unreadFinishedSessionIds } from '@/store/session'
import {
  $sessionStates,
  $sessionSurfaceProfiles,
  $sessionTiles,
  bindSessionSurfaceRuntime,
  closeSessionTile,
  discardSessionTile,
  publishSessionState,
  releaseSessionSurfaceReference,
  retainSessionSurfaceReference,
  sessionSurfaceReferenceCount
} from '@/store/session-states'

/**
 * The closed-tile leak: gateway events keep publishing for sessions whose
 * surface is gone, and every parked transcript taxes every later publish (map
 * spread + the status projections run per entry per message delta). A settled
 * state nothing references must leave the map; everything a surface still
 * needs must stay.
 */

const state = (storedId: string, patch: Partial<ReturnType<typeof createClientSessionState>> = {}) => ({
  ...createClientSessionState(storedId),
  messages: [{ id: `${storedId}-m`, role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'hi' }] }],
  ...patch
})

beforeEach(() => {
  $sessionStates.set({})
  $sessionTiles.set([])
  $sessions.set([])
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  $unreadFinishedSessionIds.set([])
  $activeGatewayProfile.set('default')
})

describe('publish-time eviction', () => {
  it('evicts a settling session no surface references, keeping its unread dot', () => {
    publishSessionState('rt-1', state('stored-1', { busy: true }))
    expect($sessionStates.get()['rt-1']).toBeDefined()

    publishSessionState('rt-1', state('stored-1', { busy: false }))

    expect($sessionStates.get()['rt-1']).toBeUndefined()
    // The settle transition still fired: the sidebar's unread marker landed.
    expect($unreadFinishedSessionIds.get()).toContain('stored-1')
  })

  it('keeps a busy session with no surface — its background turn feeds the sidebar dot', () => {
    publishSessionState('rt-1', state('stored-1', { busy: true }))
    publishSessionState('rt-1', state('stored-1', { busy: true, awaitingResponse: true }))

    expect($sessionStates.get()['rt-1']).toBeDefined()
  })

  it('keeps a needsInput session with no surface — the attention dot reads it', () => {
    publishSessionState('rt-1', state('stored-1', { busy: true }))
    publishSessionState('rt-1', state('stored-1', { busy: false, needsInput: true }))

    expect($sessionStates.get()['rt-1']).toBeDefined()
  })

  it('keeps a settled session an open tile references, by runtime or stored id', () => {
    $sessionTiles.set([{ profile: 'default', runtimeId: 'rt-1', storedSessionId: 'stored-1' }])
    publishSessionState('rt-1', state('stored-1', { busy: true }))
    publishSessionState('rt-1', state('stored-1', { busy: false }))
    expect($sessionStates.get()['rt-1']).toBeDefined()

    // Mid-resume a tile holds only the stored id (runtime binding not patched
    // in yet) — that reference must count too.
    $sessionTiles.set([{ profile: 'default', storedSessionId: 'stored-2' }])
    publishSessionState('rt-2', state('stored-2', { busy: true }))
    publishSessionState('rt-2', state('stored-2', { busy: false }))
    expect($sessionStates.get()['rt-2']).toBeDefined()
  })

  it("keeps the primary view's settled session", () => {
    $activeSessionId.set('rt-1')
    publishSessionState('rt-1', state('stored-1', { busy: true }))
    publishSessionState('rt-1', state('stored-1', { busy: false }))

    expect($sessionStates.get()['rt-1']).toBeDefined()
  })

  it('always lands a FIRST publish — resume can publish before the surface points at the runtime', () => {
    publishSessionState('rt-1', state('stored-1', { busy: false }))

    expect($sessionStates.get()['rt-1']).toBeDefined()
  })

  it('evicts B independently when only A references the same runtime and stored strings', () => {
    const legacyA = state('shared', { busy: false })
    $activeGatewayProfile.set('b')
    $sessionStates.set({ shared: legacyA })
    $sessionTiles.set([{ profile: 'a', runtimeId: 'shared', storedSessionId: 'shared' }])

    publishSessionState('shared', state('shared', { busy: true }), 'b')
    publishSessionState('shared', state('shared', { busy: false }), 'b')

    expect($sessionStates.get()['b\u0000shared']).toBeUndefined()
    expect($sessionStates.get().shared).toBe(legacyA)
  })
})

describe('SessionSurface reference eviction', () => {
  it('evicts an idle qualified runtime immediately on final release and is idempotent', () => {
    retainSessionSurfaceReference('profile-a', 'stored-1')
    bindSessionSurfaceRuntime('profile-a', 'stored-1', 'runtime-1')
    publishSessionState('runtime-1', state('stored-1', { busy: false }), 'profile-a')

    releaseSessionSurfaceReference('profile-a', 'stored-1')
    releaseSessionSurfaceReference('profile-a', 'stored-1')

    expect($sessionStates.get()['profile-a\u0000runtime-1']).toBeUndefined()
    expect(sessionSurfaceReferenceCount('profile-a', 'stored-1')).toBe(0)
    expect($sessionSurfaceProfiles.get()).not.toContain('profile-a')
  })

  it('keeps a shared binding until the final same-identity surface releases it', () => {
    retainSessionSurfaceReference('profile-a', 'stored-refcounted')
    retainSessionSurfaceReference('profile-a', 'stored-refcounted')
    bindSessionSurfaceRuntime('profile-a', 'stored-refcounted', 'runtime-refcounted')
    publishSessionState('runtime-refcounted', state('stored-refcounted', { busy: false }), 'profile-a')

    releaseSessionSurfaceReference('profile-a', 'stored-refcounted')
    expect(sessionSurfaceReferenceCount('profile-a', 'stored-refcounted')).toBe(1)
    expect($sessionStates.get()['profile-a\u0000runtime-refcounted']).toBeDefined()

    releaseSessionSurfaceReference('profile-a', 'stored-refcounted')
    expect(sessionSurfaceReferenceCount('profile-a', 'stored-refcounted')).toBe(0)
    expect($sessionStates.get()['profile-a\u0000runtime-refcounted']).toBeUndefined()
  })

  it('keeps a busy runtime on release and evicts it when it settles', () => {
    retainSessionSurfaceReference('profile-a', 'stored-busy')
    bindSessionSurfaceRuntime('profile-a', 'stored-busy', 'runtime-busy')
    publishSessionState('runtime-busy', state('stored-busy', { busy: true }), 'profile-a')

    releaseSessionSurfaceReference('profile-a', 'stored-busy')
    expect($sessionStates.get()['profile-a\u0000runtime-busy']).toBeDefined()

    publishSessionState('runtime-busy', state('stored-busy', { busy: false }), 'profile-a')
    expect($sessionStates.get()['profile-a\u0000runtime-busy']).toBeUndefined()
  })

  it.each(['surface', 'tile', 'primary'] as const)('keeps settled state when another %s references it', owner => {
    $activeGatewayProfile.set('profile-a')
    retainSessionSurfaceReference('profile-a', 'stored-release')
    bindSessionSurfaceRuntime('profile-a', 'stored-release', 'runtime-shared')

    if (owner === 'surface') {
      retainSessionSurfaceReference('profile-a', 'stored-other')
      bindSessionSurfaceRuntime('profile-a', 'stored-other', 'runtime-shared')
    } else if (owner === 'tile') {
      $sessionTiles.set([{ profile: 'profile-a', runtimeId: 'runtime-shared', storedSessionId: 'stored-other' }])
    } else {
      $activeSessionId.set('runtime-shared')
    }

    publishSessionState('runtime-shared', state('stored-release', { busy: false }), 'profile-a')
    releaseSessionSurfaceReference('profile-a', 'stored-release')

    expect($sessionStates.get()['profile-a\u0000runtime-shared']).toBeDefined()

    releaseSessionSurfaceReference('profile-a', 'stored-other')
  })

  it('rotates a binding without accumulating runtime keys and evicts the old idle state', () => {
    retainSessionSurfaceReference('profile-a', 'stored-rotate')
    bindSessionSurfaceRuntime('profile-a', 'stored-rotate', 'runtime-old')
    publishSessionState('runtime-old', state('stored-rotate', { busy: false }), 'profile-a')
    publishSessionState('runtime-new', state('stored-rotate', { busy: false }), 'profile-a')

    bindSessionSurfaceRuntime('profile-a', 'stored-rotate', 'runtime-new')

    expect($sessionStates.get()['profile-a\u0000runtime-old']).toBeUndefined()
    expect($sessionStates.get()['profile-a\u0000runtime-new']).toBeDefined()

    releaseSessionSurfaceReference('profile-a', 'stored-rotate')
    expect($sessionStates.get()['profile-a\u0000runtime-new']).toBeUndefined()
  })

  it('does not evict a busy superseded runtime until its settling publish', () => {
    retainSessionSurfaceReference('profile-a', 'stored-rotate-busy')
    bindSessionSurfaceRuntime('profile-a', 'stored-rotate-busy', 'runtime-old-busy')
    publishSessionState('runtime-old-busy', state('stored-rotate-busy', { busy: true }), 'profile-a')

    bindSessionSurfaceRuntime('profile-a', 'stored-rotate-busy', 'runtime-new-busy')
    expect($sessionStates.get()['profile-a\u0000runtime-old-busy']).toBeDefined()

    publishSessionState('runtime-old-busy', state('stored-rotate-busy', { busy: false }), 'profile-a')
    expect($sessionStates.get()['profile-a\u0000runtime-old-busy']).toBeUndefined()
    releaseSessionSurfaceReference('profile-a', 'stored-rotate-busy')
  })

  it('does not evict a superseded runtime that another surface references', () => {
    retainSessionSurfaceReference('profile-a', 'stored-rotate-owner')
    bindSessionSurfaceRuntime('profile-a', 'stored-rotate-owner', 'runtime-old-owned')
    retainSessionSurfaceReference('profile-a', 'stored-other-owner')
    bindSessionSurfaceRuntime('profile-a', 'stored-other-owner', 'runtime-old-owned')
    publishSessionState('runtime-old-owned', state('stored-rotate-owner', { busy: false }), 'profile-a')

    bindSessionSurfaceRuntime('profile-a', 'stored-rotate-owner', 'runtime-new-owned')

    expect($sessionStates.get()['profile-a\u0000runtime-old-owned']).toBeDefined()
    releaseSessionSurfaceReference('profile-a', 'stored-rotate-owner')
    releaseSessionSurfaceReference('profile-a', 'stored-other-owner')
  })

  it('releases colliding A/B bindings independently', () => {
    for (const profile of ['profile-a', 'profile-b']) {
      retainSessionSurfaceReference(profile, 'stored-shared')
      bindSessionSurfaceRuntime(profile, 'stored-shared', 'runtime-shared')
      publishSessionState('runtime-shared', state('stored-shared', { busy: false }), profile)
    }

    releaseSessionSurfaceReference('profile-a', 'stored-shared')

    expect($sessionStates.get()['profile-a\u0000runtime-shared']).toBeUndefined()
    expect($sessionStates.get()['profile-b\u0000runtime-shared']).toBeDefined()
    expect(sessionSurfaceReferenceCount('profile-b', 'stored-shared')).toBe(1)
    releaseSessionSurfaceReference('profile-b', 'stored-shared')
  })

  it('rotates colliding A without changing B runtime retention', () => {
    for (const profile of ['profile-a', 'profile-b']) {
      retainSessionSurfaceReference(profile, 'stored-shared-rotation')
      bindSessionSurfaceRuntime(profile, 'stored-shared-rotation', 'runtime-old-shared')
      publishSessionState('runtime-old-shared', state('stored-shared-rotation', { busy: false }), profile)
    }

    bindSessionSurfaceRuntime('profile-a', 'stored-shared-rotation', 'runtime-new-a')

    expect($sessionStates.get()['profile-a\u0000runtime-old-shared']).toBeUndefined()
    expect($sessionStates.get()['profile-b\u0000runtime-old-shared']).toBeDefined()
    releaseSessionSurfaceReference('profile-a', 'stored-shared-rotation')
    releaseSessionSurfaceReference('profile-b', 'stored-shared-rotation')
  })
})

describe('closeSessionTile eviction', () => {
  it("drops a settled session's state on close — no later publish may come", () => {
    $sessionTiles.set([{ profile: 'default', runtimeId: 'rt-1', storedSessionId: 'stored-1' }])
    publishSessionState('rt-1', state('stored-1', { busy: false }), 'default')

    closeSessionTile('stored-1')

    expect($sessionStates.get()['default\u0000rt-1']).toBeUndefined()
  })

  it('preserves naked legacy state when an explicitly profiled colliding tile closes', () => {
    const legacyA = state('shared', { busy: false })
    $sessionStates.set({ shared: legacyA })
    $sessionTiles.set([{ profile: 'b', runtimeId: 'shared', storedSessionId: 'shared' }])

    closeSessionTile('shared')

    expect($sessionStates.get().shared).toBe(legacyA)
  })

  it('preserves naked legacy state when an explicitly profiled colliding tile is discarded', () => {
    const legacyA = state('shared', { busy: false })
    $sessionStates.set({ shared: legacyA })
    $sessionTiles.set([{ profile: 'b', runtimeId: 'shared', storedSessionId: 'shared' }])

    discardSessionTile('shared')

    expect($sessionStates.get().shared).toBe(legacyA)
  })

  it("keeps a busy session's state on close — the background turn is still running", () => {
    $sessionTiles.set([{ profile: 'default', runtimeId: 'rt-1', storedSessionId: 'stored-1' }])
    publishSessionState('rt-1', state('stored-1', { busy: true }), 'default')

    closeSessionTile('stored-1')

    expect($sessionStates.get()['default\u0000rt-1']).toBeDefined()

    // ... and its settle publish is what evicts it.
    publishSessionState('rt-1', state('stored-1', { busy: false }), 'default')
    expect($sessionStates.get()['default\u0000rt-1']).toBeUndefined()
  })
})
