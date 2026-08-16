import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SessionActionsMenu } from './session-actions-menu'

afterEach(cleanup)

// Exercises the real SessionActionsMenu end-to-end (no DropdownMenu mock) so
// a broken asChild composition on the kebab trigger fails here — the menu
// must still open on click.

vi.mock('@/components/pane-shell/tree/store', () => ({
  closeAllTreeTabs: vi.fn(),
  closeOtherTreeTabs: vi.fn(),
  closeTreeTabsToRight: vi.fn(),
  treeTabCloseTargets: vi.fn(() => null)
}))
vi.mock('@/app/open-session', () => ({ openSession: vi.fn() }))
vi.mock('@/components/ui/color-swatches', () => ({
  ColorSwatches: ({ onChange, value }: { onChange: (color: string) => void; value: null | string }) => (
    <button aria-label="Choose red" data-value={value ?? ''} onClick={() => onChange('red')} type="button">
      red
    </button>
  )
}))
vi.mock('@/hermes', () => ({ renameSession: vi.fn() }))
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      common: { cancel: 'Cancel', close: 'Close', delete: 'Delete', save: 'Save' },
      sidebar: {
        projects: {
          menuAppearance: 'Appearance',
          moveFailed: 'Could not move session',
          moveNoProjects: 'No other projects',
          movedTo: (name: string) => `Moved to ${name}`,
          moveToProject: 'Move to project',
          noColor: 'No color'
        },
        row: {
          archive: 'Archive',
          branchFrom: 'Branch from here',
          copyId: 'Copy ID',
          copyIdFailed: 'Failed to copy ID',
          export: 'Export',
          hideTabBar: 'Hide tab bar',
          newWindow: 'Open in new window',
          openInNewTab: 'Open in new tab',
          pin: 'Pin',
          rename: 'Rename',
          renameDesc: 'Leave empty to clear.',
          renameFailed: 'Rename failed',
          renameTitle: 'Rename session',
          renamed: 'Renamed',
          sessionActions: 'Session actions',
          unpin: 'Unpin',
          untitledPlaceholder: 'Untitled'
        }
      },
      zones: { closeAll: 'Close all', closeOthers: 'Close others', closeToRight: 'Close to the right' }
    }
  })
}))
vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))
vi.mock('@/lib/profile-color', () => ({ PROFILE_SWATCHES: [] }))
vi.mock('@/lib/session-export', () => ({ exportSession: vi.fn() }))
vi.mock('@/store/gateway', () => ({ activeGateway: vi.fn(() => null) }))
vi.mock('@/store/notifications', () => ({ notify: vi.fn(), notifyError: vi.fn() }))
vi.mock('@/store/projects', () => ({
  $projectTree: atom<unknown[]>([]),
  moveSessionToProject: vi.fn(),
  projectIdForCwd: vi.fn(() => null),
  projectRootCwd: vi.fn(() => '')
}))
vi.mock('@/store/session', () => ({
  $activeSessionId: atom<null | string>(null),
  $selectedStoredSessionId: atom<null | string>(null),
  $sessions: atom<unknown[]>([]),
  sessionMatchesStoredId: (session: { _lineage_root_id?: string; id: string }, id: string) =>
    session.id === id || session._lineage_root_id === id,
  sessionPinId: (session: { _lineage_root_id?: string; id: string }) => session._lineage_root_id ?? session.id,
  setSessions: vi.fn()
}))
vi.mock('@/store/session-color', () => ({
  $sessionColorOverrides: atom<Record<string, string>>({}),
  setSessionColorOverride: vi.fn()
}))
vi.mock('@/store/session-states', () => ({
  $sessionTiles: atom<unknown[]>([]),
  openSessionTile: vi.fn()
}))
vi.mock('@/store/profile', () => ({
  $activeGatewayProfile: atom('profile-a'),
  normalizeProfileKey: (profile?: null | string) => profile?.trim() || 'default'
}))
vi.mock('@/store/windows', () => ({
  canOpenSessionWindow: () => false,
  openSessionInNewWindow: vi.fn()
}))

function renderMenu() {
  return render(
    <SessionActionsMenu sessionId="s1" title="My session">
      <button aria-label="Session actions" type="button">
        ⋮
      </button>
    </SessionActionsMenu>
  )
}

function openTriggerMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
  fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
  fireEvent.click(trigger)
}

describe('SessionActionsMenu', () => {
  it('opens the dropdown on click without a tooltip on the kebab', async () => {
    renderMenu()

    const trigger = screen.getByRole('button', { name: 'Session actions' })

    expect(trigger.closest('[data-slot="tooltip-trigger"]')).toBeNull()

    // Radix's dropdown trigger opens on pointerdown (not on the synthetic
    // 'click' fireEvent alone would dispatch), so fire the full mouse
    // sequence a real click produces.
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)

    expect(await screen.findByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /archive/i })).toBeTruthy()
  })

  it('does not let profile A homonyms hide profile B Open in new tab', async () => {
    const { $selectedStoredSessionId, $sessions } = await import('@/store/session')
    const { $sessionTiles } = await import('@/store/session-states')
    const { openSession } = await import('@/app/open-session')

    $selectedStoredSessionId.set('same')
    $sessions.set([
      { _lineage_root_id: 'root-a', cwd: '/a', id: 'same', profile: 'profile-a' },
      { _lineage_root_id: 'root-b', cwd: '/b', id: 'same', profile: 'profile-b' }
    ] as never)
    $sessionTiles.set([{ profile: 'profile-a', storedSessionId: 'same' }] as never)

    render(
      <SessionActionsMenu profile="profile-b" sessionId="same" title="Profile B">
        <button aria-label="B actions" type="button">⋮</button>
      </SessionActionsMenu>
    )
    openTriggerMenu(screen.getByRole('button', { name: 'B actions' }))

    const item = await screen.findByRole('menuitem', { name: 'Open in new tab' })
    fireEvent.click(item)

    expect(openSession).toHaveBeenCalledWith('same', expect.any(Function), 'tab', 'profile-b')
  })

  it('resolves Appearance against the target profile row', async () => {
    const { $sessions } = await import('@/store/session')
    const { setSessionColorOverride } = await import('@/store/session-color')

    $sessions.set([
      { _lineage_root_id: 'root-a', cwd: '/a', id: 'same', profile: 'profile-a' },
      { _lineage_root_id: 'root-b', cwd: '/b', id: 'same', profile: 'profile-b' }
    ] as never)

    render(
      <SessionActionsMenu profile="profile-b" sessionId="same" title="Profile B">
        <button aria-label="B appearance" type="button">⋮</button>
      </SessionActionsMenu>
    )
    openTriggerMenu(screen.getByRole('button', { name: 'B appearance' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Appearance' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Choose red' }))

    expect(setSessionColorOverride).toHaveBeenCalledWith('root-b', 'red')
  })

  it('resolves the current project against the target profile row', async () => {
    const { $sessions } = await import('@/store/session')
    const { $projectTree, projectIdForCwd, projectRootCwd } = await import('@/store/projects')

    $sessions.set([
      { cwd: '/a', id: 'same', profile: 'profile-a' },
      { cwd: '/b', id: 'same', profile: 'profile-b' }
    ] as never)
    $projectTree.set([
      { id: 'project-a', isNoProject: false, label: 'Project A', root: '/a' },
      { id: 'project-b', isNoProject: false, label: 'Project B', root: '/b' }
    ] as never)
    vi.mocked(projectIdForCwd).mockImplementation(cwd => (cwd === '/a' ? 'project-a' : 'project-b'))
    vi.mocked(projectRootCwd).mockImplementation(node => (node as { root: string }).root)

    render(
      <SessionActionsMenu profile="profile-b" sessionId="same" title="Profile B">
        <button aria-label="B project" type="button">⋮</button>
      </SessionActionsMenu>
    )
    openTriggerMenu(screen.getByRole('button', { name: 'B project' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to project' }))

    expect(await screen.findByRole('menuitem', { name: 'Project A' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Project B' })).toBeNull()
  })
})
