/**
 * Roadmaps plugin — Plan view.
 *
 * Plan management: an embedded, collapsible Vision chat (planning rules →
 * questions → live-sculpted draft) beside a live plan preview, plus the
 * versioned timeline of the roadmap. The LAST complete ```json fence of the
 * Vision stream is rendered as the live draft; Save plan persists it
 * (plans.create → 'proposed'), validated versions can be activated
 * (plans.activate). All writes go through the data.js RPC drivers.
 */

import { useCallback, useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Badge, Button, Codicon, EmptyState, cn, host, useQueryClient, useValue } from '@hermes/plugin-sdk'
import { SectionTitle } from '../ui.js'
import {
  ID,
  activatePlan,
  attachVisionSession,
  createPlan,
  formatDate,
  getPlanningRules,
  mutationErrorCopy,
  planVersions,
  plural,
  rpcError,
  startVisionSession
} from '../data.js'
import { VisionLane } from './vision.js'
import { PlanDraftLive, useVisionDraft } from './plan-draft.js'

function VersionRow({ v, active, activating, onActivate }) {
  const isActive = v.version === active
  const canActivate = v.state === 'validated' && !isActive
  return jsxs('div', {
    className: 'relative flex gap-3 px-0.5 py-1.5',
    children: [
      jsx('span', {
        className: cn('relative z-10 mt-1.5 size-2 shrink-0 rounded-full', isActive ? 'bg-(--ui-accent)' : 'bg-(--ui-stroke-secondary)')
      }),
      jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsxs('div', {
            className: 'flex flex-wrap items-center gap-2',
            children: [
              jsx('span', {
                className: cn('min-w-0 truncate font-mono text-xs', isActive ? 'font-semibold text-foreground' : 'text-(--ui-text-secondary)'),
                children: `v${v.version}`
              }),
              v.title
                ? jsx('span', { className: 'min-w-0 truncate text-[0.625rem] text-(--ui-text-tertiary)', children: v.title })
                : null,
              isActive ? jsx(Badge, { size: 'xs', variant: 'outline', children: 'Active' }) : null,
              jsx('span', { className: 'font-mono text-[0.625rem] uppercase text-(--ui-text-tertiary)', children: v.state }),
              v.created_at
                ? jsx('span', { className: 'ml-auto text-[0.625rem] tabular-nums text-(--ui-text-quaternary)', children: formatDate(v.created_at) })
                : null
            ]
          }),
          v.source
            ? jsxs('div', {
                className: 'mt-0.5 flex min-w-0 items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)',
                children: [jsx('span', { className: 'shrink-0 font-medium uppercase tracking-wide', children: 'source' }), jsx('span', { className: 'truncate', children: v.source })]
              })
            : null,
          v.reason
            ? jsx('div', { className: 'mt-0.5 line-clamp-2 text-[0.625rem] text-(--ui-text-tertiary)', children: v.reason })
            : null,
          canActivate
            ? jsxs('div', {
                className: 'mt-1 flex items-center gap-1.5',
                children: [
                  jsx(Button, {
                    type: 'button',
                    size: 'xs',
                    variant: 'secondary',
                    disabled: activating !== null,
                    onClick: () => onActivate(v.version),
                    className: 'gap-1',
                    children: [jsx(Codicon, { name: 'play', size: '0.7rem' }), activating === v.version ? 'Activating…' : 'Activate']
                  }),
                  jsx('span', { className: 'text-[0.625rem] text-(--ui-text-quaternary)', children: 'Supersedes the currently active version.' })
                ]
              })
            : null
        ]
      })
    ]
  })
}

export function PlanView({ snapshot, scope, actor, onMutated }) {
  const queryClient = useQueryClient()
  const versions = planVersions(snapshot)
  const active = snapshot?.roadmap?.active_version
  const activeSessionId = useValue(host.state.activeSessionId)

  const [visionSession, setVisionSession] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [activating, setActivating] = useState(null)
  const [error, setError] = useState(null)

  const { draftText, preview, reset } = useVisionDraft(visionSession?.runtimeSessionId ?? null)

  // Vision state is scope-bound: switching roadmap (or unmount) forgets the
  // draft session and its accumulated text.
  const scopeKey = scope ? `${scope.profile}/${scope.projectId}/${scope.roadmapId}` : ''
  useEffect(() => {
    setVisionSession(null)
    setError(null)
  }, [scopeKey])

  const start = useCallback(async () => {
    if (!scope || busy) return
    setBusy(true)
    setError(null)
    try {
      const rules = await getPlanningRules()
      const identity = await startVisionSession(scope.profile, rules.rules.prompt)
      await attachVisionSession(scope.profile, scope.projectId, scope.roadmapId, identity.storedSessionId, active ?? 0, actor, null)
      setVisionSession(identity)
      host.notify({ kind: 'success', title: 'Vision ready', message: 'The Vision session is ready. Plan first, then propose the plan.' })
    } catch (err) {
      setError({ code: rpcError(err).code })
    } finally {
      setBusy(false)
    }
  }, [active, actor, busy, scope])

  const savePlan = useCallback(async () => {
    if (!scope || !preview || saveBusy) return
    setSaveBusy(true)
    setError(null)
    try {
      await createPlan(
        scope.profile,
        scope.projectId,
        scope.roadmapId,
        {
          nodes: preview.nodes,
          relations: preview.relations,
          todos: preview.todos,
          title: preview.title,
          source: 'vision',
          reason: 'Draft created in the Vision session.'
        },
        actor
      )
      await queryClient.invalidateQueries({ queryKey: [ID, 'list', scope.profile] })
      await queryClient.invalidateQueries({ queryKey: [ID, 'steer', scope.profile, scope.projectId, scope.roadmapId] })
      if (onMutated) onMutated()
      host.notify({ kind: 'success', title: 'Plan saved', message: `Plan version saved (${preview.counts.nodes} nodes, ${preview.counts.relations} relations, ${preview.counts.todos} todos).` })
      reset()
    } catch (err) {
      setError({ code: rpcError(err).code })
    } finally {
      setSaveBusy(false)
    }
  }, [actor, onMutated, preview, queryClient, reset, saveBusy, scope])

  const activate = useCallback(
    async (version) => {
      if (!scope || activating !== null) return
      const expected = snapshot?.roadmap?.active_version ?? 0
      setActivating(version)
      setError(null)
      try {
        await activatePlan(scope.profile, scope.projectId, scope.roadmapId, version, expected, actor)
        await queryClient.invalidateQueries({ queryKey: [ID, 'list', scope.profile] })
        await queryClient.invalidateQueries({ queryKey: [ID, 'steer', scope.profile, scope.projectId, scope.roadmapId] })
        if (onMutated) onMutated()
        host.notify({ kind: 'success', title: 'Plan activated', message: `Version ${version} is now active.` })
      } catch (err) {
        setError({ code: rpcError(err).code })
      } finally {
        setActivating(null)
      }
    },
    [activating, actor, onMutated, queryClient, scope, snapshot]
  )

  const ec = mutationErrorCopy(error)

  return jsxs('div', {
    className: 'flex min-h-0 flex-1 flex-col gap-2',
    children: [
      visionSession
        ? jsxs('div', {
            className: 'flex min-h-0 flex-1 gap-2',
            children: [
              jsx('div', { className: 'flex min-w-0 flex-1 flex-col', children: jsx(VisionLane, { session: visionSession }) }),
              jsx('div', {
                className: 'flex w-[42%] min-w-0 flex-col overflow-auto border-l border-(--ui-stroke-tertiary) pl-2',
                children: jsx(PlanDraftLive, {
                  preview,
                  draftText,
                  activeSessionId,
                  visionSid: visionSession?.runtimeSessionId,
                  saveBusy,
                  onSave: () => void savePlan()
                })
              })
            ]
          })
        : null,
      error && ec
        ? jsxs('div', {
            className: 'flex items-start gap-1.5 rounded-[3px] bg-destructive/10 px-2 py-1 text-xs text-destructive',
            children: [
              jsx(Codicon, { name: 'error', size: '0.75rem', className: 'mt-px shrink-0' }),
              jsxs('span', { children: [ec.hint, ec.code != null ? ` (code ${ec.code})` : ''] })
            ]
          })
        : null,
      jsxs('div', {
        className: 'flex items-center justify-between gap-2 px-0.5',
        children: [
          jsx(SectionTitle, {
            right: jsx('span', { className: 'tabular-nums text-(--ui-text-quaternary)', children: plural(versions.length, 'version') }),
            children: 'Plan versions'
          }),
          jsx(Button, {
            type: 'button',
            size: 'xs',
            variant: visionSession ? 'secondary' : 'default',
            disabled: !scope || busy,
            onClick: () => void start(),
            className: 'gap-1',
            children: [jsx(Codicon, { name: visionSession ? 'debug-restart' : 'add', size: '0.7rem' }), busy ? 'Starting…' : 'Start planning']
          })
        ]
      }),
      versions.length === 0
        ? jsx(EmptyState, {
            title: 'No versions yet',
            description: 'Start a Vision session to draft the roadmap plan — the first published version lands here once saved.'
          })
        : jsxs('div', {
            className: 'relative mt-1 flex flex-col',
            children: [
              jsx('span', { className: 'absolute bottom-2 left-[3px] top-2 w-px bg-(--ui-stroke-tertiary)' }),
              versions.map((v) => jsx(VersionRow, { v, active, activating, onActivate: (version) => void activate(version) }, String(v.version)))
            ]
          })
    ]
  })
}
