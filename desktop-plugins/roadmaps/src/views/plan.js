/**
 * Roadmaps plugin — Plan view.
 *
 * Version timeline of the roadmap, newest first, with the active version
 * marked, plus the Vision draft flow (T5c): a Create button opens a native
 * chat session seeded with the versioned planning rules
 * (roadmaps.planning_rules → session.create source 'vision'), the assistant
 * stream is accumulated via message.delta (filtered to that session id)
 * into a compact plan preview (extractPlanJsonBlock), Save plan persists it
 * (plans.create → 'proposed'), and validated versions can be activated
 * (plans.activate). All writes go through the data.js RPC drivers; error
 * copy is stable English by code, never a backend message.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Badge, Button, Codicon, EmptyState, cn, host, useQueryClient, useValue } from '@hermes/plugin-sdk'
import { SectionTitle } from '../ui.js'
import {
  ID,
  activatePlan,
  createPlan,
  extractPlanJsonBlock,
  formatDate,
  getPlanningRules,
  mutationErrorCopy,
  planPreviewFromJson,
  planVersions,
  plural,
  rpcError,
  visionSessionCreate
} from '../data.js'

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
                className: cn('font-mono text-xs', isActive ? 'font-semibold text-foreground' : 'text-(--ui-text-secondary)'),
                children: `v${v.version}`
              }),
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

/**
 * Compact preview of the streamed Vision draft: proposed title, counts and
 * node-kind badges once a complete ```json fence has been parsed; a
 * "waiting" fallback while the agent is still drafting.
 */
function VisionDraftCard({ preview, draftText, activeSessionId, visionSid, saveBusy, onSave }) {
  const hasPreview = preview !== null
  return jsxs('div', {
    className: 'rounded-[3px] border border-(--ui-stroke-tertiary) px-2 py-1.5',
    children: [
      jsx(SectionTitle, {
        right: jsx(Button, {
          type: 'button',
          size: 'xs',
          variant: 'secondary',
          onClick: onSave,
          disabled: !hasPreview || saveBusy,
          className: 'gap-1',
          children: [jsx(Codicon, { name: 'pass-filled', size: '0.7rem' }), saveBusy ? 'Saving…' : 'Save plan']
        }),
        children: 'Vision draft'
      }),
      hasPreview
        ? jsxs('div', {
            className: 'flex flex-col gap-1',
            children: [
              jsx('div', { className: 'truncate text-xs font-medium', children: preview.title || 'Untitled plan' }),
              preview.kinds.length > 0
                ? jsxs('div', {
                    className: 'flex flex-wrap gap-1',
                    children: preview.kinds.map((k) => jsx(Badge, { size: 'xs', variant: 'outline', children: k }, k))
                  })
                : null,
              jsx('div', {
                className: 'flex flex-wrap items-center gap-1.5 text-[0.625rem] text-(--ui-text-quaternary)',
                children: `${plural(preview.counts.nodes, 'node')} · ${plural(preview.counts.relations, 'relation')} · ${plural(preview.counts.todos, 'todo')}`
              })
            ]
          })
        : jsxs('div', {
            className: 'flex items-center gap-1.5 text-[0.625rem] text-(--ui-text-tertiary)',
            children: [
              jsx('span', {
                className: 'truncate',
                children:
                  activeSessionId === visionSid
                    ? 'Drafting in the Vision chat…'
                    : 'Waiting for the Vision session to produce a plan draft…'
              }),
              draftText
                ? jsx('span', { className: 'shrink-0 tabular-nums text-(--ui-text-quaternary)', children: `${draftText.length} chars` })
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

  const [createBusy, setCreateBusy] = useState(false)
  const [visionSid, setVisionSid] = useState(null)
  const [draftText, setDraftText] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [activating, setActivating] = useState(null)
  const [error, setError] = useState(null)

  // Vision state is scope-bound: switching roadmap (or unmount) forgets the
  // draft session and its accumulated text.
  const scopeKey = scope ? `${scope.profile}/${scope.projectId}/${scope.roadmapId}` : ''
  useEffect(() => {
    setVisionSid(null)
    setDraftText('')
    setError(null)
  }, [scopeKey])

  // Accumulate the Vision session's assistant stream, filtered to the
  // runtime session id returned by session.create (events carry session_id).
  useEffect(() => {
    if (!visionSid) return undefined
    return host.onEvent('message.delta', (ev) => {
      if (ev.session_id !== visionSid) return
      const text = ev.payload?.text
      if (typeof text === 'string' && text !== '') setDraftText((cur) => cur + text)
    })
  }, [visionSid])

  // A failed turn surfaces as message.complete {status:'error'} — mapped to
  // generic guidance (the backend payload.error never reaches the DOM).
  useEffect(() => {
    if (!visionSid) return undefined
    return host.onEvent('message.complete', (ev) => {
      if (ev.session_id !== visionSid) return
      if (ev.payload?.status === 'error') {
        setError((cur) =>
          cur
            ? cur
            : { code: null, hint: 'The Vision session ended with an error before a plan draft was produced. Try Create again.' }
        )
      }
    })
  }, [visionSid])

  // The preview is derived from the accumulated stream: the LAST complete
  // ```json fence wins (extractPlanJsonBlock), null while still drafting.
  const preview = useMemo(() => {
    if (!draftText.trim()) return null
    const block = extractPlanJsonBlock(draftText)
    return block ? planPreviewFromJson(block) : null
  }, [draftText])

  const startVision = useCallback(async () => {
    if (!scope || createBusy) return
    setCreateBusy(true)
    setError(null)
    try {
      const rules = await getPlanningRules()
      const created = await visionSessionCreate(scope.profile, rules.rules.prompt)
      setVisionSid(created.session_id)
      setDraftText('')
      await host.openSession(created.stored_session_id, { profile: scope.profile })
    } catch (err) {
      setError({ code: rpcError(err).code })
    } finally {
      setCreateBusy(false)
    }
  }, [createBusy, scope])

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
          source: 'vision',
          reason: 'Draft created in the Vision session.'
        },
        actor
      )
      // Authoritative refresh: the roadmap list (lifecycle_state may change
      // to proposed) and the snapshot (the new version must appear here).
      await queryClient.invalidateQueries({ queryKey: [ID, 'list', scope.profile] })
      await queryClient.invalidateQueries({ queryKey: [ID, 'steer', scope.profile, scope.projectId, scope.roadmapId] })
      if (onMutated) onMutated()
      host.notify({ kind: 'success', title: 'Plan saved', message: `Plan version saved (${preview.counts.nodes} nodes, ${preview.counts.relations} relations, ${preview.counts.todos} todos).` })
      setDraftText('')
    } catch (err) {
      setError({ code: rpcError(err).code })
    } finally {
      setSaveBusy(false)
    }
  }, [actor, onMutated, preview, queryClient, saveBusy, scope])

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
    className: 'flex flex-col gap-1.5',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-2 px-0.5',
        children: [
          jsx(SectionTitle, {
            right: jsx('span', { className: 'tabular-nums text-(--ui-text-quaternary)', children: plural(versions.length, 'version') }),
            children: 'Plan history'
          }),
          jsx(Button, {
            type: 'button',
            size: 'xs',
            variant: 'secondary',
            disabled: !scope || createBusy,
            onClick: () => void startVision(),
            title: 'Open a Vision session seeded with the planning rules',
            className: 'gap-1',
            children: [jsx(Codicon, { name: 'add', size: '0.7rem' }), createBusy ? 'Starting…' : 'Create']
          })
        ]
      }),
      visionSid
        ? jsx(VisionDraftCard, { preview, draftText, activeSessionId, visionSid, saveBusy, onSave: () => void savePlan() })
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
      versions.length === 0
        ? jsx(EmptyState, {
            title: 'No versions yet',
            description: 'Create a plan draft from a Vision session — the first published version lands here once saved.'
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
