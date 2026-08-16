/**
 * Roadmaps plugin — Milestones view.
 *
 * Milestone / objective nodes of the active version, grouped by their
 * parent node when one exists (flat otherwise), with progress and owner.
 */

import { useCallback, useMemo } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Codicon, EmptyState, StatusDot, cn } from '@hermes/plugin-sdk'
import { NODE_TONE, NodeStateTag, ProgressBar, SectionTitle } from '../ui.js'
import { groupMilestones, milestoneNodes, nodeLabel, plural } from '../data.js'

function MilestoneRow({ node, selected, onSelect, compact }) {
  const onClick = useCallback(() => onSelect(node.node_id), [node.node_id, onSelect])

  return jsxs('button', {
    type: 'button',
    onClick,
    className: cn(
      'group flex w-full flex-col gap-1 px-2 py-1.5 text-left transition-colors',
      selected ? 'bg-primary/[0.06]' : 'hover:bg-(--chrome-action-hover)'
    ),
    children: [
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx(StatusDot, { tone: NODE_TONE[node.state] ?? 'muted' }),
          jsx('span', { className: 'min-w-0 flex-1 truncate text-xs font-medium', children: nodeLabel(node) }),
          !compact ? jsx('span', { className: 'font-mono text-[0.6rem] uppercase text-(--ui-text-quaternary)', children: node.kind }) : null,
          !compact ? jsx(NodeStateTag, { state: node.state }) : null
        ]
      }),
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-3.5',
        children: [
          jsx(ProgressBar, { value: node.progress }),
          node.owner_agent
            ? jsxs('span', {
                className: 'inline-flex min-w-0 items-center gap-1 truncate text-[0.625rem] text-(--ui-text-tertiary)',
                children: [jsx(Codicon, { name: 'person', size: '0.65rem' }), jsx('span', { className: 'truncate', children: node.owner_agent })]
              })
            : null
        ]
      })
    ]
  })
}

export function MilestonesView({ version, selectedId, onSelect, compact }) {
  const nodes = useMemo(() => milestoneNodes(version), [version])
  const groups = useMemo(() => groupMilestones(version), [version])

  if (nodes.length === 0) {
    return jsx(EmptyState, {
      title: 'No milestones',
      description: 'The active version contains no milestones or objectives.'
    })
  }

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      jsx(SectionTitle, {
        right: jsx('span', { className: 'tabular-nums text-(--ui-text-quaternary)', children: plural(nodes.length, 'item') }),
        children: 'Milestones & objectives'
      }),
      groups.map((g, gi) =>
        jsxs(
          'div',
          {
            className: 'flex flex-col',
            children: [
              g.label
                ? jsxs('div', {
                    className: 'flex items-center gap-1 px-1 py-1 text-[0.625rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
                    children: [
                      jsx(Codicon, { name: 'milestone', size: '0.65rem' }),
                      jsx('span', { className: 'truncate', children: g.label }),
                      jsx('span', { className: 'tabular-nums text-(--ui-text-quaternary)', children: g.nodes.length })
                    ]
                  })
                : null,
              jsxs('div', {
                className: 'flex flex-col divide-y divide-(--ui-stroke-tertiary)',
                children: g.nodes.map((n) => jsx(MilestoneRow, { node: n, selected: n.node_id === selectedId, onSelect, compact }, n.node_id))
              })
            ]
          },
          `group-${gi}`
        )
      )
    ]
  })
}
