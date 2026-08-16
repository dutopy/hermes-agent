import { cleanup, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, describe, expect, it } from 'vitest'

import { type SessionView, SessionViewProvider } from '@/app/chat/session-view'
import { sessionRuntimeStateKey } from '@/store/session-states'
import { $subagentsBySession, type SubagentProgress } from '@/store/subagents'

import { DelegateTool } from './delegate'

const progress = (activity: string, model: string): SubagentProgress => ({
  filesRead: [],
  filesWritten: [],
  goal: 'Shared child',
  id: model,
  model,
  parentId: null,
  startedAt: 0,
  status: 'running',
  stream: [{ at: 1, kind: 'progress', text: activity }],
  taskCount: 1,
  taskIndex: 0,
  updatedAt: 0
})

afterEach(() => {
  cleanup()
  $subagentsBySession.set({})
})

describe('DelegateTool profile ownership', () => {
  it('renders only the owning profile slice when runtime ids collide', () => {
    const runtimeId = 'shared-runtime'
    $subagentsBySession.set({
      [runtimeId]: [progress('Legacy profile A activity', 'model-a')],
      [sessionRuntimeStateKey('profile-b', runtimeId)]: [progress('Profile B activity', 'model-b')]
    })

    const view = {
      ...({} as SessionView),
      $runtimeId: atom<null | string>(runtimeId),
      kind: 'tile',
      profile: 'profile-b'
    } satisfies SessionView

    render(
      <SessionViewProvider value={view}>
        <DelegateTool args={{ goal: 'Shared child' }} result={undefined} toolCallId="call-1" />
      </SessionViewProvider>
    )

    expect(screen.getByText('Profile B activity')).toBeTruthy()
    expect(screen.queryByText('Legacy profile A activity')).toBeNull()
  })
})
