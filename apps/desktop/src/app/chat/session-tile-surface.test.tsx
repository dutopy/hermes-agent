import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { $pinnedSessionIds } from '@/store/layout'
import { $activeGatewayProfile } from '@/store/profile'
import { $gatewayState, $sessions } from '@/store/session'
import { sessionPinKeyForOwner } from '@/store/session-pins'
import { $sessionStates, $sessionTiles } from '@/store/session-states'

import { requestCloseSessionTile, SessionTabMenu, SessionTilePane } from './session-tile'

vi.mock('./sidebar/session-actions-menu', () => ({
  SessionContextMenu: ({
    children,
    onPin,
    pinned,
    profile
  }: {
    children: React.ReactNode
    onPin?: () => void
    pinned?: boolean
    profile?: string
  }) => (
    <div>
      {children}
      <button aria-label={`${profile}-${pinned ? 'pinned' : 'unpinned'}`} onClick={onPin} type="button" />
    </div>
  )
}))

vi.mock('./session-surface', () => ({
  SessionSurfaceCore: (props: { profile: string; runtimeSessionId?: null | string; storedSessionId: string }) => (
    <div data-profile={props.profile} data-runtime={props.runtimeSessionId} data-testid="shared-session-surface">
      {props.storedSessionId}
    </div>
  )
}))

describe('SessionTilePane shared surface', () => {
  beforeEach(() => {
    $gatewayState.set('open')
    $activeGatewayProfile.set('work')
    $pinnedSessionIds.set([])
    $sessions.set([])
    $sessionStates.set({})
    $sessionTiles.set([{ profile: 'vision', runtimeId: 'runtime-tile', storedSessionId: 'stored-tile' }])
  })

  it('renders the same SessionSurface exported to plugins', () => {
    render(<SessionTilePane profile="vision" storedSessionId="stored-tile" />)

    const surface = screen.getByTestId('shared-session-surface')
    expect(surface.textContent).toBe('stored-tile')
    expect(surface.dataset.profile).toBe('vision')
    expect(surface.dataset.runtime).toBe('runtime-tile')
  })

  it('keeps the tile owner when the foreground gateway profile changes', () => {
    render(<SessionTilePane profile="vision" storedSessionId="stored-tile" />)

    $activeGatewayProfile.set('personal')

    expect(screen.getByTestId('shared-session-surface').dataset.profile).toBe('vision')
  })

  it('does not borrow naked legacy busy state for close confirmation on an explicitly profiled tile', () => {
    const legacy = { ...createClientSessionState('legacy-a'), busy: true }
    $sessionStates.set({ 'runtime-tile': legacy })

    requestCloseSessionTile('stored-tile')

    expect($sessionTiles.get()).toEqual([])
    expect($sessionStates.get()['runtime-tile']).toBe(legacy)
  })

  it('reports and toggles homonymous tab pins by explicit owner without touching A or legacy', () => {
    const sessions = [
      { _lineage_root_id: 'root', id: 'same', profile: 'profile-a', title: 'A' },
      { _lineage_root_id: 'root', id: 'same', profile: 'profile-b', title: 'B' }
    ] as never
    $sessions.set(sessions)
    const aKey = sessionPinKeyForOwner('same', 'profile-a', sessions)
    const bKey = sessionPinKeyForOwner('same', 'profile-b', sessions)
    $pinnedSessionIds.set(['root', aKey])

    render(
      <>
        <SessionTabMenu ownerProfile="profile-a" storedSessionId="same" tabPaneId="a">
          <span>A tab</span>
        </SessionTabMenu>
        <SessionTabMenu ownerProfile="profile-b" storedSessionId="same" tabPaneId="b">
          <span>B tab</span>
        </SessionTabMenu>
      </>
    )

    expect(screen.getByRole('button', { name: 'profile-a-pinned' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'profile-b-unpinned' }))
    expect($pinnedSessionIds.get()).toEqual(['root', aKey, bKey])

    fireEvent.click(screen.getByRole('button', { name: 'profile-b-pinned' }))
    expect($pinnedSessionIds.get()).toEqual(['root', aKey])
  })
})
