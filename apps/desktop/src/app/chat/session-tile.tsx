/**
 * SESSION TILES — a stored session rendered as a layout-tree pane BESIDE the
 * main thread (multi-session tiling). A tile IS the real chat surface: the
 * same ChatView/ChatBar/Thread tree the primary session renders, mounted
 * under a tile `SessionView` (its session's slice of `$sessionStates`) and a
 * tile `ComposerScope` (own attachment chips, own focus-bus key). Actions
 * (submit/slash/steer/edit/reload/restore/stop) come from
 * `useSessionTileActions`, all writing through the wiring cache.
 *
 * Lifecycle: `openSessionTile(storedId)` -> `watchSessionTiles` registers a
 * pane contribution docked right of the main zone -> tree adoption lands it
 * -> the pane mounts and asks the delegate for a live runtime id. Closing
 * the pane (tab Close) removes the tile + its zone; tiles persist across
 * restarts and re-resume on boot.
 */

import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useCallback, useRef, useSyncExternalStore } from 'react'

import { findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $layoutTree, closeTreePane, moveTreePane, setTreeGroupHeaderHidden } from '@/components/pane-shell/tree/store'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useI18n } from '@/i18n'
import { NEW_SESSION_TITLE, sessionTitle } from '@/lib/chat-runtime'
import { draftTitleFor } from '@/store/composer'
import { $pinnedSessionIds } from '@/store/layout'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { $projectTree } from '@/store/projects'
import {
  $selectedStoredSessionId,
  $sessions,
  sessionMatchesStoredId
} from '@/store/session'
import { sessionPinKeyForOwner, toggleSessionPinKey } from '@/store/session-pins'
import {
  $sessionStates,
  $sessionTiles,
  closeSessionTile,
  parseSessionTilePaneId,
  patchSessionTile,
  sessionRuntimeState,
  type SessionTile,
  sessionTileDelegate,
  sessionTilePaneId
} from '@/store/session-states'
import type { SessionInfo } from '@/types/hermes'

import type { SessionDragPayload } from './composer/inline-refs'
import { paneMirror } from './pane-mirror'
import { SessionDraftTitle } from './session-draft-title'
import { startSessionDrag } from './session-drag'
import { SessionStatusDot } from './session-status-dot'
import { SessionSurfaceCore } from './session-surface'
import { SessionContextMenu } from './sidebar/session-actions-menu'


type TileIdentity = { profile: string; storedSessionId: string }

const tileIdentityFromKey = (key: string): TileIdentity => {
  const identity = parseSessionTilePaneId(`session-tile:${key}`)

  if (!identity?.profile) {
    throw new Error(`Invalid qualified session tile key: ${key}`)
  }

  return { profile: identity.profile, storedSessionId: identity.storedSessionId }
}

const tileKey = ({ profile, storedSessionId }: TileIdentity): string =>
  sessionTilePaneId(storedSessionId, profile).slice('session-tile:'.length)

const tileForIdentity = ({ profile, storedSessionId }: TileIdentity): SessionTile | undefined =>
  $sessionTiles
    .get()
    .find(
      tile =>
        normalizeProfileKey(tile.profile) === normalizeProfileKey(profile) && tile.storedSessionId === storedSessionId
    )

export function SessionTilePane({ profile, storedSessionId }: TileIdentity) {
  const tile = useStore($sessionTiles).find(
    candidate =>
      normalizeProfileKey(candidate.profile) === normalizeProfileKey(profile) &&
      candidate.storedSessionId === storedSessionId
  )

  const onRuntimeSessionId = useCallback(
    (runtimeId: string) => patchSessionTile(storedSessionId, { error: undefined, runtimeId }, profile),
    [profile, storedSessionId]
  )

  return (
    <SessionSurfaceCore
      onRuntimeSessionId={onRuntimeSessionId}
      profile={tile?.profile ?? ''}
      runtimeSessionId={tile?.runtimeId}
      storedSessionId={storedSessionId}
    />
  )
}

// ---------------------------------------------------------------------------
// Tile -> pane contribution sync (call once from the app root).
// ---------------------------------------------------------------------------

/** Resolve a tile's stored row: the recents list first, then the project
 *  tree. A session opened as a tab from a project group is often older than
 *  the paginated recents page, so it has no `$sessions` row at all until new
 *  activity lands it there — resolving through the tree keeps its tab titled
 *  and tinted instead of a grey "Session" placeholder. */
export function tileStoredRow(profile: null | string | undefined, storedSessionId: string): SessionInfo | undefined {
  const owner = profile == null ? null : normalizeProfileKey(profile)

  const match = (s: SessionInfo) =>
    (owner === null || normalizeProfileKey(s.profile) === owner) && sessionMatchesStoredId(s, storedSessionId)

  return (
    $sessions.get().find(match) ??
    $projectTree
      .get()
      .flatMap(p => [...p.repos.flatMap(r => r.groups.flatMap(g => g.sessions)), ...(p.previewSessions ?? [])])
      .find(match)
  )
}

/** The tab's REGISTERED name. Deliberately the bare placeholder for a draft
 *  rather than its live composer title (`tabTitle` renders that): re-registering
 *  per keystroke would re-render the strip, and holding the draft's text here
 *  would let the registered name already match the row that lands on send —
 *  skipping the re-register that hands the tab back to this string. */
function tileTitle(key: string): string {
  const identity = tileIdentityFromKey(key)
  const stored = tileStoredRow(identity.profile, identity.storedSessionId)

  return stored ? sessionTitle(stored) : NEW_SESSION_TITLE
}

/** The `@session` link payload for a tile tab drag — id + owning profile + title.
 *  Resolved at drag time, so an unsent tab drags under its draft name. */
function tileDragPayload(key: string): SessionDragPayload {
  const { profile, storedSessionId } = tileIdentityFromKey(key)
  const stored = tileStoredRow(profile, storedSessionId)
  const title = stored ? sessionTitle(stored) : draftTitleFor(storedSessionId) || NEW_SESSION_TITLE

  return { id: storedSessionId, profile, title }
}

// ---------------------------------------------------------------------------
// Close confirmation — a BUSY tab (streaming, or blocked on clarify/approval
// input) doesn't close silently.
// ---------------------------------------------------------------------------

/** Tile identity awaiting close confirmation (null = no dialog). */
const $confirmCloseTile = atom<null | TileIdentity>(null)

/** The tile closer, gated: a quiet session closes immediately; a busy or
 *  input-blocked one asks first. One state read — the tile's runtime slice. */
export function requestCloseSessionTile(storedSessionId: string, profile?: null | string): void {
  const tile = profile == null
    ? $sessionTiles.get().find(t => t.storedSessionId === storedSessionId)
    : tileForIdentity({ profile: normalizeProfileKey(profile), storedSessionId })

  const runtimeId = tile?.runtimeId
  const states = $sessionStates.get()
  const state = runtimeId && tile ? sessionRuntimeState(states, tile.profile, runtimeId) : undefined

  if (state?.busy || state?.awaitingResponse || state?.needsInput) {
    if (tile) {
      $confirmCloseTile.set({ profile: tile.profile, storedSessionId })
    }
  } else {
    closeSessionTile(storedSessionId, tile?.profile ?? profile)
  }
}

/** Mounted once at the shell root: the "Close running tab?" confirmation. */
export function SessionTileCloseConfirm() {
  const { t } = useI18n()
  const identity = useStore($confirmCloseTile)

  return (
    <ConfirmDialog
      confirmLabel={t.zones.closeRunningConfirm}
      description={t.zones.closeRunningBody}
      destructive
      onClose={() => $confirmCloseTile.set(null)}
      onConfirm={() => {
        if (identity) {
          closeSessionTile(identity.storedSessionId, identity.profile)
        }
      }}
      open={identity !== null}
      title={t.zones.closeRunningTitle}
    />
  )
}

/** Layout reset → every session tile collapses into the MAIN zone as a tab
 *  after the workspace (the primary session stays the first tab), the "smart"
 *  reset: N scattered tiles become one tab bar over the chat instead of
 *  re-docking to their old edges.
 *
 *  Runs BEFORE generic adoption (see registerLayoutResetHandler) — the tiles
 *  aren't in the fresh tree yet, so each `moveTreePane` ADDS the tile into the
 *  workspace group as a tab (append). The main group id is re-read each pass
 *  because appending returns a new tree. */
export function stackSessionTilesIntoMain(): void {
  for (const tile of $sessionTiles.get()) {
    const tree = $layoutTree.get()
    const mainGroup = tree ? findGroupOfPane(tree, 'workspace')?.id : null

    if (mainGroup) {
      moveTreePane(sessionTilePaneId(tile.storedSessionId, tile.profile), { groupId: mainGroup, pos: 'center' })
    }
  }
}

/** The three scalars the tab menu actually renders, derived from the stored
 *  row. Subscribing to `$sessions` + `$projectTree` wholesale re-rendered
 *  every tab's menu wrapper on ANY session-list or tree churn (polls, title
 *  updates in other sessions) — for a context menu that's almost never open.
 *  Same class as the TreeGroup fix (#72245): derive narrowly, bail out unless
 *  the derived values change. */
function useTileMenuRow(
  storedSessionId: string,
  ownerProfile?: string
): { pinId: string; profile?: string; title: string } {
  const cache = useRef<{ key: string; value: { pinId: string; profile?: string; title: string } } | null>(null)

  const subscribe = useCallback((onChange: () => void) => {
    const offSessions = $sessions.listen(onChange)
    const offTree = $projectTree.listen(onChange)

    return () => {
      offSessions()
      offTree()
    }
  }, [])

  return useSyncExternalStore(subscribe, () => {
    const stored = tileStoredRow(ownerProfile, storedSessionId)
    const profile = ownerProfile ?? stored?.profile
    const pinId = sessionPinKeyForOwner(storedSessionId, profile, stored ? [stored] : [])
    const title = stored ? sessionTitle(stored) : NEW_SESSION_TITLE
    const key = `${pinId}\u0000${title}\u0000${profile ?? ''}`

    if (cache.current?.key !== key) {
      cache.current = { key, value: { pinId, profile, title } }
    }

    return cache.current.value
  })
}

/** A session TAB's context menu: the full session verb set (pin, copy id, new
 *  window, branch, rename, archive, delete) — the SAME menu a sidebar row
 *  gets, targeted through the tile delegate (whose verbs are generic over
 *  stored ids, primary included). The wrapper stops the contextmenu from also
 *  opening the zone strip's menu. Shared by tile tabs AND the main tab. */
export function SessionTabMenu({
  children,
  onClose,
  onHideTabBar,
  ownerProfile,
  storedSessionId,
  tabPaneId
}: {
  children: React.ReactElement
  /** Close this tab (tiles; the main tab passes nothing). */
  onClose?: () => void
  /** Hide the zone's tab bar (main tab only — the sticky bar's off switch). */
  onHideTabBar?: () => void
  /** Immutable owner for a tile tab. Omitted only by the legacy primary tab. */
  ownerProfile?: string
  storedSessionId: string
  /** Layout-tree pane id — powers the Close-others/right/all verbs. */
  tabPaneId: string
}) {
  const { pinId, profile, title } = useTileMenuRow(storedSessionId, ownerProfile)
  const pinnedSessionIds = useStore($pinnedSessionIds)
  const pinned = pinnedSessionIds.includes(pinId)

  return (
    <span className="contents" onContextMenu={event => event.stopPropagation()}>
      <SessionContextMenu
        onArchive={() => void sessionTileDelegate()?.archiveSession(storedSessionId, profile)}
        onBranch={() => void sessionTileDelegate()?.branchSession(storedSessionId, profile)}
        onClose={onClose}
        onDelete={() => void sessionTileDelegate()?.deleteSession(storedSessionId, profile)}
        onHideTabBar={onHideTabBar}
        onPin={() => toggleSessionPinKey(pinId)}
        pinned={pinned}
        profile={profile}
        sessionId={storedSessionId}
        surface="tab"
        tabPaneId={tabPaneId}
        title={title}
      >
        {children}
      </SessionContextMenu>
    </span>
  )
}

/** The MAIN tab's menu: the same session verbs targeting the primary's loaded
 *  session, plus Close (the tab empties to a fresh draft — the workspace pane
 *  itself never leaves the tree) and the bar's off switch (the bar sticky-shows
 *  once a tab is ever gained; this is the explicit way back). A fresh draft has
 *  no session — no menu. */
export function WorkspaceTabMenu({ children }: { children: React.ReactElement }) {
  const selected = useStore($selectedStoredSessionId)
  const profile = useStore($activeGatewayProfile)

  const hideTabBar = () => {
    const tree = $layoutTree.get()
    const group = tree ? findGroupOfPane(tree, 'workspace') : null

    if (group) {
      setTreeGroupHeaderHidden(group.id, true)
    }
  }

  if (!selected) {
    return children
  }

  return (
    <SessionTabMenu
      onClose={() => closeTreePane('workspace')}
      onHideTabBar={hideTabBar}
      ownerProfile={profile}
      storedSessionId={selected}
      tabPaneId="workspace"
    >
      {children}
    </SessionTabMenu>
  )
}

/** Keep pane contributions mirroring `$sessionTiles` (+ titles from
 *  `$sessions`). Tiles dock against main on the chosen edge, flex width. */
export const watchSessionTiles = paneMirror<SessionTile>({
  source: $sessionTiles,
  // $projectTree: a tile whose session is older than the recents page resolves
  // its title through the tree, which loads after the tiles register. (The tab's
  // status dot subscribes to color/state itself, so it needs no `also` entry.)
  also: [$sessions, $projectTree],
  key: tileKey,
  prefix: 'session-tile',
  dir: t => t.dir,
  anchor: t => t.anchor,
  before: t => t.before,
  minWidth: '20rem',
  title: tileTitle,
  // The tab's status dot — the SAME primitive the sidebar row renders, keyed by
  // the stored id, so a session's status/color can never disagree between the
  // two surfaces. Self-subscribing (live state + resolved color), so the strip
  // needn't re-sync when it changes.
  tabLead: key => {
    const { profile, storedSessionId } = tileIdentityFromKey(key)

    return (
      <SessionStatusDot
        profile={profile}
        session={tileStoredRow(profile, storedSessionId)}
        storedSessionId={storedSessionId}
      />
    )
  },
  // Until the first turn lists a row there is no title to register, so the tab
  // takes its name from the composer instead — live, without re-registering.
  tabTitle: key => {
    const { profile, storedSessionId } = tileIdentityFromKey(key)

    return tileStoredRow(profile, storedSessionId) ? null : <SessionDraftTitle scope={storedSessionId} />
  },
  render: key => <SessionTilePane {...tileIdentityFromKey(key)} />,
  tabWrap: (key, tab) => {
    const { profile, storedSessionId } = tileIdentityFromKey(key)

    return (
      <SessionTabMenu
        onClose={() => requestCloseSessionTile(storedSessionId, profile)}
        ownerProfile={profile}
        storedSessionId={storedSessionId}
        tabPaneId={sessionTilePaneId(storedSessionId, profile)}
      >
        {tab}
      </SessionTabMenu>
    )
  },
  // A tile's tab drags like a sidebar row — stack / split / drop-to-link — with
  // its tap (activate) + double-tap (hide bar) preserved. Always takes the drag.
  tabDrag: (key, event, onTap, double) => {
    startSessionDrag(tileDragPayload(key), event, { double, onTap })

    return true
  },
  close: key => {
    const { profile, storedSessionId } = tileIdentityFromKey(key)

    requestCloseSessionTile(storedSessionId, profile)
  }
})
