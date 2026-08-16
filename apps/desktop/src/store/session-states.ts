/**
 * MULTI-SESSION VIEW STATE — the reactive face of the per-runtime session
 * cache (`sessionStateByRuntimeIdRef` in use-session-state-cache).
 *
 * The cache already ingests EVERY session's gateway events; only the view
 * was single-session ($messages + the active-id gate). This store mirrors
 * the cache per runtime id so any number of surfaces (session tiles, future
 * pane windows) can each subscribe to one session's state without touching
 * the main chat's `$messages` pipeline — same pattern as `useSessionSlice`
 * over `$todosBySession`, applied to whole `ClientSessionState`s.
 *
 * TILES are the first consumer: sessions opened side-by-side with the main
 * thread, each in its own layout-tree pane. `$sessionTiles` holds the
 * stored-session ids (persisted — tiles survive restarts); the wiring layer
 * owns resume/submit (it has the gateway + cache internals) and registers
 * itself here as the delegate so tile UI stays dependency-light.
 */

import { atom, computed } from 'nanostores'

import type { ClientSessionState } from '@/app/types'
import { findGroup, findGroupOfPane, type LayoutNode } from '@/components/pane-shell/tree/model'
import {
  $activeTreeGroup,
  $layoutTree,
  focusedSessionTabAnchor,
  moveTreePane,
  noteActiveTreeGroup,
  revealTreePane
} from '@/components/pane-shell/tree/store'
import { stableArray } from '@/lib/stable-array'
import { readJson, writeJson } from '@/lib/storage'
import type { SessionInfo } from '@/types/hermes'

import { $activeGatewayProfile, normalizeProfileKey } from './profile'
import {
  $activeSessionId,
  $selectedStoredSessionId,
  $sessions,
  $unreadFinishedSessionIds,
  lineageAliases,
  sessionDurableStateKey,
  sessionMatchesStoredId,
  setActiveSessionStoredIdRotation,
  setSessions
} from './session'
import { isSecondaryWindow } from './windows'

// ---------------------------------------------------------------------------
// Reactive per-runtime session state (view mirror of the wiring cache).
// ---------------------------------------------------------------------------

export const $sessionStates = atom<Record<string, ClientSessionState>>({})

/** Runtime ids are unique only inside their owning profile gateway. Omitted
 * profile preserves the legacy primary-chat/tile key during migration. */
export function sessionRuntimeStateKey(profile: null | string | undefined, runtimeSessionId: string): string {
  return profile == null ? runtimeSessionId : `${normalizeProfileKey(profile)}\u0000${runtimeSessionId}`
}

export function sessionRuntimeStateIdentity(key: string): { profile: null | string; runtimeSessionId: string } {
  const separator = key.indexOf('\u0000')

  return separator < 0
    ? { profile: null, runtimeSessionId: key }
    : { profile: key.slice(0, separator), runtimeSessionId: key.slice(separator + 1) }
}

export function sessionRuntimeState(
  states: Record<string, ClientSessionState>,
  profile: null | string | undefined,
  runtimeSessionId: string
): ClientSessionState | undefined {
  return states[sessionRuntimeStateKey(profile, runtimeSessionId)]
}

interface SessionSurfaceReference {
  count: number
  runtimeKeys: Set<string>
}

const sessionSurfaceReferences = new Map<string, SessionSurfaceReference>()

const sessionSurfaceKey = (profile: string, storedSessionId: string) =>
  `${normalizeProfileKey(profile)}\u0000${storedSessionId}`

export const $sessionSurfaceProfiles = atom<string[]>([])

function publishSessionSurfaceProfiles(): void {
  $sessionSurfaceProfiles.set(
    [...new Set([...sessionSurfaceReferences.keys()].map(key => normalizeProfileKey(key.split('\u0000', 1)[0])))].sort()
  )
}

/** Retain an embedded conversation without making it a layout tile or the
 * foreground chat. References are renderer-local and deliberately transient. */
export function retainSessionSurfaceReference(profile: string, storedSessionId: string): void {
  const key = sessionSurfaceKey(profile, storedSessionId)
  const current = sessionSurfaceReferences.get(key)

  if (current) {
    current.count += 1
  } else {
    sessionSurfaceReferences.set(key, { count: 1, runtimeKeys: new Set() })
  }

  publishSessionSurfaceProfiles()
}

export function bindSessionSurfaceRuntime(profile: string, storedSessionId: string, runtimeSessionId: string): void {
  const reference = sessionSurfaceReferences.get(sessionSurfaceKey(profile, storedSessionId))

  if (!reference) {
    return
  }

  const runtimeKey = sessionRuntimeStateKey(profile, runtimeSessionId)
  const supersededRuntimeKeys = [...reference.runtimeKeys].filter(key => key !== runtimeKey)

  reference.runtimeKeys.clear()
  reference.runtimeKeys.add(runtimeKey)

  for (const supersededKey of supersededRuntimeKeys) {
    evictUnreferencedSurfaceRuntime(supersededKey)
  }
}

export function releaseSessionSurfaceReference(profile: string, storedSessionId: string): void {
  const key = sessionSurfaceKey(profile, storedSessionId)
  const current = sessionSurfaceReferences.get(key)

  if (!current) {
    return
  }

  current.count -= 1

  if (current.count > 0) {
    publishSessionSurfaceProfiles()

    return
  }

  const releasedRuntimeKeys = [...current.runtimeKeys]
  current.runtimeKeys.clear()
  sessionSurfaceReferences.delete(key)
  publishSessionSurfaceProfiles()

  for (const runtimeKey of releasedRuntimeKeys) {
    evictUnreferencedSurfaceRuntime(runtimeKey)
  }
}

export function sessionSurfaceReferenceCount(profile: string, storedSessionId: string): number {
  return sessionSurfaceReferences.get(sessionSurfaceKey(profile, storedSessionId))?.count ?? 0
}

// Stored session ids whose authoritative state is still busy, but whose
// runtime has produced no state publish for the watchdog window. Silence is
// not completion: long tool calls can legitimately stay quiet, so this is a
// presentation hint and never mutates the backend-derived busy state.
export const $stalledSessionIds = atom<string[]>([])

export function setSessionStalled(
  storedSessionId: string | null | undefined,
  stalled: boolean,
  profile?: null | string
) {
  if (!storedSessionId) {
    return
  }

  const durableKey = sessionDurableStateKey(profile, storedSessionId)
  const current = $stalledSessionIds.get()
  const present = current.includes(durableKey)

  if (stalled && !present) {
    $stalledSessionIds.set([...current, durableKey])
  } else if (!stalled && present) {
    $stalledSessionIds.set(current.filter(id => id !== durableKey))
  }
}

// --- Watchdog: marks busy sessions quiet after a long stream silence -------
// Tuned against what this app actually does rather than a round number: a
// typecheck or a full test run here goes quiet for minutes at a stretch and is
// perfectly healthy, so anything under ~4 min would paint normal work as
// suspect. Eight minutes was the other failure — longer than a user is willing
// to sit and wonder, so the hint arrived after they had already given up on it.
export const SESSION_WATCHDOG_TIMEOUT_MS = 5 * 60 * 1000
const sessionWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()

function armWatchdog(runtimeId: string, profile?: null | string) {
  const stateKey = sessionRuntimeStateKey(profile, runtimeId)
  const existing = sessionWatchdogTimers.get(stateKey)

  if (existing) {
    clearTimeout(existing)
  }

  sessionWatchdogTimers.set(
    stateKey,
    setTimeout(() => {
      sessionWatchdogTimers.delete(stateKey)
      const current = $sessionStates.get()[stateKey]

      if (current?.busy) {
        setSessionStalled(current.storedSessionId, true, profile)
      }
    }, SESSION_WATCHDOG_TIMEOUT_MS)
  )
}

function clearWatchdog(runtimeId: string, profile?: null | string) {
  const stateKey = sessionRuntimeStateKey(profile, runtimeId)
  const t = sessionWatchdogTimers.get(stateKey)

  if (t) {
    clearTimeout(t)
    sessionWatchdogTimers.delete(stateKey)
  }
}

// --- Settle grace: keeps a just-finished session in the sidebar merge set ---
const SESSION_SETTLE_GRACE_MS = 30 * 1000
const settledExpiry = new Map<string, number>()

function markSettled(storedId: string, profile?: null | string) {
  settledExpiry.set(sessionDurableStateKey(profile, storedId), Date.now() + SESSION_SETTLE_GRACE_MS)
}

function clearSettled(storedId: string, profile?: null | string) {
  settledExpiry.delete(sessionDurableStateKey(profile, storedId))
}

/** Stored ids whose turn ended within the grace window. Prunes expired. */
export function getRecentlySettledSessionIds(now: number = Date.now()): string[] {
  const live: string[] = []

  for (const [id, expiry] of settledExpiry) {
    if (expiry > now) {
      live.push(id)
    } else {
      settledExpiry.delete(id)
    }
  }

  return live
}

// --- Transition detection (called automatically from publishSessionState) ---
function handleTransition(
  previous: ClientSessionState | null,
  next: ClientSessionState,
  runtimeId: string,
  profile?: null | string
) {
  // Compression id rotation: signal the route-follow effect with enough
  // provenance (previous id + runtime) that the consumer can reject the event
  // if the user navigated elsewhere before React handled it. A bare next id
  // could let a background session's delayed rotation steal the foreground
  // route.
  if (previous?.storedSessionId && next.storedSessionId && previous.storedSessionId !== next.storedSessionId) {
    const isForegroundProfile =
      profile == null || normalizeProfileKey(profile) === normalizeProfileKey($activeGatewayProfile.get())

    if (isForegroundProfile && runtimeId === $activeSessionId.get()) {
      setActiveSessionStoredIdRotation({
        nextStoredSessionId: next.storedSessionId,
        previousStoredSessionId: previous.storedSessionId,
        runtimeSessionId: runtimeId
      })
    }

    clearSettled(previous.storedSessionId, profile)
    setSessionStalled(previous.storedSessionId, false, profile)
  }

  // Every busy publish is stream activity: clear the quiet hint and restart
  // the silence window. A real terminal transition clears both the timer and
  // any hint, but only that authoritative transition clears working/busy.
  if (next.busy) {
    setSessionStalled(next.storedSessionId, false, profile)
    armWatchdog(runtimeId, profile)
  } else {
    clearWatchdog(runtimeId, profile)
    setSessionStalled(next.storedSessionId, false, profile)
    setSessionStalled(previous?.storedSessionId, false, profile)
  }

  const storedId = next.storedSessionId

  if (!storedId) {
    return
  }

  const wasWorking = previous?.busy ?? false

  if (next.busy && !wasWorking) {
    clearSettled(storedId, profile)
  } else if (!next.busy && wasWorking) {
    markSettled(storedId, profile)

    const durableKey = sessionDurableStateKey(profile, storedId)
    const selectedKey = sessionDurableStateKey(
      profile == null ? null : $activeGatewayProfile.get(),
      $selectedStoredSessionId.get() ?? ''
    )

    if (durableKey !== selectedKey) {
      const cur = $unreadFinishedSessionIds.get()

      if (!cur.includes(durableKey)) {
        $unreadFinishedSessionIds.set([...cur, durableKey])
      }
    }
  }
}

/** Is any surface on THIS window still holding the runtime — the primary view
 *  or an open tile? (A tile mid-resume references by stored id only; its
 *  runtime binding is patched in after `resumeTile` returns.) */
function runtimeReferenced(runtimeId: string, storedSessionId: null | string, profile?: null | string): boolean {
  const stateKey = sessionRuntimeStateKey(profile, runtimeId)
  const belongsToActiveProfile =
    profile == null || normalizeProfileKey(profile) === normalizeProfileKey($activeGatewayProfile.get())

  if (belongsToActiveProfile && runtimeId === $activeSessionId.get()) {
    return true
  }

  if ([...sessionSurfaceReferences.values()].some(reference => reference.runtimeKeys.has(stateKey))) {
    return true
  }

  return $sessionTiles.get().some(t => {
    const ownsRuntime =
      profile == null || normalizeProfileKey(t.profile) === normalizeProfileKey(profile)

    return ownsRuntime &&
      (t.runtimeId === runtimeId || (storedSessionId !== null && t.storedSessionId === storedSessionId))
  })
}

/** A state no surface needs anymore: its turn is over (not busy, not waiting
 *  on the user) and neither the primary view nor any tile holds the runtime.
 *  `needsInput` states stay — the sidebar's attention dot reads them. */
function evictable(runtimeId: string, state: ClientSessionState, profile?: null | string): boolean {
  return (
    !state.busy &&
    !state.needsInput &&
    !state.awaitingResponse &&
    !runtimeReferenced(runtimeId, state.storedSessionId, profile)
  )
}

function evictUnreferencedSurfaceRuntime(runtimeKey: string): void {
  const state = $sessionStates.get()[runtimeKey]

  if (!state) {
    return
  }

  const { profile, runtimeSessionId } = sessionRuntimeStateIdentity(runtimeKey)

  if (evictable(runtimeSessionId, state, profile)) {
    dropSessionState(runtimeSessionId, profile)
  }
}

/** Publish one session's state. Automatically fires transition side-effects
 *  (watchdog arm/disarm, settle grace, unread marker, compression id rotation)
 *  by diffing previous vs next — callers never need to manually call a
 *  transition handler.
 *
 *  Skips the publish when the new state is identical to the existing one
 *  (same reference) to avoid churning `$sessionStates` on periodic
 *  `session.info` heartbeats that carry no change — otherwise every ~1/s
 *  heartbeat creates a new Record spread, triggering computed atoms
 *  ($workingSessionIds, $attentionSessionIds) and their subscribers
 *  unnecessarily. The runtime-id→state cache (sessionStateByRuntimeIdRef)
 *  is updated independently by the caller, so the visual path stays live
 *  without the store churn.
 *
 *  A settled state nothing references is EVICTED instead of republished:
 *  gateway events keep flowing for sessions whose tile was closed mid-turn,
 *  and parking each one's full transcript here forever is the leak that made
 *  the app crawl after a day of tile use — every entry taxes every later
 *  publish (map spread + the status-set projections). Transition side effects
 *  still fire, so the closed session's settle keeps its unread dot. Only an
 *  entry already in the map is evicted — a FIRST publish always lands, because
 *  a resume can publish its idle state a beat before `$activeSessionId` /
 *  the tile's runtime binding points at it. */
export function publishSessionState(runtimeId: string, state: ClientSessionState, profile?: null | string) {
  const stateKey = sessionRuntimeStateKey(profile, runtimeId)
  const current = $sessionStates.get()
  const prev = current[stateKey] ?? null

  if (prev === state) {
    return
  }

  if (prev && evictable(runtimeId, state, profile)) {
    handleTransition(prev, state, runtimeId, profile)
    const { [stateKey]: _dropped, ...rest } = current
    $sessionStates.set(rest)

    return
  }

  $sessionStates.set({ ...current, [stateKey]: state })
  handleTransition(prev, state, runtimeId, profile)
}

export function dropSessionState(runtimeId: string, profile?: null | string) {
  const stateKey = sessionRuntimeStateKey(profile, runtimeId)
  // Disarm the watchdog — a dropped runtime must not fire a stale clear later.
  // Settle-grace entries are keyed by stored id and self-expire; leave them so
  // a just-finished session's row survives merge eviction even if its tile or
  // cached runtime is dropped in the meantime.
  clearWatchdog(runtimeId, profile)

  const current = $sessionStates.get()
  setSessionStalled(current[stateKey]?.storedSessionId, false, profile)

  if (!(stateKey in current)) {
    return
  }

  const { [stateKey]: _dropped, ...rest } = current
  $sessionStates.set(rest)
}

/** Drop every cached session state — used on soft gateway-mode apply so the
 *  computed working / attention sets drain to empty alongside the session list.
 *  Also disarms every watchdog timer and drops all settle-grace entries: a
 *  wiped gateway's sessions must not fire stale clears or linger in the
 *  sidebar merge keep-set after the switch. */
export function clearAllSessionStates() {
  for (const timer of sessionWatchdogTimers.values()) {
    clearTimeout(timer)
  }

  sessionWatchdogTimers.clear()
  settledExpiry.clear()
  $stalledSessionIds.set([])
  $sessionStates.set({})
}

// Derived per-session status sets — pure projections of `$sessionStates` (which
// holds `busy`/`needsInput` per runtime), keeping the data flow one-directional:
// gateway event → cache → $sessionStates → computed views.
//
// Perf: `$sessionStates` is republished on EVERY message delta (tens/sec during
// a turn), but these sets only change on busy/needsInput edges. `stableArray`
// keeps the prior reference when membership is unchanged so `computed` skips the
// emit — otherwise the whole sidebar + every row re-renders per token.
// Published under every id the conversation answers to, not just its current
// tip: consumers hold whichever id they were created with, and compression
// rotates the tip out from under them (see lineageAliases).
//
// A conversation that has not been persisted yet has no stored id at all, and
// dropping it here is what left the FIRST turn of a new chat with no running
// indicator anywhere — no dot, no row arc — for as long as it took the backend
// to hand one back. Its runtime id is the right fallback because until a stored
// id exists the two are the same value (submit.ts: "an unpersisted
// conversation's queue key IS its runtime id"), so the row matches; once a
// session is persisted its runtime id is nobody's key and the fallback is inert.
const storedIds = (
  states: Record<string, ClientSessionState>,
  sessions: readonly SessionInfo[],
  pred: (s: ClientSessionState, profile: null | string) => boolean
) => {
  const ids = new Set<string>()

  for (const [runtimeKey, state] of Object.entries(states)) {
    const { profile, runtimeSessionId } = sessionRuntimeStateIdentity(runtimeKey)

    if (!pred(state, profile)) {
      continue
    }

    for (const alias of lineageAliases(state.storedSessionId ?? runtimeSessionId, sessions, profile)) {
      ids.add(sessionDurableStateKey(profile, alias))
    }
  }

  return [...ids]
}

let workingIds: readonly string[] = []
export const $workingSessionIds = computed(
  [$sessionStates, $sessions],
  (states, sessions) =>
    (workingIds = stableArray(
      workingIds,
      storedIds(states, sessions, s => s.busy)
    ))
)

let attentionIds: readonly string[] = []
export const $attentionSessionIds = computed(
  [$sessionStates, $sessions],
  (states, sessions) =>
    (attentionIds = stableArray(
      attentionIds,
      storedIds(states, sessions, s => s.needsInput)
    ))
)

// An open session nothing has ever been sent to — the ⌘T tab whose backend
// session exists but is unlisted, or a tile still waiting on its first send.
// `blankDraftTile`'s predicate, read as a status rather than as a slot to spend.
//
// The row's own `message_count` is the tiebreaker, and it is load-bearing: a
// session RESUMING also holds an empty message list for the moment between
// binding its runtime and loading its transcript, and calling that a draft
// would flash the wrong mark on a conversation with years of history in it.
let draftIds: readonly string[] = []
export const $draftSessionIds = computed([$sessionStates, $sessions], (states, sessions) => {
  const unsent = (state: ClientSessionState, profile: null | string) => {
    if (state.busy || state.messages.length > 0) {
      return false
    }

    const storedId = state.storedSessionId

    // No stored id is the ⌘T tab that hasn't reached the backend yet: a draft
    // by definition, and no row to consult. Asking anyway would match a row on
    // an empty lineage root.
    if (!storedId) {
      return true
    }

    const row = sessions.find(session => {
      const owner = (session.profile ?? '').trim() || 'default'

      return (profile == null || owner === profile) && sessionMatchesStoredId(session, storedId)
    })

    return !row || row.message_count === 0
  }

  return (draftIds = stableArray(draftIds, storedIds(states, sessions, unsent)))
})

// ---------------------------------------------------------------------------
// Session tiles.
// ---------------------------------------------------------------------------

/** Edge a tile docks against main when it first joins the tree. Shared by
 *  session tiles and route (page) tiles. */
export type SplitDir = 'bottom' | 'left' | 'right' | 'top'

/** Where a tile lands on adoption: an edge split, or `center` = stack into
 *  the anchor's zone as a tab (a drop on the zone's tab strip). */
export type TileDock = 'center' | SplitDir

export interface SessionTile {
  /** Stored session id — the durable identity (runtime ids are ephemeral). */
  storedSessionId: string
  /** Immutable owner used for every transport/state operation. */
  profile: string
  /** Dock against `anchor` on adoption (default right; center = stack). */
  dir?: TileDock
  /** Pane to dock against (a drop's target zone) — default the workspace.
   *  Persisted so a restart re-docks in place; a stale id falls back to the
   *  workspace (findGroupOfPane misses → the move is skipped). */
  anchor?: string
  /** Center docks: stack BEFORE this pane id (`null`/omitted = append) — the
   *  strip divider's slot. Persisted, like `anchor`; a stale id appends. */
  before?: null | string
  /** Live runtime id once the tile's resume has bound one. */
  runtimeId?: string
  /** Resume failed terminally (shown in the tile; retryable). */
  error?: string
}

// Tiles are persisted PER PROFILE: a session belongs to one profile, and the
// single live gateway is scoped to one profile at a time, so a tile only makes
// sense while its profile is active. Switching profiles swaps the visible set
// (and drops runtime bindings so each tile re-resumes against the now-current
// gateway — which also settles the "tile resumes against the wrong backend" and
// "stale runtime after respawn" bugs by construction).
const TILES_KEY = 'hermes.desktop.sessionTiles.v2'
const LEGACY_TILES_KEY = 'hermes.desktop.sessionTiles.v1'
export const TILE_PANE_PREFIX = 'session-tile:'
const QUALIFIED_TILE_PANE_PREFIX = 'v2:'

/** Pane ids persist in the layout, so their identity must include the tile
 * owner. An omitted profile deliberately emits the old bare id for reading
 * legacy layouts only; all new tile panes use the qualified form. */
export function sessionTilePaneId(storedSessionId: string, profile?: null | string): string {
  if (profile == null) {
    return `${TILE_PANE_PREFIX}${storedSessionId}`
  }

  return `${TILE_PANE_PREFIX}${QUALIFIED_TILE_PANE_PREFIX}${encodeURIComponent(normalizeProfileKey(profile))}:${encodeURIComponent(storedSessionId)}`
}

export function parseSessionTilePaneId(
  paneId: string
): null | { profile: null | string; storedSessionId: string } {
  if (!paneId.startsWith(TILE_PANE_PREFIX)) {
    return null
  }

  const identity = paneId.slice(TILE_PANE_PREFIX.length)

  if (!identity.startsWith(QUALIFIED_TILE_PANE_PREFIX)) {
    return { profile: null, storedSessionId: identity }
  }

  const qualified = identity.slice(QUALIFIED_TILE_PANE_PREFIX.length)
  const separator = qualified.indexOf(':')

  if (separator < 0) {
    return null
  }

  try {
    return {
      profile: normalizeProfileKey(decodeURIComponent(qualified.slice(0, separator))),
      storedSessionId: decodeURIComponent(qualified.slice(separator + 1))
    }
  } catch {
    return null
  }
}

const tileIdentityKey = (profile: string, storedSessionId: string) =>
  sessionTilePaneId(storedSessionId, profile).slice(TILE_PANE_PREFIX.length)

const tileMatches = (tile: SessionTile, storedSessionId: string, profile?: null | string): boolean =>
  tile.storedSessionId === storedSessionId &&
  (profile == null
    ? normalizeProfileKey(tile.profile) === normalizeProfileKey($activeGatewayProfile.get())
    : normalizeProfileKey(tile.profile) === normalizeProfileKey(profile))

export function findSessionTile(storedSessionId: string, profile?: null | string): SessionTile | undefined {
  return $sessionTiles.get().find(tile => tileMatches(tile, storedSessionId, profile))
}

/** Persisted placement — `dir` + strip slot (`before`) + dock `anchor` so a
 *  restart / profile swap re-adopts tiles in the same order, not all stacked
 *  right of workspace. */
type StoredTile = Pick<SessionTile, 'anchor' | 'before' | 'dir' | 'profile' | 'storedSessionId'>

const toStored = (t: SessionTile): StoredTile => ({
  anchor: t.anchor,
  before: t.before,
  dir: t.dir,
  profile: normalizeProfileKey(t.profile),
  storedSessionId: t.storedSessionId
})

function parseTileList(value: unknown, ownerProfile: string): StoredTile[] {
  return Array.isArray(value)
    ? value
        .filter((t): t is SessionTile => Boolean(t && typeof (t as SessionTile).storedSessionId === 'string'))
        .map(t => {
          const raw = t as SessionTile

          return {
            anchor: typeof raw.anchor === 'string' ? raw.anchor : undefined,
            before: typeof raw.before === 'string' || raw.before === null ? raw.before : undefined,
            dir: raw.dir,
            profile: normalizeProfileKey(raw.profile || ownerProfile),
            storedSessionId: raw.storedSessionId
          }
        })
    : []
}

function loadTilesByProfile(): Record<string, StoredTile[]> {
  const byProfile: Record<string, StoredTile[]> = {}
  const parsed = readJson<unknown>(TILES_KEY)

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [profile, list] of Object.entries(parsed as Record<string, unknown>)) {
      const tiles = parseTileList(list, profile)

      if (tiles.length > 0) {
        byProfile[normalizeProfileKey(profile)] = tiles
      }
    }
  }

  // Migrate a v1 flat list into the default profile, then retire the key.
  const legacy = parseTileList(readJson<unknown>(LEGACY_TILES_KEY), 'default')

  if (legacy.length > 0) {
    const key = normalizeProfileKey('default')
    byProfile[key] = [...(byProfile[key] ?? []), ...legacy]
  }

  writeJson(LEGACY_TILES_KEY, null)

  return byProfile
}

const tilesByProfile = loadTilesByProfile()
// Keyed by the GATEWAY profile: the rail's profile switch is a soft swap
// ($activeGatewayProfile moves, no reload) — $activeProfile mirrors the
// window's primary backend and never changes on a rail switch, so keying on
// it left the previous profile's tiles registered (phantom "Session" tabs).
const profileKey = () => normalizeProfileKey($activeGatewayProfile.get())

// Runtime ids are process-scoped — never trust a persisted one, so the live
// atom hydrates from the stored (runtime-less) tiles for the active profile.
// A secondary window (single-chat pop-out) shows ONLY its routed session — no
// tiles, and no repopulation on a profile switch.
export const $sessionTiles = atom<SessionTile[]>(
  isSecondaryWindow() ? [] : Object.values(tilesByProfile).flatMap(tiles => [...tiles])
)

function persistTiles() {
  // Shares the origin's storage; a secondary window holds no tiles, so a write
  // back would only wipe the primary's set.
  if (isSecondaryWindow()) {
    return
  }

  writeJson(TILES_KEY, Object.keys(tilesByProfile).length === 0 ? null : tilesByProfile)
}

function saveTiles(tiles: SessionTile[]) {
  $sessionTiles.set(tiles)
  const nextByProfile: Record<string, StoredTile[]> = {}

  for (const tile of tiles) {
    const owner = normalizeProfileKey(tile.profile)
    ;(nextByProfile[owner] ??= []).push(toStored(tile))
  }

  for (const key of Object.keys(tilesByProfile)) {
    delete tilesByProfile[key]
  }

  Object.assign(tilesByProfile, nextByProfile)

  persistTiles()
}

export function patchSessionTile(storedSessionId: string, patch: Partial<SessionTile>, profile?: null | string) {
  saveTiles($sessionTiles.get().map(t => (tileMatches(t, storedSessionId, profile) ? { ...t, ...patch } : t)))
}

/** Drop live runtime bindings so every tile re-resumes — used on gateway
 *  reconnect, where a respawned backend re-mints (recycles) runtime ids. */
export function resetTileRuntimeBindings() {
  const tiles = $sessionTiles.get()

  if (tiles.some(t => t.runtimeId)) {
    $sessionTiles.set(tiles.map(toStored))
  }
}

// ---------------------------------------------------------------------------
// Delegate — the wiring layer (which owns the gateway + session cache) plugs
// its actions in; tile UI calls through here. Same inversion as the tree
// store's pane closers.
// ---------------------------------------------------------------------------

export interface SessionSurfaceIdentity {
  profile: string
  runtimeSessionId?: string
  storedSessionId: string
}

export interface SessionSurfaceRuntimeIdentity extends SessionSurfaceIdentity {
  runtimeSessionId: string
}

/** Explicitly marks an ephemeral runtime hint that is no longer usable for its
 * durable identity. Only this error enables SessionSurface's bounded resume
 * fallback; transport, authorization, and other adoption failures stay visible. */
export class StaleSessionSurfaceRuntimeError extends Error {
  constructor(message = 'Session surface runtime hint is stale') {
    super(message)
    this.name = 'StaleSessionSurfaceRuntimeError'
  }
}

export function isStaleSessionSurfaceRuntimeError(error: unknown): boolean {
  return error instanceof StaleSessionSurfaceRuntimeError ||
    (error instanceof Error && error.name === 'StaleSessionSurfaceRuntimeError')
}

export interface SessionTileDelegate {
  /** Adopt a runtime returned by session.create. This path must not resume: a
   * fresh seeded session has no durable row until its first prompt. */
  adoptSurface(identity: SessionSurfaceRuntimeIdentity): Promise<string>
  /** Archive a stored session (the sidebar's archive, incl. tile cleanup). */
  archiveSession(storedSessionId: string, profile?: string): Promise<void>
  /** Branch a stored session into a new chat (the sidebar's branch). */
  branchSession(storedSessionId: string, profile?: string): Promise<void>
  /** Delete a stored session (the sidebar's delete, incl. tile cleanup). */
  deleteSession(storedSessionId: string, profile?: string): Promise<void>
  /** Permanently forget a durable surface binding after archive/delete. */
  discardSurface?(identity: SessionSurfaceIdentity): string[]
  /** Run a slash command against a tile's session (app-level effects — e.g.
   *  branch/handoff — act on the main surface, as they should). */
  executeSlash(rawCommand: string, sessionId: string): Promise<void>
  /** Interrupt a tile's running turn. */
  interruptSession(runtimeId: string): Promise<void>
  /** Bind a live runtime id for a stored session (resume without touching
   *  the main view). Returns the runtime id, or throws. */
  resumeSurface(identity: SessionSurfaceIdentity): Promise<string>
  /** Compatibility wrapper for tile callers while they migrate to the shared
   * surface. The active tile profile is supplied by its pane. */
  resumeTile(storedSessionId: string, profile?: string): Promise<string>
  /** Submit a prompt to a tile's live session. */
  submitToSession(runtimeId: string, text: string): Promise<void>
  /** THE session-state write path — routes through the wiring cache so the
   *  cache, the primary view (when active), and every tile mirror agree. */
  updateSession(
    runtimeId: string,
    updater: (state: ClientSessionState) => ClientSessionState,
    profile?: string
  ): ClientSessionState
}

let delegate: SessionTileDelegate | null = null
const delegateListeners = new Set<() => void>()

export function setSessionSurfaceDelegate(next: SessionTileDelegate | null) {
  delegate = next
  delegateListeners.forEach(listener => listener())
}

export function subscribeSessionSurfaceDelegate(listener: () => void): () => void {
  delegateListeners.add(listener)

  return () => delegateListeners.delete(listener)
}

export const setSessionTileDelegate = setSessionSurfaceDelegate

export function sessionSurfaceDelegate(): SessionTileDelegate | null {
  return delegate
}

export function sessionTileDelegate(): SessionTileDelegate | null {
  return delegate
}

/** Reorder tiles to match layout-tree encounter order (stored ids in the order
 *  their `session-tile:` panes are walked). Restore replays the array through
 *  sequential adoption (each center tile APPENDS after the ones before it), so
 *  array order IS strip order — no `before` stamping needed; a stale `before`
 *  naming an absent pane falls back to append anyway (see insertAtGroup). Tiles
 *  not yet adopted sort after placed ones, stably. Returns `null` when nothing
 *  moves so callers can skip a needless persist. */
export function orderTilesByTree<T extends { profile: string; storedSessionId: string }>(
  tree: LayoutNode | null,
  tiles: readonly T[]
): null | T[] {
  if (!tree || tiles.length < 2) {
    return null
  }

  const order: string[] = []

  const walk = (node: LayoutNode) => {
    if (node.type === 'group') {
      for (const id of node.panes) {
        const identity = parseSessionTilePaneId(id)

        if (identity?.profile) {
          order.push(tileIdentityKey(identity.profile, identity.storedSessionId))
        }
      }

      return
    }

    node.children.forEach(walk)
  }

  walk(tree)

  const rank = new Map(order.map((id, i) => [id, i]))

  const next = [...tiles].sort(
    (a, b) =>
      (rank.get(tileIdentityKey(a.profile, a.storedSessionId)) ?? Infinity) -
      (rank.get(tileIdentityKey(b.profile, b.storedSessionId)) ?? Infinity)
  )

  return next.some((t, i) => t !== tiles[i]) ? next : null
}

function syncTileStripOrder() {
  const next = orderTilesByTree($layoutTree.get(), $sessionTiles.get())

  if (next) {
    saveTiles(next)
  }
}

/** Open a tile for a stored session, or MOVE an existing one to the new dock
 *  (`dir`; `center` = stack into the anchor's zone, `before` = strip slot). The
 *  move path is what lets a tile's own TAB be dragged like a sidebar row — drop
 *  it on a zone/edge/strip and the tile goes there (drop-on-a-composer links
 *  instead, handled by the drag resolver). The session LOADED IN MAIN never
 *  opens as a tile (same transcript twice, fighting one runtime — silly).
 *
 *  An unanchored open (⌘T, ⌘⇧T on a tile that predates anchors) docks into the
 *  FOCUSED chat zone — the same zone ⌘1…⌘9 and ⌘W act on — so a new tab lands
 *  in the strip the user is looking at, not always main's. */
export function openSessionTile(
  storedSessionId: string,
  dir: TileDock = 'right',
  anchor?: string,
  before?: null | string,
  ownerProfile?: string
) {
  const tiles = $sessionTiles.get()
  const profile = normalizeProfileKey(
    ownerProfile ?? $sessions.get().find(session => sessionMatchesStoredId(session, storedSessionId))?.profile ?? profileKey()
  )

  if (
    storedSessionId === $selectedStoredSessionId.get() &&
    normalizeProfileKey($activeGatewayProfile.get()) === profile
  ) {
    return
  }

  const dock = anchor ?? focusedSessionTabAnchor() ?? undefined

  if (!tiles.some(t => tileMatches(t, storedSessionId, profile))) {
    saveTiles([...tiles, { anchor: dock, before, dir, profile, storedSessionId }])
    // Adoption is async via the registry — order sync runs after the move path
    // below; a brand-new tile's strip slot is already in `before`.

    return
  }

  // Already open: relocate the existing pane to the drop target (pane-mirror
  // only docks on first adoption, so a re-drag must move the tree pane itself).
  const tree = $layoutTree.get()
  const target = tree ? findGroupOfPane(tree, dock ?? 'workspace')?.id : null

  if (target) {
    moveTreePane(sessionTilePaneId(storedSessionId, profile), { before: before ?? null, groupId: target, pos: dir })
    patchSessionTile(storedSessionId, { anchor: dock, before: before ?? undefined, dir }, profile)
    syncTileStripOrder()
  }
}

/** ⌘W on the MAIN tab: the next session tab stacked WITH the workspace, to
 *  shift into main. Walks the workspace group's strip from the workspace tab
 *  outward (the tab after it first, then wrapping to the ones before), and
 *  returns the first session tile's stored id. Null when the workspace has no
 *  session tab stacked beside it (⌘W then stays the no-op it was). */
export function nextSessionTileForWorkspace(): null | Pick<SessionTile, 'profile' | 'storedSessionId'> {
  const tree = $layoutTree.get()
  const group = tree ? findGroupOfPane(tree, 'workspace') : null

  if (!group) {
    return null
  }

  const tiles = $sessionTiles.get()
  const idx = group.panes.indexOf('workspace')
  // After the workspace tab first, then the ones before it (nearest-out).
  const ordered = [...group.panes.slice(idx + 1), ...group.panes.slice(0, idx).reverse()]

  for (const paneId of ordered) {
    const identity = parseSessionTilePaneId(paneId)

    if (identity) {
      const tile = tiles.find(t => tileMatches(t, identity.storedSessionId, identity.profile))

      if (tile) {
        return { profile: tile.profile, storedSessionId: tile.storedSessionId }
      }
    }
  }

  return null
}

/** If a session is already ON SCREEN — an open tile OR the one loaded in main —
 *  front its tab (and focus its zone) and report WHICH. A sidebar click on an
 *  already-open chat JUMPS to its tab instead of reloading it; `null` means the
 *  caller must load it into main. Covers the two dead clicks: an open tile, and
 *  the main session while focus sits on a tile (route unchanged → no reload).
 *  Callers that own the router need the `'main'` vs `'tile'` distinction: a
 *  `'main'` hit only reaches the screen if the workspace pane is actually
 *  showing the chat, whereas a tile renders in its own pane regardless. */
export function focusOpenSession(storedSessionId: string, profile?: null | string): 'main' | 'tile' | null {
  const tile = findSessionTile(storedSessionId, profile)

  if (tile) {
    const paneId = sessionTilePaneId(storedSessionId, tile.profile)
    revealTreePane(paneId) // un-dismiss + adopt + front in its group
    const tree = $layoutTree.get()
    const group = tree ? findGroupOfPane(tree, paneId) : null

    if (group) {
      noteActiveTreeGroup(group.id)
    }

    return 'tile'
  }

  // Already the main session: front the workspace tab and drop tile focus so
  // the readouts + sidebar highlight come home (a no-op when main is focused).
  if (
    storedSessionId === $selectedStoredSessionId.get() &&
    (profile == null || normalizeProfileKey(profile) === normalizeProfileKey($activeGatewayProfile.get()))
  ) {
    revealTreePane('workspace')
    noteActiveTreeGroup(null)

    return 'main'
  }

  return null
}

/** Does a sidebar click still need to navigate after `focusOpenSession`? A miss
 *  always does. A `'main'` hit does too while the workspace pane is showing a
 *  full page (artifacts, skills, …): fronting the workspace tab doesn't put the
 *  chat back on screen — only a route change back to the session does. A tile
 *  hit never does; its pane renders the chat regardless of the route. */
export function focusedSessionNeedsRoute(focused: 'main' | 'tile' | null, workspaceIsPage: boolean): boolean {
  return !focused || (focused === 'main' && workspaceIsPage)
}

/** The open tab that's still an empty "New session" draft, if there is one.
 *  That tab is the one the user would have typed into, so an open-from-nowhere
 *  spends it instead of stacking a second blank tab beside it. Most recent
 *  wins; a tile whose runtime hasn't bound (or whose state hasn't published) is
 *  unknown rather than empty, so it's left alone. */
export function blankDraftTile(
  tiles: readonly SessionTile[],
  states: Record<string, ClientSessionState>,
  profile?: null | string
): null | SessionTile {
  return (
    tiles.findLast(tile => {
      const runtimeId = tile.runtimeId
      const owner = profile == null ? null : normalizeProfileKey(profile)
      const state =
        runtimeId && (owner == null || normalizeProfileKey(tile.profile) === owner)
          ? sessionRuntimeState(states, profile, runtimeId)
          : undefined

      return Boolean(state && !state.busy && state.messages.length === 0)
    }) ?? null
  )
}

/** Hand an open blank draft tab over to `storedSessionId`, keeping its slot.
 *  False when there's no such tab, so the caller can fall back. The spent draft
 *  is DISCARDED rather than closed: it never held a conversation, so ⌘⇧T
 *  resurrecting it would just restore an empty tab. */
export function reuseBlankDraftTile(storedSessionId: string, ownerProfile?: string): boolean {
  const profile = normalizeProfileKey(ownerProfile ?? profileKey())
  const tile = blankDraftTile($sessionTiles.get(), $sessionStates.get(), profile)

  if (!tile || tile.storedSessionId === storedSessionId) {
    return false
  }

  discardSessionTile(tile.storedSessionId, tile.profile)
  openSessionTile(storedSessionId, tile.dir, tile.anchor, tile.before, profile)
  revealTreePane(sessionTilePaneId(storedSessionId, profile))

  return true
}

// Closed-tab stack for ⌘⇧T reopen (in-memory). Each entry carries its owner;
// reopening never re-resolves ownership from whichever profile is foreground.
const closedTiles: SessionTile[] = []

/**
 * Permanently discard one durable session identity after an authoritative
 * archive/delete succeeds. Unlike close this is not undoable: it removes the
 * tile and any older closed-tab entry, releases renderer-surface references,
 * clears durable retention, and force-drops every qualified runtime projection
 * even when it was busy. The backend mutation is the authority that the
 * conversation can no longer be resumed; retaining busy state here would let a
 * stale surface republish an archived/deleted runtime.
 *
 * Returns every runtime id discovered so the wiring-owned private cache and
 * auxiliary runtime stores can be purged through the same qualified identity.
 */
export function discardSessionIdentityState(profile: string, storedSessionId: string): string[] {
  const ownerProfile = normalizeProfileKey(profile)
  const durableKey = sessionDurableStateKey(ownerProfile, storedSessionId)
  const surfaceKey = sessionSurfaceKey(ownerProfile, storedSessionId)
  const runtimeIds = new Set<string>()
  const surfaceReference = sessionSurfaceReferences.get(surfaceKey)

  for (const runtimeKey of surfaceReference?.runtimeKeys ?? []) {
    const identity = sessionRuntimeStateIdentity(runtimeKey)

    if (identity.profile === ownerProfile) {
      runtimeIds.add(identity.runtimeSessionId)
    }
  }

  const tile = findSessionTile(storedSessionId, ownerProfile)

  if (tile?.runtimeId) {
    runtimeIds.add(tile.runtimeId)
  }

  for (const [runtimeKey, state] of Object.entries($sessionStates.get())) {
    const identity = sessionRuntimeStateIdentity(runtimeKey)

    if (identity.profile === ownerProfile && state.storedSessionId === storedSessionId) {
      runtimeIds.add(identity.runtimeSessionId)
    }
  }

  sessionSurfaceReferences.delete(surfaceKey)
  publishSessionSurfaceProfiles()
  settledExpiry.delete(durableKey)
  $stalledSessionIds.set($stalledSessionIds.get().filter(key => key !== durableKey))
  $unreadFinishedSessionIds.set($unreadFinishedSessionIds.get().filter(key => key !== durableKey))

  for (let index = closedTiles.length - 1; index >= 0; index -= 1) {
    const closed = closedTiles[index]!

    if (closed.storedSessionId === storedSessionId && normalizeProfileKey(closed.profile) === ownerProfile) {
      closedTiles.splice(index, 1)
    }
  }

  discardSessionTile(storedSessionId, ownerProfile)

  for (const runtimeId of runtimeIds) {
    dropSessionState(runtimeId, ownerProfile)
  }

  return [...runtimeIds]
}

export function closeSessionTile(storedSessionId: string, ownerProfile?: null | string) {
  const tile = findSessionTile(storedSessionId, ownerProfile)

  if (tile) {
    closedTiles.push({ anchor: tile.anchor, before: tile.before, dir: tile.dir, profile: tile.profile, storedSessionId })
  }

  saveTiles($sessionTiles.get().filter(t => !tileMatches(t, storedSessionId, ownerProfile)))

  // A settled session may never publish again, so the publish-time eviction
  // in publishSessionState can't reach it — drop its cached state here. A
  // BUSY one stays: its turn keeps streaming in the background, the sidebar
  // dot reads it, and settle evicts it. ⌘⇧T reopen re-publishes from the
  // wiring cache (resumeTile's warm path), so nothing is lost.
  const runtimeId = tile?.runtimeId
  const profile = tile?.profile
  const states = $sessionStates.get()
  const state = runtimeId ? sessionRuntimeState(states, profile, runtimeId) : undefined

  if (runtimeId && state && evictable(runtimeId, state, profile)) {
    dropSessionState(runtimeId, profile)
  }
}

/** Drop a DEAD tile — a persisted tile whose session no longer exists on the
 *  backend (resume 404s). Unlike close, it leaves no ⌘⇧T undo (resurrecting it
 *  would just 404 again) and evicts any cached state. This is what clears the
 *  "Session not found" resume spam from stale/cross-profile persisted tiles. */
export function discardSessionTile(storedSessionId: string, ownerProfile?: null | string) {
  const tile = findSessionTile(storedSessionId, ownerProfile)
  const runtimeId = tile?.runtimeId

  if (runtimeId) {
    dropSessionState(runtimeId, tile.profile)
  }

  saveTiles($sessionTiles.get().filter(t => !tileMatches(t, storedSessionId, ownerProfile)))
}

/** ⌘⇧T — reopen the most recently closed tab where it was, then focus it.
 *  Adoption alone is silent (won't steal the active tab), so restore has to
 *  front the pane explicitly. Skips ids that are live again (reopened / now
 *  the primary). */
export function reopenLastClosedTile(): void {
  for (let tile = closedTiles.pop(); tile; tile = closedTiles.pop()) {
    const { profile, storedSessionId } = tile

    if (
      storedSessionId === $selectedStoredSessionId.get() &&
      normalizeProfileKey(profile) === normalizeProfileKey($activeGatewayProfile.get())
    ) {
      continue
    }

    if (!findSessionTile(storedSessionId, profile)) {
      openSessionTile(storedSessionId, tile.dir, tile.anchor, tile.before, profile)
      focusOpenSession(storedSessionId, profile)

      return
    }
  }
}

// ---------------------------------------------------------------------------
// The FOCUSED session — one derivation, not another hand-maintained
// "$activeSession" sibling. The layout's interaction tracker ($activeTreeGroup:
// last click/focus, the same source ⌘W uses) resolves to a zone; its active
// pane names the session: a `session-tile:<storedId>` pane IS that session,
// anything else falls back to the route-driven primary. Chrome that should
// follow the user between tiles (titlebar session title, statusbar context /
// timer / model) reads these instead of the primary-only atoms.
// ---------------------------------------------------------------------------

/** Durable identity of the focused session. Qualified pane ids retain their
 * owner; workspace falls back to the active profile's primary selection. */
export const $focusedSessionIdentity = computed(
  [$activeGatewayProfile, $activeTreeGroup, $layoutTree, $selectedStoredSessionId],
  (activeProfile, groupId, tree, selected) => {
    const active = groupId && tree ? findGroup(tree, groupId)?.active : undefined
    const tileIdentity = active ? parseSessionTilePaneId(active) : null

    return tileIdentity?.profile
      ? { profile: tileIdentity.profile, storedSessionId: tileIdentity.storedSessionId }
      : selected
        ? { profile: normalizeProfileKey(activeProfile), storedSessionId: selected }
        : null
  }
)

/** Stored id of the focused session (the interacted zone's tile, else the
 *  primary's selection). Null on a fresh draft. */
export const $focusedStoredSessionId = computed($focusedSessionIdentity, identity => identity?.storedSessionId ?? null)

/** Live runtime id of the focused session (a tile's bound runtime, else the
 *  primary's active session). */
export const $focusedRuntimeId = computed(
  [$focusedSessionIdentity, $activeSessionId, $sessionTiles],
  (identity, primaryRuntime, tiles) => {
    if (!identity) {
      return primaryRuntime
    }

    const tile = tiles.find(t => tileMatches(t, identity.storedSessionId, identity.profile))

    return tile ? (tile.runtimeId ?? null) : primaryRuntime
  }
)

/** The focused session's state slice (undefined while unresolved/unbound). */
export const $focusedSessionState = computed(
  [$focusedSessionIdentity, $focusedRuntimeId, $sessionStates],
  (identity, runtimeId, states) =>
    runtimeId && identity ? sessionRuntimeState(states, identity.profile, runtimeId) : undefined
)

/** A PRIMARY navigation (sidebar resume, route change, new chat) homes focus to
 *  the workspace — UNLESS the selected id is already an open TILE, where
 *  `focusOpenSession` owns the move and homing would yank every stacked tile
 *  behind the workspace (A+B "disappear" when switching to C). */
export const selectionHomesToWorkspace = (
  selected: null | string,
  tiles: readonly SessionTile[],
  selectedProfile?: string
): boolean =>
  !(
    selected &&
    tiles.some(
      tile =>
        tile.storedSessionId === selected &&
        (selectedProfile === undefined || normalizeProfileKey(tile.profile) === normalizeProfileKey(selectedProfile))
    )
  )

// Cold-start restore is the one selection change that is NOT a navigation: the
// route already pointed at the primary session before the window loaded, and
// homing on it would front the workspace tab over the PERSISTED active tab —
// then persist that clobber, so the tab you reloaded on never comes back
// (⌘R always landing on main). use-route-resume arms this one-shot right
// before dispatching the boot resume; the very next selection change skips
// homing and the restored layout tree keeps its say.
let selectionRestoreInFlight = false

export function markSelectionRestore() {
  selectionRestoreInFlight = true
}

// Homing also FRONTS the workspace tab: the resumed chat loads in the workspace
// pane, so a zone parked on a tile tab must switch back or the click looks dead.
$selectedStoredSessionId.listen(selected => {
  const restoring = selectionRestoreInFlight
  selectionRestoreInFlight = false

  if (restoring || !selectionHomesToWorkspace(selected, $sessionTiles.get(), $activeGatewayProfile.get())) {
    return
  }

  noteActiveTreeGroup(null)
  revealTreePane('workspace')
})

// Dev hook for automation (mirrors __HERMES_LAYOUT_TREE__).
if ((import.meta.env.DEV || import.meta.env.VITE_PERF_PROBE === '1') && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__HERMES_SESSION_TILES__ = {
    close: closeSessionTile,
    drop: dropSessionState,
    open: openSessionTile,
    patch: patchSessionTile,
    publish: publishSessionState,
    /** Seed the recents list — models a populated sessions DB in perf runs. */
    seedSessions: (rows: SessionInfo[]) => setSessions(rows),
    sessions: () => $sessions.get(),
    states: () => $sessionStates.get(),
    tiles: () => $sessionTiles.get(),
    /** THE real gateway write path (wiring cache + journal + publish + view
     *  sync), unlike `publish` which only touches the store. Perf scenarios
     *  must drive this or they under-model streaming cost. */
    update: (runtimeId: string, updater: (state: ClientSessionState) => ClientSessionState) =>
      sessionTileDelegate()?.updateSession(runtimeId, updater)
  }
}
