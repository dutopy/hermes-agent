import type { ConnectionState } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useQueryClient } from '@tanstack/react-query'
import { atom, computed, type WritableAtom } from 'nanostores'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { GatewayRequester } from '@/app/contrib/types'
import { useModelControls } from '@/app/session/hooks/use-model-controls'
import { blobToDataUrl } from '@/app/session/hooks/use-prompt-actions/utils'
import { ModelMenuPanel } from '@/app/shell/model-menu-panel'
import { formatRefValue } from '@/components/assistant-ui/directive-text'
import { transcribeAudioForProfile } from '@/hermes'
import type { ChatMessage } from '@/lib/chat-messages'
import { createComposerAttachmentScope } from '@/store/composer'
import { gatewayForProfile, requestGatewayForProfile, subscribeProfileGateway } from '@/store/gateway'
import { sessionAwaitingInput } from '@/store/prompts'
import { $sessionStates, sessionRuntimeState } from '@/store/session-states'

import { type ComposerScope, ComposerScopeProvider } from './composer/scope'
import { useComposerActions } from './hooks/use-composer-actions'
import { useSessionTileActions } from './session-tile-actions'
import { type SessionView, SessionViewProvider } from './session-view'
import { lastVisibleMessageIsUser } from './thread-loading'

import { ChatView } from '.'

const NO_MESSAGES: ChatMessage[] = []
const noop = () => undefined

interface SessionSurfaceView extends SessionView {
  $gatewayState: WritableAtom<ConnectionState>
}

function buildSessionSurfaceView(profile: string, runtimeSessionId: string, storedSessionId: string): SessionSurfaceView {
  const $runtimeId = atom<null | string>(runtimeSessionId)
  const $state = computed($sessionStates, states => sessionRuntimeState(states, profile, runtimeSessionId))
  const $messages = computed($state, state => state?.messages ?? NO_MESSAGES)
  const $gatewayState = atom(gatewayForProfile(profile)?.connectionState ?? 'closed')

  return {
    kind: 'tile',
    profile,
    $awaitingResponse: computed($state, state => Boolean(state?.awaitingResponse)),
    $busy: computed($state, state => Boolean(state?.busy)),
    $cwd: computed($state, state => state?.cwd ?? ''),
    $fast: computed($state, state => Boolean(state?.fast)),
    $gatewayState,
    $lastVisibleIsUser: computed($messages, lastVisibleMessageIsUser),
    $messages,
    $messagesEmpty: computed($messages, messages => messages.length === 0),
    $model: computed($state, state => state?.model ?? ''),
    $provider: computed($state, state => state?.provider ?? ''),
    $reasoningEffort: computed($state, state => state?.reasoningEffort ?? ''),
    $runtimeId,
    $storedId: atom(storedSessionId)
  }
}

export interface SessionSurfaceChatProps {
  profile: string
  runtimeSessionId: string
  storedSessionId: string
}

/** The native transcript/composer tree shared by plugin surfaces and tiles. */
export function SessionSurfaceChat({ profile, runtimeSessionId, storedSessionId }: SessionSurfaceChatProps) {
  const view = useMemo(
    () => buildSessionSurfaceView(profile, runtimeSessionId, storedSessionId),
    [profile, runtimeSessionId, storedSessionId]
  )

  const requestSurfaceGateway = useCallback<GatewayRequester>(
    (method, params = {}, timeout, signal) =>
      requestGatewayForProfile(profile, method, { ...params, profile }, timeout, signal),
    [profile]
  )

  const gateway = gatewayForProfile(profile)
  const queryClient = useQueryClient()
  const modelControls = useModelControls({ profile, queryClient, requestGateway: requestSurfaceGateway })
  const cwd = useStore(view.$cwd)

  useEffect(
    () =>
      subscribeProfileGateway(profile, () => {
        view.$gatewayState.set(gatewayForProfile(profile)?.connectionState ?? 'closed')
      }),
    [profile, view.$gatewayState]
  )

  const attachments = useRef(createComposerAttachmentScope()).current

  const scope = useMemo<ComposerScope>(
    () => ({
      $awaitingInput: sessionAwaitingInput(runtimeSessionId, profile),
      $messages: view.$messages,
      attachments,
      profile,
      target: `surface:${profile}:${storedSessionId}`
    }),
    [attachments, profile, runtimeSessionId, storedSessionId, view.$messages]
  )

  const actions = useSessionTileActions({
    profile,
    requestGateway: requestSurfaceGateway,
    runtimeId: runtimeSessionId,
    scope,
    storedSessionId
  })

  const composer = useComposerActions({
    activeSessionId: runtimeSessionId,
    currentCwd: cwd,
    requestGateway: requestSurfaceGateway,
    scope: { add: attachments.add, remove: attachments.remove, target: scope.target, update: attachments.update }
  })

  const { addContextRefAttachment, pasteClipboardImage, pickContextPaths, pickImages, removeAttachment } = composer

  const onAddUrl = useCallback(
    (url: string) => addContextRefAttachment(`@url:${formatRefValue(url)}`, url),
    [addContextRefAttachment]
  )

  const onPasteClipboardImage = useCallback(
    (opts?: { silent?: boolean }) => pasteClipboardImage(opts),
    [pasteClipboardImage]
  )

  const onPickFiles = useCallback(() => void pickContextPaths('file'), [pickContextPaths])
  const onPickFolders = useCallback(() => void pickContextPaths('folder'), [pickContextPaths])
  const onPickImages = useCallback(() => void pickImages(), [pickImages])
  const onRemoveAttachment = useCallback((id: string) => void removeAttachment(id), [removeAttachment])

  const onTranscribeAudio = useCallback(
    async (audio: Blob) =>
      (await transcribeAudioForProfile(profile, await blobToDataUrl(audio), audio.type)).transcript,
    [profile]
  )

  return (
    <SessionViewProvider value={view}>
      <ComposerScopeProvider value={scope}>
        <ChatView
          gateway={gateway}
          modelMenuContent={
            <ModelMenuPanel
              gateway={gateway || undefined}
              onSelectModel={modelControls.selectModel}
              profile={profile}
              requestGateway={requestSurfaceGateway}
            />
          }
          onAddContextRef={addContextRefAttachment}
          onAddUrl={onAddUrl}
          onAttachDroppedItems={composer.attachDroppedItems}
          onAttachImageBlob={composer.attachImageBlob}
          onAttachPrCommentUrl={composer.attachPrCommentUrl}
          onCancel={actions.cancelRun}
          onDeleteSelectedSession={noop}
          onDismissError={actions.dismissError}
          onEdit={actions.editMessage}
          onPasteClipboardImage={onPasteClipboardImage}
          onPickFiles={onPickFiles}
          onPickFolders={onPickFolders}
          onPickImages={onPickImages}
          onReload={actions.reloadFromMessage}
          onRemoveAttachment={onRemoveAttachment}
          onRestoreToMessage={actions.restoreToMessage}
          onRetryResume={noop}
          onSteer={actions.steerPrompt}
          onSubmit={actions.submitText}
          onThreadMessagesChange={actions.handleThreadMessagesChange}
          onToggleSelectedPin={noop}
          onTranscribeAudio={onTranscribeAudio}
        />
      </ComposerScopeProvider>
    </SessionViewProvider>
  )
}
