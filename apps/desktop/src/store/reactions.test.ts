import { atom } from 'nanostores'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'
import { applyReaction, QUICK_REACTIONS, toggleMessageReaction } from '@/store/reactions'
import type { MessageReaction } from '@/types/hermes'

const { activeRequest, ownerRequest } = vi.hoisted(() => ({
  activeRequest: vi.fn(),
  ownerRequest: vi.fn()
}))

vi.mock('@/store/gateway', () => ({
  activeGateway: () => ({ request: activeRequest }),
  gatewayForProfile: (profile: string) => (profile === 'profile-b' ? { request: ownerRequest } : null)
}))

const at = 1_700_000_000

beforeEach(() => {
  activeRequest.mockReset()
  ownerRequest.mockReset()
  ownerRequest.mockResolvedValue({ row_id: 7, reactions: [] })
})

function reaction(emoji: string, author: MessageReaction['author']): MessageReaction {
  return { emoji, author, at }
}

describe('applyReaction', () => {
  it('adds a reaction to an empty message', () => {
    expect(applyReaction(undefined, '❤️', 'user')).toMatchObject([{ emoji: '❤️', author: 'user' }])
  })

  it('replaces the same author’s existing reaction (one per author)', () => {
    const next = applyReaction([reaction('❤️', 'user')], '😂', 'user')

    expect(next).toHaveLength(1)
    expect(next[0].emoji).toBe('😂')
  })

  it('retracts when the live reaction is re-sent', () => {
    expect(applyReaction([reaction('👍', 'user')], '👍', 'user')).toEqual([])
  })

  it('clears on an explicit null', () => {
    expect(applyReaction([reaction('👍', 'user')], null, 'user')).toEqual([])
  })

  it('keeps authors independent', () => {
    const next = applyReaction([reaction('🔥', 'agent')], '❤️', 'user')

    expect(next.map(r => r.author).sort()).toEqual(['agent', 'user'])
  })

  it('retracting one author leaves the other intact', () => {
    const next = applyReaction([reaction('🔥', 'agent'), reaction('❤️', 'user')], null, 'user')

    expect(next).toMatchObject([{ emoji: '🔥', author: 'agent' }])
  })

  it('never mutates the input array', () => {
    const before = [reaction('❤️', 'user')]
    const snapshot = [...before]

    applyReaction(before, '😂', 'user')

    expect(before).toEqual(snapshot)
  })
})

describe('QUICK_REACTIONS', () => {
  it('is the six iOS Tapback defaults, each distinct', () => {
    expect(QUICK_REACTIONS).toHaveLength(6)
    expect(new Set(QUICK_REACTIONS).size).toBe(6)
  })
})

describe('toggleMessageReaction ownership', () => {
  it('routes a surface reaction through its owner requester and owner runtime/messages', async () => {
    const ownerMessages = atom<ChatMessage[]>([
      { id: 'same-message', parts: [], role: 'assistant', rowId: 7, reactions: [] }
    ])

    await toggleMessageReaction(ownerMessages.get()[0], '👍', 'user', {
      messages: ownerMessages,
      profile: 'profile-b',
      runtimeSessionId: 'shared-runtime',
      storedSessionId: 'same-stored',
      writeMessages: updater => ownerMessages.set(updater(ownerMessages.get()))
    })

    expect(ownerRequest).toHaveBeenCalledWith(
      'message.react',
      expect.objectContaining({ session_id: 'shared-runtime', row_id: 7 })
    )
    expect(activeRequest).not.toHaveBeenCalled()
  })
})
