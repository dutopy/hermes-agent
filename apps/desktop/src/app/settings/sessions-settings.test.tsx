import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $sessions, setSessions } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import { SessionsSettings } from './sessions-settings'

const api = vi.hoisted(() => ({
  deleteSession: vi.fn(),
  listAllProfileSessions: vi.fn(),
  setSessionArchived: vi.fn()
}))

const untombstoneSessions = vi.hoisted(() => vi.fn())

const cleanupState = vi.hoisted(() => ({
  discardSessionIdentityState: vi.fn(),
  discardSurface: vi.fn()
}))

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteSession: (...args: unknown[]) => api.deleteSession(...args),
  listAllProfileSessions: (...args: unknown[]) => api.listAllProfileSessions(...args),
  setSessionArchived: (...args: unknown[]) => api.setSessionArchived(...args)
}))

vi.mock('@/store/projects', () => ({ untombstoneSessions }))
vi.mock('@/store/session-states', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  discardSessionIdentityState: cleanupState.discardSessionIdentityState,
  sessionTileDelegate: () => ({ discardSurface: cleanupState.discardSurface })
}))
vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))
vi.mock('@/store/notifications', () => ({ notify: vi.fn(), notifyError: vi.fn() }))

const row = (profile: string, title: string, over: Partial<SessionInfo> = {}): SessionInfo =>
  ({
    ended_at: null,
    id: 'same',
    input_tokens: 0,
    is_active: false,
    last_active: 1000,
    message_count: 3,
    model: 'm',
    output_tokens: 0,
    preview: `${title} preview`,
    profile,
    source: 'desktop',
    started_at: 900,
    title,
    ...over
  }) as SessionInfo

async function renderSettings(rows: SessionInfo[]) {
  api.listAllProfileSessions.mockResolvedValue({ sessions: rows })
  render(
    <MemoryRouter>
      <SessionsSettings />
    </MemoryRouter>
  )
  await screen.findByText(rows[0]!.title!)
}

beforeEach(() => {
  api.deleteSession.mockReset()
  api.listAllProfileSessions.mockReset()
  api.setSessionArchived.mockReset()
  api.deleteSession.mockResolvedValue({ ok: true })
  api.setSessionArchived.mockResolvedValue({ ok: true })
  untombstoneSessions.mockReset()
  cleanupState.discardSessionIdentityState.mockReset()
  cleanupState.discardSurface.mockReset()
  cleanupState.discardSessionIdentityState.mockReturnValue([])
  cleanupState.discardSurface.mockReturnValue([])
  setSessions([])
})

afterEach(() => {
  cleanup()
  setSessions([])
  vi.restoreAllMocks()
})

describe('SessionsSettings profile-qualified archived rows', () => {
  it('unarchives only the selected profile homonym and updates only its global row', async () => {
    const archivedA = row('profile-a', 'Archived A')
    const archivedB = row('profile-b', 'Archived B')
    const globalA = row('profile-a', 'Global A', { archived: false })
    const staleGlobalB = row('profile-b', 'Stale Global B', { archived: true })
    setSessions([globalA, staleGlobalB])

    await renderSettings([archivedA, archivedB])

    const rowB = screen.getByText('Archived B').closest('.scroll-mt-6')
    expect(rowB).toBeTruthy()
    fireEvent.click(within(rowB as HTMLElement).getByRole('button', { name: /unarchive/i }))

    await waitFor(() => expect(api.setSessionArchived).toHaveBeenCalledWith('same', false, 'profile-b'))
    await waitFor(() => expect(screen.queryByText('Archived B')).toBeNull())

    expect(screen.getByText('Archived A')).toBeTruthy()
    expect($sessions.get()).toEqual([
      expect.objectContaining({ profile: 'profile-b', title: 'Archived B', archived: false }),
      globalA
    ])
    expect($sessions.get().filter(session => session.profile === 'profile-b')).toHaveLength(1)
    expect(untombstoneSessions).toHaveBeenCalledWith(['same', undefined], 'profile-b')
  })

  it('keeps busy controls scoped to the selected profile homonym', async () => {
    const archivedA = row('profile-a', 'Archived A')
    const archivedB = row('profile-b', 'Archived B')
    let resolveUnarchive!: (value: { ok: boolean }) => void
    api.setSessionArchived.mockReturnValue(
      new Promise(resolve => {
        resolveUnarchive = resolve
      })
    )

    await renderSettings([archivedA, archivedB])

    const rowA = screen.getByText('Archived A').closest('.scroll-mt-6') as HTMLElement
    const rowB = screen.getByText('Archived B').closest('.scroll-mt-6') as HTMLElement
    fireEvent.click(within(rowB).getByRole('button', { name: /unarchive/i }))

    await waitFor(() =>
      expect(
        within(rowB)
          .getAllByRole('button')
          .every(button => button.hasAttribute('disabled'))
      ).toBe(true)
    )
    expect(
      within(rowA)
        .getAllByRole('button')
        .every(button => !button.hasAttribute('disabled'))
    ).toBe(true)

    resolveUnarchive({ ok: true })
    await waitFor(() => expect(screen.queryByText('Archived B')).toBeNull())
  })

  it('uses profile-qualified React and DOM identities for homonymous rows', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await renderSettings([row('profile-a', 'Archived A'), row('profile-b', 'Archived B')])

    const rowA = screen.getByText('Archived A').closest('.scroll-mt-6') as HTMLElement
    const rowB = screen.getByText('Archived B').closest('.scroll-mt-6') as HTMLElement

    expect(rowA.id).not.toBe(rowB.id)
    expect(rowA.id).toContain('profile-a')
    expect(rowB.id).toContain('profile-b')
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('same key')
  })

  it('permanently deletes and discards only the selected profile identity after backend success', async () => {
    const archivedA = row('profile-a', 'Archived A')
    const archivedB = row('profile-b', 'Archived B', { _lineage_root_id: 'root-b' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    await renderSettings([archivedA, archivedB])

    const rowB = screen.getByText('Archived B').closest('.scroll-mt-6')
    expect(rowB).toBeTruthy()
    fireEvent.click(within(rowB as HTMLElement).getByRole('button', { name: /delete permanently/i }))

    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledWith('same', 'profile-b'))
    await waitFor(() => expect(screen.queryByText('Archived B')).toBeNull())

    expect(screen.getByText('Archived A')).toBeTruthy()
    expect(cleanupState.discardSessionIdentityState).toHaveBeenCalledWith('profile-b', 'same')
    expect(cleanupState.discardSessionIdentityState).toHaveBeenCalledWith('profile-b', 'root-b')
    expect(cleanupState.discardSurface).toHaveBeenCalledWith({ profile: 'profile-b', storedSessionId: 'same' })
    expect(cleanupState.discardSurface).toHaveBeenCalledWith({ profile: 'profile-b', storedSessionId: 'root-b' })
    expect(cleanupState.discardSessionIdentityState).not.toHaveBeenCalledWith('profile-a', 'same')
    expect(api.deleteSession.mock.invocationCallOrder[0]).toBeLessThan(
      cleanupState.discardSessionIdentityState.mock.invocationCallOrder[0]!
    )
  })
})
