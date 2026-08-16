import { useEffect } from 'react'

import { getLatestSessionMessages, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS } from '@/hermes'
import { toChatMessages } from '@/lib/chat-messages'
import { requestGatewayForProfile } from '@/store/gateway'
import { normalizeProfileKey } from '@/store/profile'
import {
  publishSessionState,
  sessionRuntimeStateKey,
  type SessionSurfaceIdentity,
  type SessionSurfaceRuntimeIdentity,
  setSessionTileDelegate,
  StaleSessionSurfaceRuntimeError
} from '@/store/session-states'
import type { SessionResumeResponse } from '@/types/hermes'

import type { usePromptActions } from '../../session/hooks/use-prompt-actions'
import { isSessionNotFoundError, withSessionNotFoundResume } from '../../session/hooks/use-prompt-actions/utils'
import { resolveSessionProfile } from '../../session/hooks/use-session-actions/utils'
import type { useSessionStateCache } from '../../session/hooks/use-session-state-cache'
import type { GatewayRequester } from '../types'

type SessionStateCache = ReturnType<typeof useSessionStateCache>

interface SessionTileDelegateParams {
  archiveSession: (storedSessionId: string, profile?: string) => Promise<unknown>
  branchStoredSession: (storedSessionId: string, profile?: string | null) => Promise<unknown>
  executeSlashCommand: ReturnType<typeof usePromptActions>['executeSlashCommand']
  removeSession: (storedSessionId: string, profile?: string) => Promise<unknown>
  requestGateway: GatewayRequester
  runtimeIdByStoredSessionIdRef: SessionStateCache['runtimeIdByStoredSessionIdRef']
  sessionStateByRuntimeIdRef: SessionStateCache['sessionStateByRuntimeIdRef']
  updateSessionState: SessionStateCache['updateSessionState']
}

type SessionSurfaceRuntimeReclaimer = (profile: string, runtimeId: string) => boolean

let activeSessionSurfaceRuntimeReclaimer: SessionSurfaceRuntimeReclaimer | null = null

/**
 * Evict a backend-reclaimed embedded runtime without activating or navigating
 * the primary chat. The profile gateway-event path calls this alongside its
 * public-state drop so the next SessionSurface mount must resume authoritatively.
 */
export function reclaimSessionSurfaceRuntime(profile: string, runtimeId: string): boolean {
  return activeSessionSurfaceRuntimeReclaimer?.(profile, runtimeId) ?? false
}

/**
 * Publishes the session-tile delegate: resume / submit / interrupt / slash for
 * tiled sessions WITHOUT touching the primary view ($activeSessionId /
 * $messages stay the main thread's). Resume reuses a live runtime binding when
 * one exists (incl. the main thread's own session); a cold tile binds +
 * hydrates the cache, which publishSessionState mirrors to the tile.
 */
export function useSessionTileDelegate({
  archiveSession,
  branchStoredSession,
  executeSlashCommand,
  removeSession,
  requestGateway,
  runtimeIdByStoredSessionIdRef,
  sessionStateByRuntimeIdRef,
  updateSessionState
}: SessionTileDelegateParams): void {
  useEffect(() => {
    const surfaceRuntimeByIdentity = new Map<string, string>()
    const surfaceKey = ({ profile, storedSessionId }: SessionSurfaceIdentity) =>
      `${normalizeProfileKey(profile)}\u0000${storedSessionId}`

    const discardSurface = ({ profile, storedSessionId }: SessionSurfaceIdentity): string[] => {
      const ownerProfile = normalizeProfileKey(profile)
      const identityKey = surfaceKey({ profile: ownerProfile, storedSessionId })
      const runtimeId = surfaceRuntimeByIdentity.get(identityKey)

      surfaceRuntimeByIdentity.delete(identityKey)
      runtimeIdByStoredSessionIdRef.current.delete(`${ownerProfile}\u0000${storedSessionId}`)

      if (runtimeId) {
        sessionStateByRuntimeIdRef.current.delete(sessionRuntimeStateKey(ownerProfile, runtimeId))
      }

      return runtimeId ? [runtimeId] : []
    }

    const discardStaleSurfaceRuntime = (identity: SessionSurfaceRuntimeIdentity) => {
      const key = surfaceKey(identity)

      if (surfaceRuntimeByIdentity.get(key) === identity.runtimeSessionId) {
        surfaceRuntimeByIdentity.delete(key)
      }
    }

    const reclaimSurfaceRuntime: SessionSurfaceRuntimeReclaimer = (profile, runtimeId) => {
      let evicted = sessionStateByRuntimeIdRef.current.delete(sessionRuntimeStateKey(profile, runtimeId))
      const profilePrefix = `${profile}\u0000`

      for (const [identityKey, mappedRuntimeId] of surfaceRuntimeByIdentity) {
        if (identityKey.startsWith(profilePrefix) && mappedRuntimeId === runtimeId) {
          surfaceRuntimeByIdentity.delete(identityKey)
          evicted = true
        }
      }

      return evicted
    }

    activeSessionSurfaceRuntimeReclaimer = reclaimSurfaceRuntime

    // A tile's runtime binding can die the same way the foreground's does
    // (sleep/wake, backend restart). The cache maps stored -> runtime, so walk
    // it backwards to find the durable id this runtime belongs to.
    const storedSessionIdForRuntime = (runtimeId: string): null | string => {
      const cached = sessionStateByRuntimeIdRef.current.get(runtimeId)?.storedSessionId

      if (cached) {
        return cached
      }

      for (const [storedId, mapped] of runtimeIdByStoredSessionIdRef.current) {
        if (mapped === runtimeId) {
          return storedId
        }
      }

      return null
    }

    // Repoint the stored -> runtime mapping at the recovered id so subsequent
    // tile actions use the live binding instead of re-recovering every call.
    const rebindTileRuntime = (deadRuntimeId: string) => (recoveredId: string) => {
      const storedId = storedSessionIdForRuntime(deadRuntimeId)

      if (storedId) {
        runtimeIdByStoredSessionIdRef.current.set(storedId, recoveredId)
      }
    }

    const resumeSurface = async ({ profile, storedSessionId }: SessionSurfaceIdentity) => {
      if (!profile.trim()) {
        throw new Error('SessionSurface requires an explicit profile')
      }

      const surfaceRuntime = surfaceRuntimeByIdentity.get(surfaceKey({ profile, storedSessionId }))

      const cached = surfaceRuntime
        ? sessionStateByRuntimeIdRef.current.get(sessionRuntimeStateKey(profile, surfaceRuntime))
        : undefined

      if (surfaceRuntime && cached?.storedSessionId === storedSessionId) {
        publishSessionState(surfaceRuntime, cached, profile)

        return surfaceRuntime
      }

      const [prefetch, resumed] = await Promise.all([
        getLatestSessionMessages(storedSessionId, profile).catch(() => null),
        requestGatewayForProfile<SessionResumeResponse>(profile, 'session.resume', {
          session_id: storedSessionId,
          cols: 96,
          omit_messages: true,
          profile
        })
      ])

      const runtimeId = resumed?.session_id

      if (!runtimeId) {
        throw new Error('resume returned no session id')
      }

      surfaceRuntimeByIdentity.set(surfaceKey({ profile, storedSessionId }), runtimeId)
      updateSessionState(
        runtimeId,
        state => ({
          ...state,
          busy: Boolean(resumed?.info?.running),
          messages: state.messages.length > 0 ? state.messages : toChatMessages(prefetch?.messages ?? resumed?.messages ?? [])
        }),
        storedSessionId,
        profile
      )

      return runtimeId
    }

    setSessionTileDelegate({
      adoptSurface: async (identity: SessionSurfaceRuntimeIdentity) => {
        if (!identity.profile.trim()) {
          throw new Error('SessionSurface requires an explicit profile')
        }

        let status: { output?: string }

        try {
          status = await requestGatewayForProfile<{ output?: string }>(identity.profile, 'session.status', {
            session_id: identity.runtimeSessionId
          })
        } catch (error) {
          if (isSessionNotFoundError(error)) {
            discardStaleSurfaceRuntime(identity)
            throw new StaleSessionSurfaceRuntimeError('Session surface runtime hint was not found')
          }

          throw error
        }

        const authoritativeStoredId = status.output
          ?.split('\n')
          .find(line => line.startsWith('Session ID: '))
          ?.slice('Session ID: '.length)
          .trim()

        if (authoritativeStoredId !== identity.storedSessionId) {
          discardStaleSurfaceRuntime(identity)
          throw new StaleSessionSurfaceRuntimeError('Session surface identity mismatch')
        }

        surfaceRuntimeByIdentity.set(surfaceKey(identity), identity.runtimeSessionId)

        const cached = sessionStateByRuntimeIdRef.current.get(
          sessionRuntimeStateKey(identity.profile, identity.runtimeSessionId)
        )

        updateSessionState(
          identity.runtimeSessionId,
          state =>
            cached?.storedSessionId === identity.storedSessionId
              ? { ...state }
              : { ...state, messages: [], streamId: null, busy: false, awaitingResponse: false },
          identity.storedSessionId,
          identity.profile
        )

        return identity.runtimeSessionId
      },
      archiveSession: async (storedSessionId, profile) => {
        await archiveSession(storedSessionId, profile)
        if (profile) {
          discardSurface({ profile, storedSessionId })
        }
      },
      branchSession: async (storedSessionId, profile) => {
        await branchStoredSession(storedSessionId, profile)
      },
      deleteSession: async (storedSessionId, profile) => {
        await removeSession(storedSessionId, profile)
        if (profile) {
          discardSurface({ profile, storedSessionId })
        }
      },
      discardSurface,
      executeSlash: async (rawCommand, sessionId) => {
        await executeSlashCommand(rawCommand, { sessionId })
      },
      interruptSession: async runtimeId => {
        await withSessionNotFoundResume(
          runtimeId,
          storedSessionIdForRuntime(runtimeId),
          liveId => requestGateway('session.interrupt', { session_id: liveId }),
          { requestGateway, onRecovered: rebindTileRuntime(runtimeId) }
        )
      },
      resumeSurface,
      resumeTile: async (storedSessionId, explicitProfile) => {
        const profile = explicitProfile ?? (await resolveSessionProfile(storedSessionId))

        if (!profile) {
          throw new Error('Session surface profile unavailable')
        }

        return resumeSurface({ profile, storedSessionId })
      },
      submitToSession: async (runtimeId, text) => {
        await withSessionNotFoundResume(
          runtimeId,
          storedSessionIdForRuntime(runtimeId),
          liveId => requestGateway('prompt.submit', { session_id: liveId, text }, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS),
          { requestGateway, onRecovered: rebindTileRuntime(runtimeId) }
        )
      },
      updateSession: (runtimeId, updater, profile) => updateSessionState(runtimeId, updater, undefined, profile)
    })

    return () => {
      if (activeSessionSurfaceRuntimeReclaimer === reclaimSurfaceRuntime) {
        activeSessionSurfaceRuntimeReclaimer = null
      }
    }
  }, [
    archiveSession,
    branchStoredSession,
    executeSlashCommand,
    removeSession,
    requestGateway,
    runtimeIdByStoredSessionIdRef,
    sessionStateByRuntimeIdRef,
    updateSessionState
  ])
}
