import { atom } from 'nanostores'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'hermes.desktop.terminals.v1'

async function loadTerminalStore() {
  const $currentCwd = atom('/workspace')

  vi.doMock('@/store/session', () => ({
    $currentCwd
  }))

  return { ...(await import('./terminals')), $currentCwd }
}

describe('terminal store persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('restores user tabs, active tab, and history on module load', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeTerminalId: 'term-two',
        terminals: [
          { auto: false, cwd: '/repo/one', id: 'term-one', reviveBuffer: 'last output', title: 'zsh' },
          { auto: true, cwd: '/repo/two', id: 'term-two', title: 'Terminal' }
        ]
      })
    )

    const { $activeTerminalId, $terminals } = await loadTerminalStore()

    expect($activeTerminalId.get()).toBe('term-two')
    expect($terminals.get()).toEqual([
      { auto: false, cwd: '/repo/one', id: 'term-one', kind: 'user', reviveBuffer: 'last output', title: 'zsh' },
      { auto: true, cwd: '/repo/two', id: 'term-two', kind: 'user', title: 'Terminal' }
    ])
  })

  it('persists user tabs and history synchronously, skipping agent mirrors', async () => {
    const { createTerminal, ensureAgentTerminal, renameTerminal, selectTerminal, updateTerminalReviveBuffer } =
      await loadTerminalStore()

    const userId = createTerminal('/repo')
    renameTerminal(userId, 'server')
    updateTerminalReviveBuffer(userId, 'recent scrollback')
    ensureAgentTerminal('proc-1', 'background task')
    selectTerminal(userId)

    // No flush/tick: persistence is synchronous, so the snapshot is already on
    // disk (this is what makes app-quit restore reliable).
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      activeTerminalId: userId,
      terminals: [{ auto: false, cwd: '/repo', id: userId, reviveBuffer: 'recent scrollback', title: 'server' }]
    })
  })

  it('never attaches a revive buffer to an agent tab', async () => {
    const { $terminals, ensureAgentTerminal, updateTerminalReviveBuffer } = await loadTerminalStore()

    const agentId = ensureAgentTerminal('proc-1', 'background task')!
    updateTerminalReviveBuffer(agentId, 'should be ignored')

    expect($terminals.get().find(term => term.id === agentId)?.reviveBuffer).toBeUndefined()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('creates distinct mirrors for colliding profile process ids and closes only the requested owner', async () => {
    const { $terminals, closeAgentTerminalByProc, ensureAgentTerminal } = await loadTerminalStore()

    const idA = ensureAgentTerminal('profile-a', 'same-proc', 'A task')!
    const idB = ensureAgentTerminal('profile-b', 'same-proc', 'B task')!

    expect(idA).not.toBe(idB)
    expect($terminals.get().filter(term => term.procId === 'same-proc')).toEqual([
      expect.objectContaining({ id: idA, profile: 'profile-a' }),
      expect.objectContaining({ id: idB, profile: 'profile-b' })
    ])

    expect(closeAgentTerminalByProc('profile-b', 'same-proc')).toBe(true)
    expect($terminals.get().some(term => term.id === idA)).toBe(true)
    expect($terminals.get().some(term => term.id === idB)).toBe(false)
  })

  it('does not dedupe an explicit default mirror against an omitted-profile legacy mirror', async () => {
    const { $terminals, ensureAgentTerminal } = await loadTerminalStore()

    const legacyId = ensureAgentTerminal('same-proc', 'legacy task')!
    const defaultId = ensureAgentTerminal('default', 'same-proc', 'default task')!

    expect(defaultId).not.toBe(legacyId)
    expect($terminals.get().filter(term => term.procId === 'same-proc')).toHaveLength(2)
  })

  it('tail-trims an oversized revive buffer to stay under the storage budget', async () => {
    const { $terminals, createTerminal, updateTerminalReviveBuffer } = await loadTerminalStore()

    const userId = createTerminal('/repo')
    const huge = 'x'.repeat(60_000)
    updateTerminalReviveBuffer(userId, huge)

    const stored = $terminals.get().find(term => term.id === userId)?.reviveBuffer ?? ''
    expect(stored.length).toBe(48_000)
    expect(stored).toBe(huge.slice(-48_000))
  })

  it('clears remembered tabs when all terminals close', async () => {
    const { closeAllTerminals, createTerminal } = await loadTerminalStore()

    createTerminal('/repo')
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull()

    closeAllTerminals()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('restores and persists the last observed cwd so a reopened tab lands where the user cd-d', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeTerminalId: 'term-one',
        terminals: [{ auto: false, cwd: '/repo', id: 'term-one', restoreCwd: '/repo/packages/api', title: 'zsh' }]
      })
    )

    const { $terminals, updateTerminalRestoreCwd } = await loadTerminalStore()

    expect($terminals.get()[0]?.restoreCwd).toBe('/repo/packages/api')

    updateTerminalRestoreCwd('term-one', '/repo/packages/web')
    expect($terminals.get()[0]?.restoreCwd).toBe('/repo/packages/web')
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}').terminals[0].restoreCwd).toBe(
      '/repo/packages/web'
    )
  })

  it('never attaches a restore cwd to an agent tab and ignores empty values', async () => {
    const { $terminals, createTerminal, ensureAgentTerminal, updateTerminalRestoreCwd } = await loadTerminalStore()

    const userId = createTerminal('/repo')
    const agentId = ensureAgentTerminal('proc-1', 'background task')!

    updateTerminalRestoreCwd(agentId, '/somewhere')
    updateTerminalRestoreCwd(userId, '   ')

    expect($terminals.get().find(term => term.id === agentId)?.restoreCwd).toBeUndefined()
    expect($terminals.get().find(term => term.id === userId)?.restoreCwd).toBeUndefined()
  })
})

describe('session cwd → terminal tab linking', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('re-selects the tab already pointed at the new session cwd (trailing slash tolerated)', async () => {
    const { $activeTerminalId, $currentCwd, createTerminal } = await loadTerminalStore()

    const repoTab = createTerminal('/repo')
    const otherTab = createTerminal('/elsewhere')
    expect($activeTerminalId.get()).toBe(otherTab)

    $currentCwd.set('/repo/')
    expect($activeTerminalId.get()).toBe(repoTab)
  })

  it('matches the live shell cwd (restoreCwd) over the launch dir', async () => {
    const { $activeTerminalId, $currentCwd, createTerminal, updateTerminalRestoreCwd } = await loadTerminalStore()

    const movedTab = createTerminal('/repo')
    updateTerminalRestoreCwd(movedTab, '/repo/packages/api')
    const otherTab = createTerminal('/elsewhere')
    expect($activeTerminalId.get()).toBe(otherTab)

    $currentCwd.set('/repo/packages/api')
    expect($activeTerminalId.get()).toBe(movedTab)

    // The launch dir no longer describes where that shell lives.
    $currentCwd.set('/repo')
    expect($activeTerminalId.get()).toBe(movedTab)
  })

  it('leaves the active tab alone when no tab lives in the session cwd or the cwd is empty', async () => {
    const { $activeTerminalId, $currentCwd, createTerminal } = await loadTerminalStore()

    createTerminal('/repo')
    const activeTab = createTerminal('/elsewhere')

    $currentCwd.set('/unrelated')
    expect($activeTerminalId.get()).toBe(activeTab)

    $currentCwd.set('')
    expect($activeTerminalId.get()).toBe(activeTab)
  })

  it('stays put when the active tab already lives in the target cwd, and never matches agent tabs', async () => {
    const { $activeTerminalId, $currentCwd, createTerminal, ensureAgentTerminal, selectTerminal } =
      await loadTerminalStore()

    const first = createTerminal('/repo')
    const second = createTerminal('/repo')
    ensureAgentTerminal('proc-1', 'background task')
    selectTerminal(second)

    // Both tabs match; the one already active keeps focus (no first-match steal).
    $currentCwd.set('/repo')
    expect($activeTerminalId.get()).toBe(second)

    selectTerminal(first)
    $currentCwd.set('/repo')
    expect($activeTerminalId.get()).toBe(first)
  })
})
