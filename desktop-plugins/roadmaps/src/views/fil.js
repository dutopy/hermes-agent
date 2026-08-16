/**
 * Roadmaps plugin — Thread view ("what to do now").
 *
 * Actionable nodes (ready / in_progress / blocked, blocked first) with
 * dependency, blocker, and dependant info, plus the implicit critical path.
 */

import { useCallback, useMemo } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Codicon, EmptyState, StatusDot, cn } from '@hermes/plugin-sdk'
import { NODE_TONE, NodeStateTag, ProgressBar, SectionTitle } from '../ui.js'
import { criticalChain, nodeBlockers, nodeDependants, nodeDepsInfo, nodeLabel, plural, threadNodes } from '../data.js'

function CriticalChainStrip({ chain, version, selectedId, onSelect }) {
  const byId = new Map((version?.nodes ?? []).map((n) => [n.node_id, n]))
  const ordered = [...chain].reverse() // leaf dependency → deepest dependant
  const parts = []
  ordered.forEach((id, i) => {
    if (i > 0) {
      parts.push(jsx(Codicon, { name: 'chevron-right', size: '0.6rem', className: 'shrink-0 text-(--ui-text-quaternary)' }, `sep-${i}`))
    }
    parts.push(
      jsx(
        'button',
        {
          type: 'button',
          onClick: () => onSelect(id),
          title: nodeLabel(byId.get(id)),
          className: cn(
            'min-w-0 max-w-44 truncate hover:underline',
            id === selectedId ? 'font-medium text-primary' : 'text-(--ui-text-secondary) hover:text-foreground'
          ),
          children: nodeLabel(byId.get(id))
        },
        id
      )
    )
  })
  return jsxs('div', {
    className: 'flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-[3px] bg-(--ui-bg-quaternary) px-2 py-1 text-[0.625rem]',
    children: [
      jsx('span', { className: 'mr-1 font-medium uppercase tracking-wide text-(--ui-text-tertiary)', children: 'Critical path' }),
      ...parts
    ]
  })
}

export function NodeRow({ node, version, selected, onSelect, compact, dense }) {
  const onClick = useCallback(() => onSelect(node.node_id), [node.node_id, onSelect])
  const deps = useMemo(() => nodeDepsInfo(node, version), [node, version])
  const dependants = useMemo(() => nodeDependants(node, version), [node, version])
  const blockers = useMemo(() => nodeBlockers(node, version), [node, version])
  const pendingCount = deps.total - deps.satisfied

  // Dense column row: dot, kind · title, state tag and progress on ONE line
  // (thread column in wide/mid grids and the compact single column).
  if (dense) {
    return jsxs('button', {
      type: 'button',
      onClick,
      className: cn(
        'group flex w-full items-center gap-2 px-2 py-1 text-left transition-colors',
        selected ? 'bg-primary/[0.06]' : 'hover:bg-(--chrome-action-hover)'
      ),
      children: [
        jsx(StatusDot, { tone: NODE_TONE[node.state] ?? 'muted' }),
        jsxs('span', {
          className: 'min-w-0 flex-1 truncate text-xs font-medium',
          children: [
            jsx('span', { className: cn('text-[0.625rem]', selected ? 'text-primary' : 'text-(--ui-text-tertiary)'), children: `${node.kind} · ` }),
            nodeLabel(node)
          ]
        }),
        jsx(NodeStateTag, { state: node.state }),
        jsx(ProgressBar, { value: node.progress })
      ]
    })
  }

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
          jsxs('span', {
            className: 'min-w-0 flex-1 truncate text-xs font-medium',
            children: [
              jsx('span', { className: cn('text-[0.625rem]', selected ? 'text-primary' : 'text-(--ui-text-tertiary)'), children: `${node.kind} · ` }),
              nodeLabel(node)
            ]
          }),
          !compact ? jsx(NodeStateTag, { state: node.state }) : null
        ]
      }),
      !compact
        ? jsxs('div', {
            className: 'flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-3.5',
            children: [
              deps.total > 0
                ? pendingCount === 0
                  ? jsxs('span', {
                      className: 'inline-flex items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)',
                      children: [jsx(Codicon, { name: 'check', size: '0.65rem' }), `${deps.satisfied}/${deps.total} deps satisfied`]
                    })
                  : jsxs('span', {
                      className: 'inline-flex items-center gap-1 text-[0.625rem] text-amber-500/90 dark:text-amber-300/90',
                      title: deps.deps.filter((d) => !d.satisfied).map((d) => nodeLabel(d.target) || d.targetId).join(', '),
                      children: [jsx(Codicon, { name: 'hourglass', size: '0.65rem' }), `${plural(pendingCount, 'pending dep')}`]
                    })
                : null,
              blockers.length > 0
                ? jsxs('span', {
                    className: 'inline-flex items-center gap-1 text-[0.625rem] text-destructive',
                    children: [jsx(Codicon, { name: 'debug-disconnect', size: '0.65rem' }), `${plural(blockers.length, 'blocker')}`]
                  })
                : null,
              dependants.length > 0
                ? jsxs('span', {
                    className: 'inline-flex items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)',
                    children: [jsx(Codicon, { name: 'arrow-down', size: '0.65rem' }), `${plural(dependants.length, 'dependant')}`]
                  })
                : null,
              jsxs('span', {
                className: 'ml-auto flex shrink-0 items-center gap-2',
                children: [
                  jsx(ProgressBar, { value: node.progress }),
                  node.owner_agent
                    ? jsxs('span', {
                        className: 'inline-flex min-w-0 max-w-32 items-center gap-1 truncate text-[0.625rem] text-(--ui-text-tertiary)',
                        children: [jsx(Codicon, { name: 'person', size: '0.65rem' }), jsx('span', { className: 'truncate', children: node.owner_agent })]
                      })
                    : null
                ]
              })
            ]
          })
        : null,
      node.state === 'blocked' && node.block_reason
        ? jsxs('div', {
            className: 'flex items-start gap-1 pl-3.5 text-[0.625rem] text-destructive',
            children: [
              jsx(Codicon, { name: 'debug-disconnect', size: '0.7rem', className: 'mt-px shrink-0' }),
              jsx('span', { className: 'whitespace-pre-wrap break-words', children: node.block_reason })
            ]
          })
        : null
    ]
  })
}

export function ThreadView({ version, selectedId, onSelect, compact, dense }) {
  const nodes = threadNodes(version)
  const chain = useMemo(() => criticalChain(version), [version])

  if (nodes.length === 0) {
    return jsx(EmptyState, {
      title: 'Nothing in flight',
      description: 'No ready, in_progress, or blocked nodes in the active version of this roadmap.'
    })
  }

  return jsxs('div', {
    className: 'flex flex-col gap-1.5',
    children: [
      chain.length > 1 ? jsx(CriticalChainStrip, { chain, version, selectedId, onSelect }) : null,
      jsx(SectionTitle, {
        right: jsx('span', { className: 'tabular-nums text-(--ui-text-quaternary)', children: plural(nodes.length, 'node') }),
        children: 'Thread'
      }),
      jsxs('div', {
        className: 'flex flex-col divide-y divide-(--ui-stroke-tertiary)',
        children: nodes.map((n) => jsx(NodeRow, { node: n, version, selected: n.node_id === selectedId, onSelect, compact, dense }, n.node_id))
      })
    ]
  })
}
