import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readElectronSource(file: string): string {
  return fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n')
}

test('native notification actions preserve the profile carried by that notification', () => {
  const source = readElectronSource('main.ts')
  const handlerStart = source.indexOf("ipcMain.handle('hermes:notify'")
  expect(handlerStart, 'hermes:notify handler must exist').not.toBe(-1)
  const handler = source.slice(handlerStart, handlerStart + 2200)

  expect(
    handler,
    'the action callback must carry the notification profile instead of reconstructing ownership from sessionId'
  ).toMatch(/'hermes:notification-action', \{[^}]*profile: payload\?\.profile[^}]*\}/s)
})

test('native notification body clicks preserve profile ownership', () => {
  const source = readElectronSource('main.ts')
  const handlerStart = source.indexOf("ipcMain.handle('hermes:notify'")
  const handler = source.slice(handlerStart, handlerStart + 2200)

  expect(handler).toMatch(/'hermes:focus-session', \{[^}]*profile: payload\?\.profile[^}]*sessionId: payload\?\.sessionId[^}]*\}/s)
})

test('native notification dedupe distinguishes profiles that share a runtime id', () => {
  const source = readElectronSource('main.ts')
  const handlerStart = source.indexOf("ipcMain.handle('hermes:notify'")
  expect(handlerStart, 'hermes:notify handler must exist').not.toBe(-1)
  const handler = source.slice(handlerStart, handlerStart + 900)

  expect(handler).toContain("${payload?.kind ?? ''}:${payload?.profile ?? ''}:${payload?.sessionId ?? payload?.tag ?? ''}")
})

test('preload forwards the complete focus-session payload unchanged', () => {
  const source = readElectronSource('preload.ts')
  const listenerStart = source.indexOf('onFocusSession: callback =>')
  const listener = source.slice(listenerStart, listenerStart + 240)

  expect(listener).toContain('const listener = (_event, payload) => callback(payload)')
})

test('preload forwards the complete notification action payload unchanged', () => {
  const source = readElectronSource('preload.ts')
  const listenerStart = source.indexOf('onNotificationAction: callback =>')
  expect(listenerStart, 'notification action preload listener must exist').not.toBe(-1)
  const listener = source.slice(listenerStart, listenerStart + 260)

  expect(listener).toContain('const listener = (_event, payload) => callback(payload)')
})
