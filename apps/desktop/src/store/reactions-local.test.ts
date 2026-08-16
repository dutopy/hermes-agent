import { afterEach, describe, expect, it } from 'vitest'

import {
  $agentReactions,
  $localReactions,
  agentReactionOverlay,
  localReactionOverlay,
  recordAgentReaction,
  setLocalReaction
} from './reactions-local'

const reaction = (emoji: string) => [{ at: 1, author: 'agent' as const, emoji }]

describe('profile-qualified live agent reaction overlays', () => {
  afterEach(() => {
    $agentReactions.set({})
    $localReactions.set({})
  })

  it('isolates homonymous durable rows by profile and conversation', () => {
    recordAgentReaction(7, reaction('👍'), 'profile-a', 'stored-same')
    recordAgentReaction(7, reaction('👀'), 'profile-b', 'stored-same')
    recordAgentReaction(7, reaction('🎉'), 'profile-b', 'stored-other')

    expect(agentReactionOverlay($agentReactions.get(), 7, 'profile-a', 'stored-same')).toEqual(reaction('👍'))
    expect(agentReactionOverlay($agentReactions.get(), 7, 'profile-b', 'stored-same')).toEqual(reaction('👀'))
    expect(agentReactionOverlay($agentReactions.get(), 7, 'profile-b', 'stored-other')).toEqual(reaction('🎉'))
  })

  it('preserves the legacy row-only overlay when scope is omitted', () => {
    recordAgentReaction(7, reaction('👍'))

    expect(agentReactionOverlay($agentReactions.get(), 7)).toEqual(reaction('👍'))
  })

  it('isolates optimistic user paint by profile, conversation, and message row', () => {
    setLocalReaction('same-message', '👍', { profile: 'profile-a', rowId: 7, storedSessionId: 'stored-same' })
    setLocalReaction('same-message', '👀', { profile: 'profile-b', rowId: 7, storedSessionId: 'stored-same' })
    setLocalReaction('same-message', '🎉', { profile: 'profile-b', rowId: 7, storedSessionId: 'stored-other' })

    expect(localReactionOverlay($localReactions.get(), 'same-message', { profile: 'profile-a', rowId: 7, storedSessionId: 'stored-same' })?.[0]?.emoji).toBe('👍')
    expect(localReactionOverlay($localReactions.get(), 'same-message', { profile: 'profile-b', rowId: 7, storedSessionId: 'stored-same' })?.[0]?.emoji).toBe('👀')
    expect(localReactionOverlay($localReactions.get(), 'same-message', { profile: 'profile-b', rowId: 7, storedSessionId: 'stored-other' })?.[0]?.emoji).toBe('🎉')
  })

  it('keeps the naked message key only for an explicitly unscoped legacy caller', () => {
    setLocalReaction('same-message', '❤️')

    expect(localReactionOverlay($localReactions.get(), 'same-message')?.[0]?.emoji).toBe('❤️')
    expect(localReactionOverlay($localReactions.get(), 'same-message', { profile: 'profile-b', rowId: 7, storedSessionId: 'stored' })).toBeUndefined()
  })
})
