import { afterEach, describe, expect, it } from 'vitest'

import { clearAllPrompts, setApprovalRequest } from '@/store/prompts'

import { composerBlockingPrompt, type ComposerScope } from './scope'

afterEach(() => clearAllPrompts())

describe('composerBlockingPrompt', () => {
  it('selects the blocking prompt owned by the composer profile', () => {
    setApprovalRequest({ command: 'legacy', description: 'profile A', sessionId: 'shared-runtime' })
    setApprovalRequest({
      command: 'owned',
      description: 'profile B',
      profile: 'profile-b',
      sessionId: 'shared-runtime'
    })

    const scoped = composerBlockingPrompt('shared-runtime', { profile: 'profile-b' } as ComposerScope)
    const other = composerBlockingPrompt('shared-runtime', { profile: 'profile-c' } as ComposerScope)

    expect(scoped.get()).toBe(true)
    expect(other.get()).toBe(false)
  })
})
