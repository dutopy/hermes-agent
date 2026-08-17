/**
 * Roadmaps plugin — local persistence.
 *
 * Roadmap must remember user settings and per-project settings (spec §8).
 * localStorage, keyed by profile (user) and profile/project (per-project),
 * client-side only — no backend. Failures (private mode, quota) degrade to
 * in-memory state silently.
 */

import { useEffect, useState } from 'react'

function read(key, initialValue) {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw != null ? JSON.parse(raw) : initialValue
  } catch {
    return initialValue
  }
}

function write(key, value) {
  const store = globalThis.localStorage
  if (!store) return
  try {
    store.setItem(key, JSON.stringify(value))
  } catch {
    // private mode / quota — degrade to in-memory
    return
  }
}

/**
 * useState that round-trips through localStorage. The key is the caller's
 * scope (e.g. `roadmaps:<profile>:projectId`); JSON-encoded. When the key
 * changes (scope switch) the value is re-read from storage for the new scope.
 */
export function usePersistedState(key, initialValue) {
  const [value, setValue] = useState(() => read(key, initialValue))

  useEffect(() => {
    setValue(read(key, initialValue))
  }, [key, initialValue])

  useEffect(() => {
    write(key, value)
  }, [key, value])

  return [value, setValue]
}
