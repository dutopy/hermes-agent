import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $modelPresets, applyModelPreset, getModelPreset, modelPresetKey, setModelPreset } from './model-presets'
import { $currentFastMode, $currentReasoningEffort, setCurrentFastMode, setCurrentReasoningEffort } from './session'
import { setSessionTileDelegate } from './session-states'

describe('model presets', () => {
  beforeEach(() => {
    $modelPresets.set({})
    setCurrentFastMode(false)
    setCurrentReasoningEffort('')
  })

  afterEach(() => setSessionTileDelegate(null))

  it('round-trips a preset and merges patches without dropping prior fields', () => {
    setModelPreset('anthropic', 'claude-opus-4-8', { effort: 'high' })
    setModelPreset('anthropic', 'claude-opus-4-8', { fast: true })

    expect(getModelPreset('anthropic', 'claude-opus-4-8')).toEqual({ effort: 'high', fast: true })
  })

  it('returns an empty preset for unknown models', () => {
    expect(getModelPreset('x', 'y')).toEqual({})
  })

  it('keys by provider::model', () => {
    expect(modelPresetKey('openai', 'gpt-5.5')).toBe('openai::gpt-5.5')
  })

  it('pushes only the provided dimensions to the gateway', async () => {
    const calls: { method: string; params?: Record<string, unknown> }[] = []

    const request = async <T>(method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params })

      return {} as T
    }

    await applyModelPreset({ effort: 'high' }, { failMessage: 'x', request, sessionId: 's1' })
    await applyModelPreset({}, { failMessage: 'x', request, sessionId: 's1' })

    expect(calls).toEqual([{ method: 'config.set', params: { key: 'reasoning', session_id: 's1', value: 'high' } }])
  })

  it('applies a fresh-draft preset locally without mutating gateway config', async () => {
    const calls: { method: string; params?: Record<string, unknown> }[] = []

    const request = async <T>(method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params })

      return {} as T
    }

    await applyModelPreset({ effort: 'high', fast: true }, { failMessage: 'x', request, sessionId: null })

    expect($currentReasoningEffort.get()).toBe('high')
    expect($currentFastMode.get()).toBe(true)
    expect(calls).toEqual([])
  })

  it('updates an embedded preset only in its owner profile state', async () => {
    const updateSession = vi.fn()
    setSessionTileDelegate({ updateSession } as never)

    await applyModelPreset(
      { effort: 'high', fast: true },
      { failMessage: 'x', primary: false, profile: 'profile-b', request: vi.fn(), sessionId: 'shared-runtime' }
    )

    expect(updateSession).toHaveBeenCalledWith('shared-runtime', expect.any(Function), 'profile-b')
  })
})
