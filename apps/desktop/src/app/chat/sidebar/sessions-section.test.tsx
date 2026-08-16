import { cleanup, render } from '@testing-library/react'
import type * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'

import { SidebarSessionsSection, VIRTUALIZE_THRESHOLD } from './sessions-section'
import type { VirtualSessionListProps } from './virtual-session-list'

afterEach(cleanup)

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        dateDivider: {
          earlierThisMonth: 'Earlier this month',
          lastMonth: 'Last month',
          lastWeek: 'Last week',
          older: 'Older',
          today: 'Today',
          yesterday: 'Yesterday'
        }
      }
    }
  })
}))

const mockVirtualListPropsHistory: VirtualSessionListProps[] = []
const mockSortableIds: string[] = []

const mockSessionRowPropsHistory: Array<{
  onArchive: () => void
  onBranch?: () => void
  onDelete: () => void
  onPin: () => void
  onResume: () => void
  session: SessionInfo
}> = []

vi.mock('./virtual-session-list', () => ({
  VirtualSessionList: (props: VirtualSessionListProps) => {
    mockVirtualListPropsHistory.push(props)

    return <div data-testid="virtual-session-list">Virtual List ({props.rows.length} rows)</div>
  }
}))

vi.mock('./reorderable-list', () => ({
  ReorderableList: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortableBindings: (id: string) => {
    mockSortableIds.push(id)

    return {}
  }
}))

vi.mock('./session-row', () => ({
  SidebarSessionRow: (props: (typeof mockSessionRowPropsHistory)[number]) => {
    mockSessionRowPropsHistory.push(props)

    return <div data-testid={`session-row-${props.session.profile}-${props.session.id}`}>{props.session.id}</div>
  }
}))

function makeSession(id: string, startedAt = 1000): SessionInfo {
  return {
    handoff_platform: null,
    handoff_state: null,
    id,
    last_active: startedAt,
    profile: 'default',
    started_at: startedAt
  } as unknown as SessionInfo
}

function generateSessions(count: number): SessionInfo[] {
  return Array.from({ length: count }, (_, i) => makeSession(`session-${i + 1}`, 10000 - i * 100))
}

function makeProfileSession(profile: string): SessionInfo {
  return { ...makeSession('same'), profile }
}

const noop = () => {}

describe('SidebarSessionsSection action ownership', () => {
  it('renders homonymous rows from different profiles', () => {
    mockSessionRowPropsHistory.length = 0

    render(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={<div>Empty</div>}
        label="Sessions"
        onArchiveSession={noop}
        onDeleteSession={noop}
        onResumeSession={noop}
        onToggle={noop}
        onTogglePin={noop}
        open
        pinned={false}
        sessions={[makeProfileSession('profile-a'), makeProfileSession('profile-b')]}
      />
    )

    expect(mockSessionRowPropsHistory.map(props => props.session.profile)).toEqual(['profile-a', 'profile-b'])
  })

  it('emits the clicked row profile for archive, delete, branch, pin, and reopen when stored ids collide', () => {
    mockSessionRowPropsHistory.length = 0
    const onArchiveSession = vi.fn()
    const onBranchSession = vi.fn()
    const onDeleteSession = vi.fn()
    const onResumeSession = vi.fn()
    const onTogglePin = vi.fn()

    render(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={<div>Empty</div>}
        label="Sessions"
        onArchiveSession={onArchiveSession}
        onBranchSession={onBranchSession}
        onDeleteSession={onDeleteSession}
        onResumeSession={onResumeSession}
        onToggle={noop}
        onTogglePin={onTogglePin}
        open
        pinned={false}
        sessions={[makeProfileSession('profile-a'), makeProfileSession('profile-b')]}
      />
    )

    const rowB = mockSessionRowPropsHistory.find(props => props.session.profile === 'profile-b')
    expect(rowB).toBeDefined()

    rowB!.onArchive()
    rowB!.onDelete()
    rowB!.onBranch?.()
    rowB!.onPin()
    rowB!.onResume()

    expect(onArchiveSession).toHaveBeenCalledWith('same', 'profile-b')
    expect(onDeleteSession).toHaveBeenCalledWith('same', 'profile-b')
    expect(onBranchSession).toHaveBeenCalledWith('same', 'profile-b')
    expect(onTogglePin).toHaveBeenCalledWith('same', 'profile-b')
    expect(onResumeSession).toHaveBeenCalledWith('same', 'profile-b')
    expect(onArchiveSession).not.toHaveBeenCalledWith('same', 'profile-a')
    expect(onDeleteSession).not.toHaveBeenCalledWith('same', 'profile-a')
  })

  it('keeps sortable row identities unique when pinned stored ids collide across profiles', () => {
    mockSortableIds.length = 0

    render(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={null}
        label="Pinned"
        onArchiveSession={noop}
        onDeleteSession={noop}
        onReorderSessions={noop}
        onResumeSession={noop}
        onToggle={noop}
        onTogglePin={noop}
        open
        pinned
        sessions={[makeProfileSession('profile-a'), makeProfileSession('profile-b')]}
        sortable
      />
    )

    expect(mockSortableIds).toEqual(['profile-a\u0000same', 'profile-b\u0000same'])
  })
})

describe('SidebarSessionsSection memoization & virtualizer stability', () => {
  it('memoizes flatRows and passes the exact same rows array reference across parent re-renders', () => {
    mockVirtualListPropsHistory.length = 0

    const sessions = generateSessions(VIRTUALIZE_THRESHOLD + 5)

    const { rerender } = render(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={<div>Empty</div>}
        label="Sessions"
        onArchiveSession={noop}
        onDeleteSession={noop}
        onResumeSession={noop}
        onToggle={noop}
        onTogglePin={noop}
        open={true}
        pinned={false}
        sessions={sessions}
      />
    )

    expect(mockVirtualListPropsHistory.length).toBe(1)
    const initialRowsRef = mockVirtualListPropsHistory[0].rows
    expect(initialRowsRef.length).toBeGreaterThan(VIRTUALIZE_THRESHOLD)

    // Re-render parent with the exact same sessions array and props
    rerender(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={<div>Empty</div>}
        label="Sessions"
        onArchiveSession={noop}
        onDeleteSession={noop}
        onResumeSession={noop}
        onToggle={noop}
        onTogglePin={noop}
        open={true}
        pinned={false}
        sessions={sessions}
      />
    )

    expect(mockVirtualListPropsHistory.length).toBe(2)
    const nextRowsRef = mockVirtualListPropsHistory[1].rows

    // Confirm that the flatRows array reference remains strictly identical across renders (useMemo proof)
    expect(nextRowsRef).toBe(initialRowsRef)
  })

  it('re-computes flatRows reference when grouping or sessions change', () => {
    mockVirtualListPropsHistory.length = 0

    const initialSessions = generateSessions(VIRTUALIZE_THRESHOLD + 2)

    const { rerender } = render(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={<div>Empty</div>}
        grouping="none"
        label="Sessions"
        onArchiveSession={noop}
        onDeleteSession={noop}
        onResumeSession={noop}
        onToggle={noop}
        onTogglePin={noop}
        open={true}
        pinned={false}
        sessions={initialSessions}
      />
    )

    const firstRowsRef = mockVirtualListPropsHistory[0].rows

    // Switch on date dividers
    rerender(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={<div>Empty</div>}
        grouping="date"
        label="Sessions"
        onArchiveSession={noop}
        onDeleteSession={noop}
        onResumeSession={noop}
        onToggle={noop}
        onTogglePin={noop}
        open={true}
        pinned={false}
        sessions={initialSessions}
      />
    )

    const secondRowsRef = mockVirtualListPropsHistory[1].rows
    expect(secondRowsRef).not.toBe(firstRowsRef)

    // Change sessions array identity
    const updatedSessions = generateSessions(VIRTUALIZE_THRESHOLD + 4)
    rerender(
      <SidebarSessionsSection
        activeSessionId={null}
        emptyState={<div>Empty</div>}
        grouping="date"
        label="Sessions"
        onArchiveSession={noop}
        onDeleteSession={noop}
        onResumeSession={noop}
        onToggle={noop}
        onTogglePin={noop}
        open={true}
        pinned={false}
        sessions={updatedSessions}
      />
    )

    const thirdRowsRef = mockVirtualListPropsHistory[2].rows
    expect(thirdRowsRef).not.toBe(secondRowsRef)
  })
})
