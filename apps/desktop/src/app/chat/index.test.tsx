import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { assistantTextPart, type ChatMessage } from '@/lib/chat-messages'
import { modelOptionsQueryKey } from '@/lib/model-options'
import { $pinnedSessionIds } from '@/store/layout'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $activeSessionId,
  $awaitingResponse,
  $busy,
  $contextSuggestions,
  $currentCwd,
  $currentModel,
  $currentProvider,
  $freshDraftReady,
  $gatewayState,
  $messages,
  $selectedStoredSessionId,
  $sessions
} from '@/store/session'
import { sessionPinKeyForOwner } from '@/store/session-pins'

const chatBarProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
const requestModelOptions = vi.hoisted(() => vi.fn())
const threadRenderCount = vi.hoisted(() => ({ current: 0 }))

vi.mock('@/components/assistant-ui/thread', async () => {
  const React = await import('react')

  return {
    Thread: () => {
      threadRenderCount.current += 1

      return React.createElement('div', { 'data-testid': 'thread' })
    }
  }
})

vi.mock('@/components/Backdrop', async () => {
  const React = await import('react')

  return { Backdrop: () => React.createElement('div', { 'data-testid': 'backdrop' }) }
})

vi.mock('@/components/prompt-overlays', () => ({ PromptOverlays: () => null }))
vi.mock('@/components/chat/vibe-hearts', () => ({ COMPOSER_HEART_CONFIG: {}, HeartField: () => null }))
vi.mock('@/lib/model-options', () => ({
  modelOptionsQueryKey: (...parts: unknown[]) => ['model-options', ...parts],
  requestModelOptions
}))
vi.mock('./chat-drop-overlay', () => ({ ChatDropOverlay: () => null }))
vi.mock('./chat-swap-overlay', () => ({ ChatSwapOverlay: () => null }))
vi.mock('./composer', () => ({
  ChatBar: (props: Record<string, unknown>) => {
    chatBarProps.current = props

    return null
  },
  ChatBarFallback: () => null
}))
vi.mock('./hooks/use-file-drop-zone', () => ({
  useFileDropZone: () => ({ dragKind: null, dropHandlers: {} })
}))
vi.mock('./sidebar/session-actions-menu', async () => {
  const React = await import('react')

  return {
    SessionActionsMenu: ({ children, pinned, profile }: { children: React.ReactNode; pinned?: boolean; profile?: string }) =>
      React.createElement(
        'div',
        { 'data-pinned': String(Boolean(pinned)), 'data-profile': profile, 'data-testid': 'session-actions-menu' },
        children
      )
  }
})

const { ChatView } = await import('./index')
const { SessionViewProvider } = await import('./session-view')

function assistantMessage(id: string, text: string): ChatMessage {
  return {
    id,
    parts: [assistantTextPart(text)],
    role: 'assistant'
  }
}

describe('ChatView render isolation', () => {
  beforeEach(() => {
    chatBarProps.current = null
    requestModelOptions.mockReset().mockResolvedValue({ models: [] })
    threadRenderCount.current = 0
    $activeSessionId.set('runtime-1')
    $activeGatewayProfile.set('default')
    $pinnedSessionIds.set([])
    $awaitingResponse.set(false)
    $busy.set(false)
    $contextSuggestions.set([])
    $currentCwd.set('/work')
    $currentModel.set('test-model')
    $currentProvider.set('test-provider')
    $freshDraftReady.set(false)
    $gatewayState.set('closed')
    $messages.set([assistantMessage('assistant-1', 'Stable historical answer')])
    $selectedStoredSessionId.set('stored-1')
    $sessions.set([{ id: 'stored-1', message_count: 1, title: 'Stable chat' } as never])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    $activeSessionId.set(null)
    $awaitingResponse.set(false)
    $busy.set(false)
    $contextSuggestions.set([])
    $currentCwd.set('')
    $currentModel.set('')
    $currentProvider.set('')
    $freshDraftReady.set(false)
    $gatewayState.set('idle')
    $messages.set([])
    $selectedStoredSessionId.set(null)
    $sessions.set([])
  })

  it('reports selected pin state from the selected owner without reading A or legacy homonyms', () => {
    const sessions = [
      { _lineage_root_id: 'root', id: 'same', message_count: 1, profile: 'profile-a', title: 'A' },
      { _lineage_root_id: 'root', id: 'same', message_count: 1, profile: 'profile-b', title: 'B' }
    ] as never
    const aKey = sessionPinKeyForOwner('same', 'profile-a', sessions)
    const bKey = sessionPinKeyForOwner('same', 'profile-b', sessions)
    $activeGatewayProfile.set('profile-b')
    $selectedStoredSessionId.set('same')
    $sessions.set(sessions)
    $pinnedSessionIds.set(['root', aKey])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/same']}>
          <ChatView
            gateway={null}
            onAddContextRef={vi.fn()}
            onAddUrl={vi.fn()}
            onAttachDroppedItems={vi.fn()}
            onAttachImageBlob={vi.fn()}
            onCancel={vi.fn()}
            onDeleteSelectedSession={vi.fn()}
            onEdit={vi.fn()}
            onPasteClipboardImage={vi.fn()}
            onPickFiles={vi.fn()}
            onPickFolders={vi.fn()}
            onPickImages={vi.fn()}
            onReload={vi.fn()}
            onRemoveAttachment={vi.fn()}
            onRetryResume={vi.fn()}
            onSteer={vi.fn()}
            onSubmit={vi.fn()}
            onThreadMessagesChange={vi.fn()}
            onToggleSelectedPin={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>
    )

    const menu = screen.getByTestId('session-actions-menu')
    expect(menu.dataset.profile).toBe('profile-b')
    expect(menu.dataset.pinned).toBe('false')

    act(() => $pinnedSessionIds.set(['root', aKey, bKey]))
    expect(menu.dataset.pinned).toBe('true')
  })

  it('does not re-render chat history when an unrelated parent idle tick updates', () => {
    const props = {
      gateway: null,
      maxVoiceRecordingSeconds: 120,
      onAddContextRef: vi.fn(),
      onAddUrl: vi.fn(),
      onAttachDroppedItems: vi.fn(),
      onAttachImageBlob: vi.fn(),
      onBranchInNewChat: vi.fn(),
      onCancel: vi.fn(),
      onDeleteSelectedSession: vi.fn(),
      onEdit: vi.fn(),
      onPasteClipboardImage: vi.fn(),
      onPickFiles: vi.fn(),
      onPickFolders: vi.fn(),
      onPickImages: vi.fn(),
      onReload: vi.fn(),
      onRemoveAttachment: vi.fn(),
      onRetryResume: vi.fn(),
      onSteer: vi.fn(),
      onSubmit: vi.fn(),
      onThreadMessagesChange: vi.fn(),
      onToggleSelectedPin: vi.fn(),
      onTranscribeAudio: vi.fn()
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })

    function ParentTickHarness() {
      const [tick, setTick] = useState(0)

      return (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/stored-1']}>
            <button onClick={() => setTick(value => value + 1)} type="button">
              parent tick {tick}
            </button>
            <ChatView {...props} />
          </MemoryRouter>
        </QueryClientProvider>
      )
    }

    render(<ParentTickHarness />)

    expect(screen.getByTestId('thread')).toBeTruthy()
    expect(threadRenderCount.current).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: /parent tick/i }))

    // memo(ChatView) with stable props must absorb the parent's idle tick —
    // the transcript (Thread) must not re-render. This is PR #38470's contract.
    expect(threadRenderCount.current).toBe(1)
  })

  it('uses the embedded owner profile for model cache and connection readiness', async () => {
    const ownerGatewayState = atom<'connecting' | 'closed' | 'open'>('open')
    const ownerGateway = {
      connectionState: 'open',
      request: vi.fn(async (..._args: unknown[]) => ({ model: 'owner-model', provider: 'owner-provider', providers: [] }))
    }
    const ownerView = {
      kind: 'tile' as const,
      profile: 'profile-b',
      $awaitingResponse: atom(false),
      $busy: atom(false),
      $cwd: atom('/owner'),
      $fast: atom(false),
      $gatewayState: ownerGatewayState,
      $lastVisibleIsUser: atom(false),
      $messages: atom<ChatMessage[]>([]),
      $messagesEmpty: atom(true),
      $model: atom('owner-model'),
      $provider: atom('owner-provider'),
      $reasoningEffort: atom(''),
      $runtimeId: atom<null | string>('shared-runtime'),
      $storedId: atom<null | string>('stored-b')
    }
    const foreground = { model: 'foreground-model', provider: 'foreground-provider', providers: [] }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(modelOptionsQueryKey('profile-a', 'shared-runtime'), foreground)
    requestModelOptions.mockImplementation(async ({ gateway }: { gateway?: typeof ownerGateway }) =>
      gateway?.request('model.options')
    )
    $activeGatewayProfile.set('profile-a')
    $activeSessionId.set('shared-runtime')
    $gatewayState.set('connecting')

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/stored-b']}>
          <SessionViewProvider value={ownerView}>
            <ChatView
              gateway={ownerGateway as never}
              onAddContextRef={vi.fn()}
              onAddUrl={vi.fn()}
              onAttachDroppedItems={vi.fn()}
              onAttachImageBlob={vi.fn()}
              onCancel={vi.fn()}
              onDeleteSelectedSession={vi.fn()}
              onEdit={vi.fn()}
              onPasteClipboardImage={vi.fn()}
              onPickFiles={vi.fn()}
              onPickFolders={vi.fn()}
              onPickImages={vi.fn()}
              onReload={vi.fn()}
              onRemoveAttachment={vi.fn()}
              onRetryResume={vi.fn()}
              onSteer={vi.fn()}
              onSubmit={vi.fn()}
              onThreadMessagesChange={vi.fn()}
              onToggleSelectedPin={vi.fn()}
            />
          </SessionViewProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => expect(ownerGateway.request).toHaveBeenCalled())
    expect(queryClient.getQueryData(modelOptionsQueryKey('profile-b', 'shared-runtime'))).toMatchObject({
      model: 'owner-model',
      provider: 'owner-provider'
    })
    expect(queryClient.getQueryData(modelOptionsQueryKey('profile-a', 'shared-runtime'))).toBe(foreground)
    expect(chatBarProps.current?.disabled).toBe(false)

    ownerGatewayState.set('closed')
    await waitFor(() => expect(chatBarProps.current?.disabled).toBe(true))
  })
})
