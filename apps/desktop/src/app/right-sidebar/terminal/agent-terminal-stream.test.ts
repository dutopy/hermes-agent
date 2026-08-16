import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadStream() {
  vi.resetModules()

  return import('./agent-terminal-stream')
}

describe('agent terminal stream profile identity', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('routes colliding process output only to the writer owned by that profile', async () => {
    const { registerAgentTerminalWriter, writeAgentTerminalChunk } = await loadStream()
    const writeA = vi.fn()
    const writeB = vi.fn()

    registerAgentTerminalWriter('profile-a', 'same-proc', writeA)
    registerAgentTerminalWriter('profile-b', 'same-proc', writeB)

    writeAgentTerminalChunk('profile-a', 'same-proc', 'A output')
    writeAgentTerminalChunk('profile-b', 'same-proc', 'B output')

    expect(writeA).toHaveBeenCalledExactlyOnceWith('A output')
    expect(writeB).toHaveBeenCalledExactlyOnceWith('B output')
  })

  it('replays only the backlog qualified by profile and process id', async () => {
    const { registerAgentTerminalWriter, writeAgentTerminalChunk } = await loadStream()

    writeAgentTerminalChunk('profile-a', 'same-proc', 'A backlog')
    writeAgentTerminalChunk('profile-b', 'same-proc', 'B backlog')

    const writeA = vi.fn()
    const writeB = vi.fn()
    registerAgentTerminalWriter('profile-a', 'same-proc', writeA)
    registerAgentTerminalWriter('profile-b', 'same-proc', writeB)

    expect(writeA).toHaveBeenCalledExactlyOnceWith('A backlog')
    expect(writeB).toHaveBeenCalledExactlyOnceWith('B backlog')
  })

  it('keeps explicit default profile separate from the omitted-profile legacy stream', async () => {
    const { registerAgentTerminalWriter, writeAgentTerminalChunk } = await loadStream()
    const legacyWrite = vi.fn()
    const defaultWrite = vi.fn()

    registerAgentTerminalWriter('same-proc', legacyWrite)
    registerAgentTerminalWriter('default', 'same-proc', defaultWrite)

    writeAgentTerminalChunk('default', 'same-proc', 'default only')

    expect(defaultWrite).toHaveBeenCalledExactlyOnceWith('default only')
    expect(legacyWrite).not.toHaveBeenCalled()
  })
})
