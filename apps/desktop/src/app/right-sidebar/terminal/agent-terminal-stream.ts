// Live agent-terminal output, pushed from the backend as `agent.terminal.output`
// events (see tui_gateway `_wire_agent_terminal_output`). Chunks route straight
// to the matching read-only xterm, keyed by profile + process id. A capped
// per-process backlog lets a tab opened mid-stream replay what it missed.

import { normalizeProfileKey } from '@/store/profile'

type Writer = (chunk: string) => void

type StreamIdentity = { procId: string; profile?: null | string }

const writers = new Map<string, Writer>()
const backlog = new Map<string, string>()
const commandHeaders = new Map<string, string>()
const lastSnapshots = new Map<string, string>()
const seededCommands = new Set<string>()

const MAX_BACKLOG = 256_000

const streamKey = ({ procId, profile }: StreamIdentity) =>
  JSON.stringify(profile == null ? ['legacy', procId] : ['profile', normalizeProfileKey(profile), procId])

function identityFromArgs<T>(args: [procId: string, value: T] | [profile: string, procId: string, value: T]) {
  return args.length === 2 ? { procId: args[0], value: args[1] } : { procId: args[1], profile: args[0], value: args[2] }
}

/** A live agent terminal registers its xterm write and replays the backlog.
 * Returns an idempotent unregister. Omitted profile retains the legacy stream. */
export function registerAgentTerminalWriter(
  ...args: [procId: string, write: Writer] | [profile: string, procId: string, write: Writer]
): () => void {
  const { value: write, ...identity } = identityFromArgs(args)
  const key = streamKey(identity)
  writers.set(key, write)

  const history = backlog.get(key)

  if (history) {
    write(history)
  }

  return () => {
    if (writers.get(key) === write) {
      writers.delete(key)
    }
  }
}

/** Append a streamed chunk to the profile-qualified backlog and mounted writer. */
export function writeAgentTerminalChunk(
  ...args: [procId: string, chunk: string] | [profile: string, procId: string, chunk: string]
): void {
  const { value: chunk, ...identity } = identityFromArgs(args)

  if (!identity.procId || !chunk) {
    return
  }

  const key = streamKey(identity)
  const next = (backlog.get(key) ?? '') + chunk
  backlog.set(key, next.length > MAX_BACKLOG ? next.slice(-MAX_BACKLOG) : next)
  writers.get(key)?.(chunk)
}

/** Seed the tab with the command immediately, so an agent terminal never opens
 * as an empty void while stdout is still pending or not yet observed. */
export function seedAgentTerminalCommand(
  ...args: [procId: string, command: string] | [profile: string, procId: string, command: string]
): void {
  const { value: command, ...identity } = identityFromArgs(args)
  const trimmed = command.trim()
  const key = streamKey(identity)

  if (!identity.procId || !trimmed || seededCommands.has(key)) {
    return
  }

  seededCommands.add(key)
  const header = `$ ${trimmed}\r\n`
  commandHeaders.set(key, header)
  writeAgentTerminalChunkForIdentity(identity, header)
}

function writeAgentTerminalChunkForIdentity(identity: StreamIdentity, chunk: string): void {
  const key = streamKey(identity)
  const next = (backlog.get(key) ?? '') + chunk
  backlog.set(key, next.length > MAX_BACKLOG ? next.slice(-MAX_BACKLOG) : next)
  writers.get(key)?.(chunk)
}

/** Ingest a full output snapshot from process.list/status-stack. */
export function syncAgentTerminalSnapshot(
  ...args: [procId: string, output: string] | [profile: string, procId: string, output: string]
): void {
  const { value: output, ...identity } = identityFromArgs(args)

  if (!identity.procId || !output) {
    return
  }

  const key = streamKey(identity)
  const current = backlog.get(key) ?? ''
  const header = commandHeaders.get(key) ?? ''
  const body = header && current.startsWith(header) ? current.slice(header.length) : current
  const previous = lastSnapshots.get(key) ?? ''

  if (output === previous || output === body || body.endsWith(output)) {
    lastSnapshots.set(key, output)

    return
  }

  if (output.startsWith(previous)) {
    writeAgentTerminalChunkForIdentity(identity, output.slice(previous.length))
    lastSnapshots.set(key, output)

    return
  }

  if (output.startsWith(body)) {
    writeAgentTerminalChunkForIdentity(identity, output.slice(body.length))
    lastSnapshots.set(key, output)

    return
  }

  const next = `${header}${output}`.slice(-MAX_BACKLOG)
  lastSnapshots.set(key, output)
  backlog.set(key, next)
  writers.get(key)?.(`\x1bc${next}`)
}
