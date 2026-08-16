import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { $activeGatewayProfile } from '@/store/profile'
import { $activeSessionId, $busy, $currentModel, $messages } from '@/store/session'
import { $sessionStates, dropSessionState, publishSessionState, sessionRuntimeStateKey } from '@/store/session-states'

import { PRIMARY_SESSION_VIEW, primarySessionState } from './session-view'

const message = (id: string, text: string) => ({
  id,
  parts: [{ type: 'text' as const, text }],
  role: 'assistant' as const
})

const stateWith = (runtimeId: string, text: string, busy: boolean) => ({
  ...createClientSessionState(`stored-${runtimeId}`),
  messages: [message(`${runtimeId}-msg`, text)],
  busy
})

/**
 * The workspace pane is just the first tab: it renders from the active
 * session's own `$sessionStates` slice, exactly like a ⌘T tile.
 *
 * The regression this guards: the pane used to render straight off the global
 * `$messages`/`$busy` atoms — a mirror of whichever session was active. With
 * two turns in flight, navigating away from a still-streaming session left it
 * painting into the surface now showing a different conversation.
 */
describe('primary session view reads its own session slice', () => {
  beforeEach(() => {
    $sessionStates.set({})
    $activeGatewayProfile.set('default')
    $activeSessionId.set(null)
    $messages.set([])
    $busy.set(false)
    $currentModel.set('')
  })

  afterEach(cleanup)

  it('shows the active session transcript, not a background session still streaming', () => {
    publishSessionState('runtime-background', stateWith('runtime-background', 'background turn', true), 'default')
    publishSessionState('runtime-foreground', stateWith('runtime-foreground', 'foreground turn', false), 'default')

    $activeSessionId.set('runtime-foreground')

    expect(PRIMARY_SESSION_VIEW.$messages.get()).toEqual([message('runtime-foreground-msg', 'foreground turn')])
    expect(PRIMARY_SESSION_VIEW.$busy.get()).toBe(false)
  })

  it('ignores a background session that keeps streaming after the user switches away', () => {
    publishSessionState('runtime-a', stateWith('runtime-a', 'session A turn', true), 'default')
    $activeSessionId.set('runtime-b')
    publishSessionState('runtime-b', stateWith('runtime-b', 'session B turn', false), 'default')

    // Session A streams on: another delta lands for the session the user left.
    publishSessionState(
      'runtime-a',
      {
        ...stateWith('runtime-a', 'session A turn', true),
        messages: [message('runtime-a-msg', 'session A turn'), message('runtime-a-late', 'late delta')]
      },
      'default'
    )

    expect(PRIMARY_SESSION_VIEW.$messages.get()).toEqual([message('runtime-b-msg', 'session B turn')])
    expect(PRIMARY_SESSION_VIEW.$lastVisibleIsUser.get()).toBe(false)
    expect(PRIMARY_SESSION_VIEW.$busy.get()).toBe(false)
  })

  it('does not borrow naked runtime state when the active profile projection is absent', () => {
    const legacyState = {
      ...stateWith('shared-runtime', 'profile A secret transcript', true),
      model: 'profile-a/private-model'
    }

    $sessionStates.set({ 'shared-runtime': legacyState })
    $messages.set([message('draft-a', 'profile A mirrored transcript')])
    $busy.set(true)
    $currentModel.set('profile-a/private-model')
    $activeGatewayProfile.set('profile-b')
    $activeSessionId.set('shared-runtime')

    expect(PRIMARY_SESSION_VIEW.profile).toBe('profile-b')
    expect(PRIMARY_SESSION_VIEW.$messages.get()).toEqual([])
    expect(PRIMARY_SESSION_VIEW.$busy.get()).toBe(false)
    expect(PRIMARY_SESSION_VIEW.$model.get()).toBe('')
    expect($sessionStates.get()['shared-runtime']).toBe(legacyState)
  })

  it('uses the active profile projection when the naked runtime id collides', () => {
    const legacyState = {
      ...stateWith('shared-runtime', 'profile A secret transcript', true),
      model: 'profile-a/private-model'
    }

    const profileBState = {
      ...stateWith('shared-runtime', 'profile B transcript', false),
      model: 'profile-b/model'
    }

    $sessionStates.set({
      'shared-runtime': legacyState,
      [sessionRuntimeStateKey('profile-b', 'shared-runtime')]: profileBState
    })
    $activeGatewayProfile.set('profile-b')
    $activeSessionId.set('shared-runtime')

    expect(PRIMARY_SESSION_VIEW.$messages.get()).toEqual([message('shared-runtime-msg', 'profile B transcript')])
    expect(PRIMARY_SESSION_VIEW.$busy.get()).toBe(false)
    expect(PRIMARY_SESSION_VIEW.$model.get()).toBe('profile-b/model')
  })

  it('keeps explicit default distinct from a legacy unprofiled runtime', () => {
    const legacyState = {
      ...stateWith('shared-runtime', 'legacy transcript', true),
      model: 'legacy/private-model'
    }

    $sessionStates.set({ 'shared-runtime': legacyState })
    $activeGatewayProfile.set('default')
    $activeSessionId.set('shared-runtime')

    expect(primarySessionState($sessionStates.get(), 'shared-runtime')).toBe(legacyState)
    expect(PRIMARY_SESSION_VIEW.$messages.get()).toEqual([])
    expect(PRIMARY_SESSION_VIEW.$busy.get()).toBe(false)
    expect(PRIMARY_SESSION_VIEW.$model.get()).toBe('')
  })

  it('falls back to the draft atoms while the chat has no runtime session yet', () => {
    $messages.set([message('draft-msg', 'unsent draft')])
    $busy.set(true)

    expect(PRIMARY_SESSION_VIEW.$runtimeId.get()).toBeNull()
    expect(PRIMARY_SESSION_VIEW.$messages.get()).toEqual([message('draft-msg', 'unsent draft')])
    expect(PRIMARY_SESSION_VIEW.$busy.get()).toBe(true)
    expect(PRIMARY_SESSION_VIEW.$messagesEmpty.get()).toBe(false)
  })

  it('uses empty owned state when the active profile projection is dropped', () => {
    publishSessionState('runtime-a', stateWith('runtime-a', 'session A turn', true), 'default')
    $activeSessionId.set('runtime-a')

    expect(PRIMARY_SESSION_VIEW.$messages.get()).toEqual([message('runtime-a-msg', 'session A turn')])

    $messages.set([message('stale-draft', 'stale mirrored transcript')])
    $busy.set(true)
    dropSessionState('runtime-a', 'default')

    expect(PRIMARY_SESSION_VIEW.$messages.get()).toEqual([])
    expect(PRIMARY_SESSION_VIEW.$busy.get()).toBe(false)
    expect(PRIMARY_SESSION_VIEW.$messagesEmpty.get()).toBe(true)
  })
})
