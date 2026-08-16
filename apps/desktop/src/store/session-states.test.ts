import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import { findGroupOfPane, group, split } from '@/components/pane-shell/tree/model'
import { $layoutTree, noteActiveTreeGroup } from '@/components/pane-shell/tree/store'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $activeGatewayProfile } from '@/store/profile'
import { $selectedStoredSessionId } from '@/store/session'
import type { SessionTile } from '@/store/session-states'
import {
  $focusedSessionState,
  $sessionStates,
  $sessionTiles,
  blankDraftTile,
  clearAllSessionStates,
  focusedSessionNeedsRoute,
  getRecentlySettledSessionIds,
  markSelectionRestore,
  orderTilesByTree,
  parseSessionTilePaneId,
  patchSessionTile,
  publishSessionState,
  selectionHomesToWorkspace,
  sessionTilePaneId
} from '@/store/session-states'

const tile = (storedSessionId: string): SessionTile => ({ profile: 'default', storedSessionId })
const tilePane = (id: string, profile = 'default') => sessionTilePaneId(id, profile)

describe('profile-qualified tile pane identity', () => {
  it('round-trips explicit profile and stored ids without colliding with the legacy pane id', () => {
    const paneA = sessionTilePaneId('same:id', 'profile-a')
    const paneB = sessionTilePaneId('same:id', 'profile-b')

    expect(paneA).not.toBe(paneB)
    expect(paneA).not.toBe(sessionTilePaneId('same:id'))
    expect(parseSessionTilePaneId(paneA)).toEqual({ profile: 'profile-a', storedSessionId: 'same:id' })
    expect(parseSessionTilePaneId(paneB)).toEqual({ profile: 'profile-b', storedSessionId: 'same:id' })
    expect(parseSessionTilePaneId(sessionTilePaneId('same:id'))).toEqual({ profile: null, storedSessionId: 'same:id' })
  })

  it('patches only the explicitly owned tile when stored ids collide', () => {
    const a = { profile: 'profile-a', storedSessionId: 'same' }
    const b = { profile: 'profile-b', storedSessionId: 'same' }
    $sessionTiles.set([a, b])

    patchSessionTile('same', { runtimeId: 'runtime-b' }, 'profile-b')

    expect($sessionTiles.get()).toEqual([a, { ...b, runtimeId: 'runtime-b' }])
  })
})

describe('profile-qualified settle grace', () => {
  beforeEach(() => clearAllSessionStates())
  afterEach(() => clearAllSessionStates())

  it("keeps A's settled grace when B with the same stored id goes busy", () => {
    const working = { ...createClientSessionState('shared'), busy: true, storedSessionId: 'shared' }

    publishSessionState('runtime-a', working, 'a')
    publishSessionState('runtime-a', { ...working, busy: false }, 'a')
    expect(getRecentlySettledSessionIds()).toEqual(['a\u0000shared'])

    publishSessionState('runtime-b', working, 'b')
    expect(getRecentlySettledSessionIds()).toEqual(['a\u0000shared'])
  })
})

describe('focused session profile isolation', () => {
  beforeEach(() => {
    $activeGatewayProfile.set('b')
    $selectedStoredSessionId.set('primary')
    $sessionTiles.set([{ profile: 'b', runtimeId: 'shared-runtime', storedSessionId: 'b-tile' }])
    $layoutTree.set(group(['workspace', tilePane('b-tile', 'b')], { active: tilePane('b-tile', 'b'), id: 'focused-b' }))
    noteActiveTreeGroup('focused-b')
  })

  afterEach(() => {
    $sessionStates.set({})
    $sessionTiles.set([])
    noteActiveTreeGroup(null)
  })

  it('does not expose naked legacy metadata to an explicitly profiled focused tile', () => {
    const legacy = { ...createClientSessionState('legacy-a'), model: 'secret-a-model' }
    $sessionStates.set({ 'shared-runtime': legacy })

    expect($focusedSessionState.get()).toBeUndefined()
    expect($sessionStates.get()['shared-runtime']).toBe(legacy)
  })
})

describe('orderTilesByTree', () => {
  it('no-ops (null) without a tree or below two tiles', () => {
    expect(orderTilesByTree(null, [tile('a'), tile('b')])).toBeNull()
    expect(orderTilesByTree(group([tilePane('a')]), [tile('a')])).toBeNull()
  })

  it('reorders tiles to layout-tree encounter order across a split', () => {
    const tree = split('row', [group(['workspace', tilePane('b')]), group([tilePane('a')])])

    expect(orderTilesByTree(tree, [tile('a'), tile('b')])).toEqual([tile('b'), tile('a')])
  })

  it('returns null when the array already matches strip order (skip persist)', () => {
    const tree = split('row', [group([tilePane('b')]), group([tilePane('a')])])

    expect(orderTilesByTree(tree, [tile('b'), tile('a')])).toBeNull()
  })

  it('sorts not-yet-adopted tiles after placed ones, stably', () => {
    const tree = group(['workspace', tilePane('b')])

    expect(orderTilesByTree(tree, [tile('a'), tile('b'), tile('c')])).toEqual([tile('b'), tile('a'), tile('c')])
  })
})

describe('selectionHomesToWorkspace', () => {
  const tiles = [tile('a'), tile('b')]

  it('homes for a null selection or a non-tile session', () => {
    expect(selectionHomesToWorkspace(null, tiles)).toBe(true)
    expect(selectionHomesToWorkspace('c', tiles)).toBe(true)
  })

  it('skips homing when the selected id is already an open tile', () => {
    expect(selectionHomesToWorkspace('a', tiles)).toBe(false)
  })

  it('homes an explicit profile A selection away from profile B tile with the same stored id', () => {
    const collidingTiles = [{ profile: 'profile-b', storedSessionId: 'same' }]

    expect(selectionHomesToWorkspace('same', collidingTiles, 'profile-a')).toBe(true)
  })

  it('allows the same-profile tile to remain and keeps explicit default distinct from legacy omission', () => {
    const collidingTiles = [
      { profile: 'profile-a', storedSessionId: 'same' },
      { profile: 'other', storedSessionId: 'other' }
    ]

    expect(selectionHomesToWorkspace('same', collidingTiles, 'profile-a')).toBe(false)
    expect(selectionHomesToWorkspace('other', collidingTiles, 'default')).toBe(true)
    expect(selectionHomesToWorkspace('other', collidingTiles)).toBe(false)
  })
})

describe('boot-restore selection homing (⌘R tab persistence)', () => {
  const mainGroup = () => group(['workspace', tilePane('t')], { active: tilePane('t'), id: 'main' })

  const activePane = () => {
    const tree = $layoutTree.get()

    return tree?.type === 'group' ? tree.active : null
  }

  it('a normal selection change fronts the workspace tab over an active tile', () => {
    $layoutTree.set(mainGroup())
    $selectedStoredSessionId.set('nav-1')

    expect(activePane()).toBe('workspace')
  })

  it('fronts workspace when active profile A selects the stored id owned by the active B tile', () => {
    $activeGatewayProfile.set('profile-a')
    $sessionTiles.set([{ profile: 'profile-b', storedSessionId: 'same' }])
    $layoutTree.set(
      group(['workspace', tilePane('same', 'profile-b')], { active: tilePane('same', 'profile-b'), id: 'main' })
    )

    $selectedStoredSessionId.set('same')

    expect(activePane()).toBe('workspace')
  })

  it('leaves the active A tile fronted when A selects its matching stored id', () => {
    $activeGatewayProfile.set('profile-a')
    $sessionTiles.set([{ profile: 'profile-a', storedSessionId: 'same' }])
    $layoutTree.set(
      group(['workspace', tilePane('same', 'profile-a')], { active: tilePane('same', 'profile-a'), id: 'main' })
    )

    $selectedStoredSessionId.set('same')

    expect(activePane()).toBe(tilePane('same', 'profile-a'))
  })

  it('markSelectionRestore skips homing exactly once, so the persisted active tab survives a reload', () => {
    $layoutTree.set(mainGroup())
    markSelectionRestore()
    $selectedStoredSessionId.set('boot-1')

    // Boot restore: the tile tab the user reloaded on stays fronted.
    expect(activePane()).toBe(tilePane('t'))

    // One-shot consumed: the next selection change is a real navigation.
    $selectedStoredSessionId.set('nav-2')
    expect(activePane()).toBe('workspace')
  })
})

describe('focusedSessionNeedsRoute', () => {
  it('routes when the session is not on screen', () => {
    expect(focusedSessionNeedsRoute(null, false)).toBe(true)
    expect(focusedSessionNeedsRoute(null, true)).toBe(true)
  })

  it('routes for the ACTIVE main session while a full page covers the workspace', () => {
    expect(focusedSessionNeedsRoute('main', true)).toBe(true)
  })

  it('skips the route when the main session is already the visible chat', () => {
    expect(focusedSessionNeedsRoute('main', false)).toBe(false)
  })

  it('never routes for a tile — its pane shows the chat on any route', () => {
    expect(focusedSessionNeedsRoute('tile', true)).toBe(false)
    expect(focusedSessionNeedsRoute('tile', false)).toBe(false)
  })
})

describe('blankDraftTile', () => {
  const bound = (storedSessionId: string, runtimeId: string): SessionTile => ({ profile: 'default', runtimeId, storedSessionId })

  const state = (messages: number, busy = false) =>
    ({ busy, messages: Array.from({ length: messages }, (_, i) => ({ id: `m${i}` })) }) as ClientSessionState

  it('finds the open tab whose session has no messages', () => {
    const tiles = [bound('a', 'run-a'), bound('b', 'run-b')]
    const states = { 'run-a': state(3), 'run-b': state(0) }

    expect(blankDraftTile(tiles, states)).toEqual(tiles[1])
  })

  it('picks the most recent blank tab when there are several', () => {
    const tiles = [bound('a', 'run-a'), bound('b', 'run-b')]
    const states = { 'run-a': state(0), 'run-b': state(0) }

    expect(blankDraftTile(tiles, states)).toEqual(tiles[1])
  })

  it('does not borrow a naked legacy draft for an explicitly profiled runtime collision', () => {
    const tiles = [bound('b', 'run-shared')]
    const legacy = state(0)
    const states = { 'run-shared': legacy }

    expect(blankDraftTile(tiles, states, 'b')).toBeNull()
    expect(states['run-shared']).toBe(legacy)
  })

  it('reads the tile state from its active profile when runtimes collide', () => {
    const tiles = [{ ...bound('a', 'run-shared'), profile: 'work' }]
    const states = {
      'other\u0000run-shared': state(2, true),
      'work\u0000run-shared': state(0)
    }

    expect(blankDraftTile(tiles, states, 'work')).toEqual(tiles[0])
    expect(blankDraftTile(tiles, states, 'other')).toBeNull()
  })

  it('leaves a blank-but-busy tab alone — its first turn is already in flight', () => {
    expect(blankDraftTile([bound('a', 'run-a')], { 'run-a': state(0, true) })).toBeNull()
  })

  it('treats an unbound or unpublished tile as unknown, not empty', () => {
    expect(blankDraftTile([tile('a')], {})).toBeNull()
    expect(blankDraftTile([bound('a', 'run-a')], {})).toBeNull()
  })

  it('is null when every open tab holds a conversation', () => {
    expect(blankDraftTile([bound('a', 'run-a')], { 'run-a': state(2) })).toBeNull()
    expect(blankDraftTile([], {})).toBeNull()
  })
})

// ⌘⇧T used to only restore `$sessionTiles`. Adoption inserts silently
// (activate:false), so the tab came back behind the still-fronted workspace.
// Real path: register, adopt, focus — same as paneMirror + reopen.
describe('reopenLastClosedTile focuses the restored tab', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
  })

  async function setup() {
    const tree = await import('@/components/pane-shell/tree/store')
    const model = await import('@/components/pane-shell/tree/model')
    const { registry } = await import('@/contrib/registry')
    const session = await import('@/store/session')
    const states = await import('@/store/session-states')

    registry.register({
      area: 'panes',
      data: { placement: 'main', uncloseable: true },
      id: 'workspace',
      render: () => null,
      title: 'chat'
    })

    // panes ← $sessionTiles (paneMirror stub). Adoption is synchronous on
    // register, so openSessionTile + focusOpenSession works the same tick.
    const registered = new Map<string, () => void>()

    const syncTiles = () => {
      const wanted = new Set(states.$sessionTiles.get().map(t => t.storedSessionId))

      for (const id of wanted) {
        if (registered.has(id)) {
          continue
        }

        registered.set(
          id,
          registry.register({
            area: 'panes',
            data: { dock: { pane: 'workspace', pos: 'center' }, placement: 'main' },
            id: tilePane(id),
            render: () => null,
            title: id
          })
        )
      }

      for (const [id, dispose] of registered) {
        if (!wanted.has(id)) {
          dispose()
          registered.delete(id)
          tree.removeTreePane(tilePane(id))
        }
      }
    }

    states.$sessionTiles.listen(syncTiles)
    tree.watchContributedPanes()
    session.$selectedStoredSessionId.set('primary')
    tree.declareDefaultTree(model.group(['workspace'], { active: 'workspace', id: 'grp-main' }))

    states.openSessionTile('closed', 'center', 'workspace')
    states.focusOpenSession('closed')
    tree.noteActiveTreeGroup('grp-main')
    expect(findGroupOfPane(tree.$layoutTree.get()!, tilePane('closed'))?.active).toBe(tilePane('closed'))

    return { states, tree }
  }

  it('fronts the restored tab after ⌘⇧T', async () => {
    const { states, tree } = await setup()

    states.closeSessionTile('closed')
    expect(states.$sessionTiles.get().some(t => t.storedSessionId === 'closed')).toBe(false)
    expect(findGroupOfPane(tree.$layoutTree.get()!, 'workspace')?.active).toBe('workspace')

    states.reopenLastClosedTile()

    expect(states.$sessionTiles.get().some(t => t.storedSessionId === 'closed')).toBe(true)
    expect(findGroupOfPane(tree.$layoutTree.get()!, tilePane('closed'))?.active).toBe(tilePane('closed'))
    expect(tree.$activeTreeGroup.get()).toBe('grp-main')
  })
})
