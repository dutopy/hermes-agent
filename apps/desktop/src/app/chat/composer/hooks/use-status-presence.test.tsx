import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { $composerActionsBySession } from '@/store/composer-actions'
import { $previewStatusBySession } from '@/store/preview-status'

import { useSessionStatusPresence } from './use-status-presence'

describe('useSessionStatusPresence profile isolation', () => {
  beforeEach(() => {
    $composerActionsBySession.set({})
    $previewStatusBySession.set({})
  })

  afterEach(() => {
    cleanup()
    $composerActionsBySession.set({})
    $previewStatusBySession.set({})
  })

  it('does not expose naked legacy presence to an explicitly profiled runtime collision', () => {
    $composerActionsBySession.set({
      shared: [{ id: 'legacy-a', label: 'Legacy A', run: () => undefined }]
    })

    const legacy = renderHook(() => useSessionStatusPresence('shared'))
    const profileB = renderHook(() => useSessionStatusPresence('shared', 'b'))

    expect(legacy.result.current).toBe(true)
    expect(profileB.result.current).toBe(false)
    expect($composerActionsBySession.get().shared).toHaveLength(1)
  })
})
