import { cleanup, render } from '@testing-library/react'
import { atom } from 'nanostores'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type SessionView, SessionViewProvider } from '@/app/chat/session-view'
import { $previewStatusBySession } from '@/store/preview-status'
import { $activeSessionId, $currentCwd } from '@/store/session'
import { sessionRuntimeStateKey } from '@/store/session-states'
import { recordToolDiff } from '@/store/tool-diffs'

vi.mock('@assistant-ui/react', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuiState: (select: (state: unknown) => unknown) =>
    select({ message: { id: 'msg-1', status: { type: 'complete' } }, thread: { isRunning: false } })
}))

const { ToolFallback } = await import('./fallback')

const PRIMARY_ID = 'primary-session'
const TILE_ID = 'tile-session'

/** Minimal tile view: only the fields the tool row reads. */
function tileView(profile?: string): SessionView {
  return {
    ...({} as SessionView),
    $cwd: atom('/tile/work'),
    $messages: atom([]),
    $runtimeId: atom<null | string>(TILE_ID),
    kind: 'tile',
    profile
  }
}

function renderToolRow(
  wrap: (node: ReactNode) => ReactNode,
  overrides: Partial<ComponentProps<typeof ToolFallback>> = {}
) {
  const props = {
    args: { path: '/tile/work/report.html' },
    result: { path: '/tile/work/report.html' },
    toolCallId: 'call-1',
    toolName: 'write_file',
    ...overrides
  } as unknown as ComponentProps<typeof ToolFallback>

  return render(<>{wrap(<ToolFallback {...props} />)}</>)
}

afterEach(() => {
  cleanup()
  $previewStatusBySession.set({})
  $activeSessionId.set(null)
  $currentCwd.set('')
})

describe('tool row inline diff ownership', () => {
  it('reads only its SessionView profile and runtime when tool ids collide', () => {
    const toolCallId = 'shared-rendered-tool'
    const legacyDiff = '--- a/file\n+++ b/file\n-old\n+legacy leaked line'
    const profileDiff = '--- a/file\n+++ b/file\n-old\n+profile B line'

    recordToolDiff(toolCallId, legacyDiff)
    recordToolDiff(toolCallId, '--- a/file\n+++ b/file\n-old\n+profile A line', {
      profile: 'profile-a',
      runtimeId: TILE_ID
    })
    recordToolDiff(toolCallId, profileDiff, { profile: 'profile-b', runtimeId: TILE_ID })

    const view = tileView('profile-b')
    const rendered = renderToolRow(node => <SessionViewProvider value={view}>{node}</SessionViewProvider>, {
      args: { patch: profileDiff },
      result: {},
      toolCallId,
      toolName: 'patch'
    })

    expect(rendered.container.textContent).toContain('profile B line')
    expect(rendered.container.textContent).not.toContain('legacy leaked line')
    expect(rendered.container.textContent).not.toContain('profile A line')
  })

  it('keeps an explicit naked-key fallback for the primary legacy view', () => {
    const toolCallId = 'legacy-primary-tool'
    const legacyDiff = '--- a/file\n+++ b/file\n-old\n+legacy primary line'

    $activeSessionId.set(PRIMARY_ID)
    recordToolDiff(toolCallId, legacyDiff)

    const rendered = renderToolRow(node => node, {
      args: { patch: legacyDiff },
      result: {},
      toolCallId,
      toolName: 'patch'
    })

    expect(rendered.container.textContent).toContain('legacy primary line')
  })
})

describe('tool row preview recording', () => {
  // The row used to record under the global (primary-only) $activeSessionId, so
  // a preview produced inside a session TILE surfaced in the main chat's
  // composer instead of the tile's own.
  it('records into the session whose transcript the row is in, not the primary', () => {
    $activeSessionId.set(PRIMARY_ID)
    $currentCwd.set('/primary/work')

    const view = tileView()

    renderToolRow(node => <SessionViewProvider value={view}>{node}</SessionViewProvider>)

    const recorded = $previewStatusBySession.get()

    expect(Object.keys(recorded)).toEqual([TILE_ID])
    expect(recorded[TILE_ID]?.[0]?.cwd).toBe('/tile/work')
  })

  it('still records into the primary session for the main chat', () => {
    $activeSessionId.set(PRIMARY_ID)
    $currentCwd.set('/primary/work')

    renderToolRow(node => node)

    expect(Object.keys($previewStatusBySession.get())).toEqual([sessionRuntimeStateKey('default', PRIMARY_ID)])
  })
})
