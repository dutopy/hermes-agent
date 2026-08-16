import type { ConnectionState } from '@hermes/shared'
import { computed, type ReadableAtom } from 'nanostores'
import { createContext, useContext } from 'react'

import type { ClientSessionState } from '@/app/types'
import type { ChatMessage } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $activeSessionId,
  $awaitingResponse,
  $busy,
  $currentCwd,
  $currentFastMode,
  $currentModel,
  $currentProvider,
  $currentReasoningEffort,
  $gatewayState,
  $messages,
  $selectedStoredSessionId
} from '@/store/session'
import { $sessionStates, sessionRuntimeState } from '@/store/session-states'

import { lastVisibleMessageIsUser } from './thread-loading'

/**
 * SESSION VIEW — the store surface a ChatView renders from. Every session,
 * including the one in the workspace pane, renders from ITS OWN slice of
 * `$sessionStates`. The workspace pane is just the first tab: a session
 * surface with no privileged state of its own.
 *
 * That symmetry is load-bearing. The pane used to render off the global
 * `$messages`/`$busy` atoms — a mirror of whichever session was active — so
 * with two turns in flight (⌘T tabs made that routine), navigating away from
 * a still-streaming session left it painting into the surface now showing a
 * different conversation. Reading the per-session slice makes that
 * structurally impossible rather than merely guarded.
 *
 * The global atoms stay the DRAFT surface: a new chat has no runtime id, and
 * therefore no slice, until its first turn creates one.
 *
 * Everything is atoms (not values) so subscription granularity survives:
 * ChatView subscribes only to the coarse edges; `$messages` stays boundary-
 * only exactly like the primary view's perf contract.
 */
export interface SessionView {
  kind: 'primary' | 'tile'
  /** Explicit owner for embedded surfaces; absent preserves primary-chat legacy routing. */
  profile?: string
  $runtimeId: ReadableAtom<string | null>
  $storedId: ReadableAtom<string | null>
  $messages: ReadableAtom<ChatMessage[]>
  $busy: ReadableAtom<boolean>
  $awaitingResponse: ReadableAtom<boolean>
  $messagesEmpty: ReadableAtom<boolean>
  $lastVisibleIsUser: ReadableAtom<boolean>
  $cwd: ReadableAtom<string>
  $model: ReadableAtom<string>
  $provider: ReadableAtom<string>
  $fast: ReadableAtom<boolean>
  /** Connection readiness for this view's owning profile. Embedded surfaces
   * must not inherit the foreground gateway's reconnect state. */
  $gatewayState: ReadableAtom<ConnectionState>
  $reasoningEffort: ReadableAtom<string>
}

/** Resolve a primary runtime without weakening an explicit ownership claim.
 * Omission is the only legacy path that may address a naked runtime key. */
export function primarySessionState(
  states: Record<string, ClientSessionState>,
  runtimeId: null | string,
  profile?: string
): ClientSessionState | undefined {
  if (!runtimeId) {
    return undefined
  }

  return profile == null
    ? sessionRuntimeState(states, undefined, runtimeId)
    : (sessionRuntimeState(states, profile, runtimeId) ?? createClientSessionState())
}

/** The active session's explicitly profile-owned slice, or `undefined` while it's a draft. */
const $primaryState = computed(
  [$activeSessionId, $activeGatewayProfile, $sessionStates],
  (runtimeId, profile, states) => primarySessionState(states, runtimeId, profile)
)

/**
 * Read one field from the active session's slice, falling back to the global
 * draft atom while no runtime exists yet. Once a session HAS a slice, that
 * slice is authoritative — a background session publishing its own state can
 * never reach this view.
 */
function primaryField<T>(select: (state: ClientSessionState) => T, $draft: ReadableAtom<T>): ReadableAtom<T> {
  const $field: ReadableAtom<T> = computed([$primaryState, $draft], (state, draft: T) =>
    state ? select(state) : draft
  )

  return $field
}

const $primaryMessages = primaryField<ChatMessage[]>(state => state.messages, $messages)

export const PRIMARY_SESSION_VIEW: SessionView = {
  kind: 'primary',
  get profile() {
    return $activeGatewayProfile.get()
  },
  $awaitingResponse: primaryField<boolean>(state => state.awaitingResponse, $awaitingResponse),
  $busy: primaryField<boolean>(state => state.busy, $busy),
  $cwd: primaryField<string>(state => state.cwd, $currentCwd),
  $fast: primaryField<boolean>(state => state.fast, $currentFastMode),
  $gatewayState,
  $lastVisibleIsUser: computed($primaryMessages, lastVisibleMessageIsUser),
  $messages: $primaryMessages,
  $messagesEmpty: computed($primaryMessages, messages => messages.length === 0),
  $model: primaryField<string>(state => state.model, $currentModel),
  $provider: primaryField<string>(state => state.provider, $currentProvider),
  $reasoningEffort: primaryField<string>(state => state.reasoningEffort, $currentReasoningEffort),
  $runtimeId: $activeSessionId,
  $storedId: $selectedStoredSessionId
}

const SessionViewContext = createContext<SessionView>(PRIMARY_SESSION_VIEW)

export const SessionViewProvider = SessionViewContext.Provider

export const useSessionView = (): SessionView => useContext(SessionViewContext)
