/**
 * Roadmaps plugin — live plan draft.
 *
 * The Vision session streams the architect's plan as a ```json fence; this
 * module accumulates that stream and renders the plan as it is sculpted, live,
 * next to the embedded chat. The LAST complete JSON fence wins; a "drafting"
 * fallback shows while the agent is still writing.
 */

import { useEffect, useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Badge, Button, Codicon, host } from '@hermes/plugin-sdk'
import { SectionTitle } from '../ui.js'
import { extractPlanJsonBlock, planPreviewFromJson, plural } from '../data.js'

/**
 * Accumulate the Vision session's assistant stream (filtered to its runtime
 * session id) and derive the live plan preview. Scope-bound: the caller must
 * remount (or reset) when the roadmap changes.
 */
export function useVisionDraft(visionSid) {
  const [draftText, setDraftText] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!visionSid) return undefined
    const offDelta = host.onEvent('message.delta', (ev) => {
      if (ev.session_id !== visionSid) return
      const text = ev.payload?.text
      if (typeof text === 'string' && text !== '') setDraftText((cur) => cur + text)
    })
    const offComplete = host.onEvent('message.complete', (ev) => {
      if (ev.session_id !== visionSid) return
      if (ev.payload?.status === 'error') {
        setError((cur) => cur || { code: null, hint: 'The Vision session ended with an error before a plan draft was produced.' })
      }
    })
    return () => {
      offDelta()
      offComplete()
    }
  }, [visionSid])

  const preview = useMemo(() => {
    if (!draftText.trim()) return null
    const block = extractPlanJsonBlock(draftText)
    return block ? planPreviewFromJson(block) : null
  }, [draftText])

  return { draftText, preview, error, reset: () => setDraftText('') }
}

const KIND_ICON = {
  objective: 'target',
  milestone: 'milestone',
  phase: 'chevron-right',
  decision: 'law'
}

/** Build a parent → children tree from the flat node list (parent_node_id). */
function buildTree(nodes) {
  const byId = new Map()
  for (const n of nodes) byId.set(n.node_id, { node: n, children: [] })
  const roots = []
  for (const n of nodes) {
    const entry = byId.get(n.node_id)
    const parent = n.parent_node_id ? byId.get(n.parent_node_id) : null
    if (parent) parent.children.push(entry)
    else roots.push(entry)
  }
  return roots
}

function DraftNode({ node, children }) {
  return jsxs('div', {
    className: 'flex flex-col',
    children: [
      jsxs('div', {
        className: 'flex items-center gap-1.5 px-1 py-0.5',
        children: [
          jsx(Codicon, { name: KIND_ICON[node.kind] ?? 'circle-outline', size: '0.7rem', className: 'shrink-0 text-(--ui-text-tertiary)' }),
          jsx('span', { className: 'min-w-0 flex-1 truncate text-xs', children: node.title || node.node_id }),
          node.kind ? jsx(Badge, { size: 'xs', variant: 'outline', children: node.kind }) : null
        ]
      }),
      children.length > 0
        ? jsx('div', {
            className: 'ml-2 flex flex-col border-l border-(--ui-stroke-tertiary) pl-3',
            children: children.map((c) => jsx(DraftNode, { node: c.node, children: c.children }, c.node.node_id))
          })
        : null
    ]
  })
}

export function PlanDraftLive({ preview, draftText, activeSessionId, visionSid, saveBusy, onSave }) {
  const hasPreview = preview !== null
  const roots = hasPreview ? buildTree(preview.nodes) : []
  return jsxs('div', {
    className: 'flex min-h-0 flex-col gap-1',
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
        children: 'Plan draft'
      }),
      hasPreview
        ? jsxs('div', {
            className: 'flex min-h-0 flex-col gap-1',
            children: [
              jsx('div', { className: 'truncate text-xs font-medium', children: preview.title || 'Untitled plan' }),
              jsx('div', {
                className: 'flex flex-wrap items-center gap-1.5 text-[0.625rem] text-(--ui-text-quaternary)',
                children: `${plural(preview.counts.nodes, 'node')} · ${plural(preview.counts.relations, 'relation')} · ${plural(preview.counts.todos, 'todo')}`
              }),
              roots.length > 0
                ? jsx('div', {
                    className: 'flex flex-col gap-0.5 overflow-auto',
                    children: roots.map((r) => jsx(DraftNode, { node: r.node, children: r.children }, r.node.node_id))
                  })
                : null
            ]
          })
        : jsxs('div', {
            className: 'flex items-center gap-1.5 text-[0.625rem] text-(--ui-text-tertiary)',
            children: [
              jsx('span', {
                className: 'truncate',
                children:
                  activeSessionId === visionSid
                    ? 'Sculpting the plan in the Vision chat…'
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
