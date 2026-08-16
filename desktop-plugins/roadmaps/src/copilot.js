/**
 * Roadmaps plugin — orchestration copilot.
 *
 * A data-driven strip computed ONLY from the active version's real nodes
 * and relations (no LLM, no static blocks, no fixtures): Next action plus
 * Now / In flight / Waiting / Blocked chip groups.
 */

import { useMemo } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Codicon, StatusDot, cn } from '@hermes/plugin-sdk'
import config from './config.json'
import { NODE_TONE } from './ui.js'
import { copilotSections, nextAction, nodeLabel, plural } from './data.js'

const NEXT_ACTION_LABEL = config.nextActionLabel

function CopilotChip({ node, selected, onSelect }) {
  return jsx('button', {
    type: 'button',
    onClick: () => onSelect(node.node_id),
    title: `${node.kind} · ${node.state}`,
    className: cn(
      'inline-flex min-w-0 max-w-full items-center gap-1 truncate rounded-[3px] px-1.5 py-0.5 text-[0.6875rem] transition-colors',
      selected
        ? 'bg-primary/10 text-primary'
        : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground'
    ),
    children: [jsx(StatusDot, { tone: NODE_TONE[node.state] ?? 'muted' }), jsx('span', { className: 'truncate', children: nodeLabel(node) })]
  })
}

/** Dense chips: at most 3 per group (2 when dense), then a quiet "+N" overflow marker. */
function CopilotChips({ nodes, selectedId, onSelect, dense }) {
  const shown = nodes.slice(0, dense ? 2 : 3)
  const extra = nodes.length - shown.length
  return jsxs('span', {
    className: 'flex min-w-0 flex-wrap items-center gap-1',
    children: [
      ...shown.map((n) => jsx(CopilotChip, { node: n, selected: n.node_id === selectedId, onSelect }, n.node_id)),
      extra > 0 ? jsx('span', { className: 'text-[0.625rem] text-(--ui-text-quaternary)', children: `+${extra}` }, '__extra__') : null
    ]
  })
}

function NextActionRow({ action, selected, onSelect }) {
  if (!action) return null
  const { node, kind, pending } = action
  let detail
  if (kind === 'unblock') detail = 'Blocked — dependencies satisfied'
  else if (kind === 'claim') detail = 'Ready — dependencies satisfied'
  else if (kind === 'advance') detail = node.state === 'in_progress' ? `In flight${node.owner_agent ? ` · ${node.owner_agent}` : ''}` : 'Ready — dependencies satisfied'
  else if (kind === 'assign') detail = 'In progress without an owner'
  else detail = `Waiting on ${plural(pending, 'pending dependency')}`

  return jsxs('div', {
    className: 'flex items-center gap-1.5 text-[0.6875rem]',
    children: [
      jsxs('span', {
        className: 'inline-flex shrink-0 items-center gap-1 font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
        children: [jsx(Codicon, { name: 'target', size: '0.7rem' }), 'Next action']
      }),
      jsx('button', {
        type: 'button',
        onClick: () => onSelect(node.node_id),
        className: cn(
          'inline-flex min-w-0 max-w-full items-center gap-1 rounded-[3px] px-1.5 py-0.5 transition-colors',
          selected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-(--chrome-action-hover)'
        ),
        children: [
          jsx(StatusDot, { tone: NODE_TONE[node.state] ?? 'muted' }),
          jsx('span', { className: 'font-medium', children: NEXT_ACTION_LABEL[kind] ?? kind }),
          jsx('span', { className: 'truncate', children: nodeLabel(node) }),
          jsx('span', { className: 'text-(--ui-text-tertiary)', children: ['· ', detail] })
        ]
      })
    ]
  })
}

export function CopilotBar({ version, selectedId, onSelect, dense }) {
  const sections = useMemo(() => copilotSections(version), [version])
  const action = useMemo(() => nextAction(version), [version])

  const groups = (sections
    ? [
        { key: 'now', label: 'Now', codicon: 'play', nodes: sections.now },
        { key: 'inflight', label: 'In flight', codicon: 'list-ordered', nodes: sections.inflight },
        { key: 'waiting', label: 'Waiting', codicon: 'hourglass', nodes: sections.waiting },
        { key: 'blocked', label: 'Blocked', codicon: 'debug-disconnect', nodes: sections.blocked }
      ]
    : []
  ).filter((g) => g.nodes.length > 0)

  if (!action && groups.length === 0) {
    return jsx('div', {
      className: 'px-0.5 text-xs text-(--ui-text-tertiary)',
      children: 'Nothing actionable — every node is resolved or not ready yet.'
    })
  }

  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsx(NextActionRow, { action, selected: action ? action.node.node_id === selectedId : false, onSelect }),
      groups.length > 0
        ? jsxs('div', {
            className: 'flex flex-wrap items-center gap-x-4 gap-y-1.5',
            children: groups.map((g, i) =>
              jsxs(
                'div',
                {
                  className: cn('flex min-w-0 items-center gap-1.5', i > 0 && 'border-l border-(--ui-stroke-tertiary) pl-4'),
                  children: [
                    jsxs('span', {
                      className: 'flex shrink-0 items-center gap-1 text-[0.625rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
                      children: [jsx(Codicon, { name: g.codicon, size: '0.7rem' }), g.label]
                    }),
                    jsx('span', { className: 'text-[0.625rem] tabular-nums text-(--ui-text-quaternary)', children: g.nodes.length }),
                    jsx(CopilotChips, { nodes: g.nodes, selectedId, onSelect, dense })
                  ]
                },
                g.key
              )
            )
          })
        : null
    ]
  })
}
