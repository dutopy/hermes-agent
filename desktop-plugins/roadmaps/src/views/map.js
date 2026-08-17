/**
 * Roadmaps plugin — Map view (cartography + relations combined).
 *
 * The primary project-tracking surface: the plan cartography (objective →
 * milestones → phases → todos, with live kanban/worker state) plus the
 * canonical relations (depends_on, blocks) of the active version. Both are
 * pure projections of the active version; the Kanban stays the executor.
 */

import { useCallback, useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Codicon, EmptyState, cn } from '@hermes/plugin-sdk'
import config from '../config.json'
import { SectionTitle } from '../ui.js'
import { mapRelations, nodeLabel } from '../data.js'
import { BoardView } from './board.js'

const RELATION_LABEL = config.relation.label
const RELATION_ICON = config.relation.icon

export function RelationRow({ rel, selectedNodeId, onSelect }) {
  const onFrom = useCallback(() => onSelect(rel.from_node_id), [rel.from_node_id, onSelect])
  const onTo = useCallback(() => onSelect(rel.to_node_id), [rel.to_node_id, onSelect])

  return jsxs('div', {
    className: cn(
      'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2 py-1.5 text-xs transition-colors',
      (rel.from_node_id === selectedNodeId || rel.to_node_id === selectedNodeId) && 'bg-primary/[0.04]'
    ),
    children: [
      jsxs('button', {
        type: 'button',
        onClick: onFrom,
        className: cn('min-w-0 truncate text-left hover:underline', rel.from_node_id === selectedNodeId ? 'text-primary' : 'text-foreground'),
        children: nodeLabel(rel.from)
      }),
      jsxs('span', {
        className: 'flex shrink-0 items-center gap-1 text-[0.625rem] uppercase tracking-wide text-(--ui-text-tertiary)',
        children: [jsx(Codicon, { name: RELATION_ICON[rel.kind] ?? 'arrow-right', size: '0.65rem' }), RELATION_LABEL[rel.kind] ?? rel.kind]
      }),
      jsxs('button', {
        type: 'button',
        onClick: onTo,
        className: cn('min-w-0 truncate text-right hover:underline', rel.to_node_id === selectedNodeId ? 'text-primary' : 'text-foreground'),
        children: nodeLabel(rel.to)
      })
    ]
  })
}

export function MapView({ version, selectedId, onSelect, scope }) {
  const [showInactive, setShowInactive] = useState(false)
  const rels = useMemo(() => mapRelations(version, { includeInactive: showInactive }), [version, showInactive])

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      jsx(BoardView, { scope, selectedId, onSelect }),
      jsxs('div', {
        className: 'flex flex-col gap-1.5',
        children: [
          jsxs(SectionTitle, {
            right: jsx('button', {
              type: 'button',
              onClick: () => setShowInactive((v) => !v),
              className: 'rounded-[3px] px-1 text-[0.625rem] normal-case tracking-normal text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
              children: showInactive ? 'active only' : 'include inactive'
            }),
            children: ['Relations', ` (${rels.length})`]
          }),
          rels.length === 0
            ? jsx(EmptyState, {
                title: showInactive ? 'No relations' : 'No active relations',
                description: 'Each row is a canonical relation (depends on, blocks) of the active version.'
              })
            : jsxs('div', {
                className: 'flex flex-col divide-y divide-(--ui-stroke-tertiary)',
                children: rels.map((r) => jsx(RelationRow, { rel: r, selectedNodeId: selectedId, onSelect }, r.relation_id))
              })
        ]
      })
    ]
  })
}
