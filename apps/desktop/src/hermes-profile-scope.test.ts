import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addMcpServer,
  authMcpServer,
  cancelMcpOAuthFlow,
  checkHermesUpdate,
  getActionStatus,
  getElevenLabsVoices,
  getMcpCatalog,
  getMcpOAuthFlow,
  getMemoryProviderConfig,
  getStatus,
  installMcpCatalogEntry,
  removeMcpServer,
  restartGateway,
  saveMemoryProviderConfig,
  setApiRequestProfile,
  setMcpServerEnabled,
  speakText,
  transcribeAudio,
  transcribeAudioForProfile,
  updateHermes
} from './hermes'

// Contract: every backend-targeted action helper must carry the active gateway
// profile, so a multi-profile / global-remote user's restart, status poll, and
// update hit the backend they're actually on — not the primary/default. The
// System-panel "restart does nothing" bug was these helpers dropping it.
describe('backend action helpers are profile-scoped', () => {
  const api = vi.fn(async (_req: { path: string; profile?: string }) => ({}) as never)

  beforeEach(() => {
    ;(window as { hermesDesktop?: unknown }).hermesDesktop = { api }
    api.mockClear()
  })

  afterEach(() => {
    setApiRequestProfile(null)
    delete (window as { hermesDesktop?: unknown }).hermesDesktop
  })

  const lastProfile = () => api.mock.calls.at(-1)?.[0].profile

  it('omits profile when none is active (single-profile users unaffected)', () => {
    void getStatus()
    expect(lastProfile()).toBeUndefined()
  })

  it('forwards the active profile to memory provider config calls', () => {
    setApiRequestProfile('coder')

    void getMemoryProviderConfig('honcho')
    void saveMemoryProviderConfig('honcho', { workspace: 'w' })

    for (const call of api.mock.calls) {
      expect(call[0].profile).toBe('coder')
    }
  })

  it('forwards the active profile to every backend action', () => {
    setApiRequestProfile('coder')

    void getStatus()
    void restartGateway()
    void updateHermes()
    void checkHermesUpdate()
    void getActionStatus('gateway-restart')

    for (const call of api.mock.calls) {
      expect(call[0].profile).toBe('coder')
    }
  })

  // Audio endpoints (transcribe / speak / voices) write to the active
  // profile's config in the settings UI but historically called the backend
  // without a profile scope, so playback used the default profile's TTS/voice
  // config instead of the active one (#53441).
  it('forwards the active profile to audio endpoints', () => {
    setApiRequestProfile('jarvis')

    void transcribeAudio('data:audio/webm;base64,AAAA', 'audio/webm')
    void speakText('hello')
    void getElevenLabsVoices()

    expect(api.mock.calls).toHaveLength(3)

    for (const call of api.mock.calls) {
      expect(call[0].profile).toBe('jarvis')
    }
  })

  it('can transcribe for an embedded profile without mutating the foreground REST scope', () => {
    setApiRequestProfile('foreground')

    void transcribeAudioForProfile('surface', 'data:audio/webm;base64,AAAA', 'audio/webm')
    void transcribeAudio('data:audio/webm;base64,BBBB', 'audio/webm')

    expect(api.mock.calls[0]?.[0].profile).toBe('surface')
    expect(api.mock.calls[1]?.[0].profile).toBe('foreground')
  })

  it('can run the complete MCP setup flow against its request owner profile', () => {
    setApiRequestProfile('foreground')

    void getMcpCatalog('surface')
    void setMcpServerEnabled('server', true, 'surface')
    void authMcpServer('server', 'surface')
    void getMcpOAuthFlow('flow', 'surface')
    void cancelMcpOAuthFlow('flow', 'surface')
    void addMcpServer({ name: 'server', url: 'https://example.test' }, 'surface')
    void removeMcpServer('server', 'surface')
    void installMcpCatalogEntry('server', {}, 'surface')
    void getActionStatus('install', 1, 'surface')

    expect(api.mock.calls).toHaveLength(9)
    for (const call of api.mock.calls) {
      expect(call[0].profile).toBe('surface')
    }
  })
})
