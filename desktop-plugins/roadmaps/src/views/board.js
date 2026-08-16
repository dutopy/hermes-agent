/**
 * Roadmaps plugin — Board view.
 *
 * Full plan cartography (objective → milestones → phases → todos) of the
 * active version, each todo showing the live state of its linked kanban card
 * and its owner worker. A pure projection — the Kanban stays the executor.
 */

import { useCallback } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Button, Codicon, EmptyState, ErrorState, Skeleton, StatusDot, cn } from '@hermes/plugin-sdk'
import config from '../config.json'
import { NodeStateTag, SectionTitle } from '../ui.js'
import { errorCopy, nodeLabel, plural } from '../data.js'
import { useRoadmapBoard } from '../state.js'

const CARD_TONE = config.board.cardTone

/** Live kanban card state for one todo (StatusDot tone + status). */
function CardTag({ card }) {
  if (!card || card.found !== true) {
    return jsx('span', {
      className: 'inline-flex items-center text-[0.625rem] text-(--ui-text-quaternary)',
      children: 'no card'
    })
  }
  return jsxs('span', {
    className: 'inline-flex items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)',
    children: [jsx(StatusDot, { tone: CARD_TONE[card.status] ?? 'muted' }), jsx('span', { children: card.status })]
  })
}

/** Owner lane worker for one todo (lane · model). */
function WorkerTag({ worker }) {
  if (!worker) return null
  const label = worker.lane ? (worker.model ? `${worker.lane} · ${worker.model}` : worker.lane) : worker.worker_id
  return jsxs('span', {
    className: 'inline-flex min-w-0 items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)',
    children: [jsx(Codicon, { name: 'person', size: '0.65rem' }), jsx('span', { className: 'truncate', children: label })]
  })
}

function TodoRow({ todo }) {
  return jsxs('div', {
    className: 'flex flex-col gap-0.5 py-0.5',
    children: [
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-x-2 gap-y-0.5',
        children: [
          jsx('span', { className: 'min-w-0 flex-1 truncate text-xs', children: todo.todo.title }),
          jsx(CardTag, { card: todo.card }),
          jsx(WorkerTag, { worker: todo.worker })
        ]
      }),
      todo.todo.acceptance
        ? jsx('div', { className: 'truncate text-[0.625rem] text-(--ui-text-quaternary)', children: todo.todo.acceptance })
        : null
    ]
  })
}

function PhaseGroup({ phase, selectedId, onSelect }) {
  const onClick = useCallback(() => onSelect(phase.node_id), [phase.node_id, onSelect])
  return jsxs('div', {
    className: 'flex flex-col border-l border-(--ui-stroke-tertiary) pl-2',
    children: [
      jsxs('button', {
        type: 'button',
        onClick,
        className: cn(
          'flex items-center gap-1.5 px-1 py-1 text-left transition-colors',
          phase.node_id === selectedId ? 'text-primary' : 'text-(--ui-text-secondary) hover:text-foreground'
        ),
        children: [
          jsx(Codicon, { name: 'chevron-right', size: '0.65rem', className: 'shrink-0' }),
          jsx('span', { className: 'min-w-0 flex-1 truncate text-xs', children: nodeLabel(phase) }),
          jsx(NodeStateTag, { state: phase.state })
        ]
      }),
      phase.todos.length === 0
        ? jsx('div', { className: 'px-3 py-0.5 text-[0.625rem] text-(--ui-text-quaternary)', children: 'No todos' })
        : jsx('div', {
            className: 'flex flex-col pl-4',
            children: phase.todos.map((t) => jsx(TodoRow, { todo: t }, t.todo.todo_id))
          })
    ]
  })
}

function MilestoneGroup({ milestone, selectedId, onSelect }) {
  const onClick = useCallback(() => onSelect(milestone.node_id), [milestone.node_id, onSelect])
  return jsxs('div', {
    className: 'flex flex-col',
    children: [
      jsxs('button', {
        type: 'button',
        onClick,
        className: cn(
          'flex items-center gap-2 px-1 py-1.5 text-left transition-colors',
          milestone.node_id === selectedId ? 'bg-primary/[0.06]' : 'hover:bg-(--chrome-action-hover)'
        ),
        children: [
          jsx(Codicon, { name: 'milestone', size: '0.7rem', className: 'shrink-0 text-(--ui-text-tertiary)' }),
          jsx('span', { className: 'min-w-0 flex-1 truncate text-xs font-medium', children: nodeLabel(milestone) }),
          jsx(NodeStateTag, { state: milestone.state })
        ]
      }),
      milestone.phases.length === 0
        ? jsx('div', { className: 'px-2 py-0.5 text-[0.625rem] text-(--ui-text-quaternary)', children: 'No phases' })
        : jsx('div', {
            className: 'flex flex-col gap-1 pl-3',
            children: milestone.phases.map((p) => jsx(PhaseGroup, { phase: p.phase, selectedId, onSelect }, p.phase.node_id))
          })
    ]
  })
}

export function BoardView({ scope, selectedId, onSelect }) {
  const query = useRoadmapBoard(scope.profile, scope.projectId, scope.roadmapId, true)

  if (query.isLoading) {
    return jsx(Skeleton, { className: 'h-24 w-full' })
  }
  if (query.isError) {
    const err = errorCopy(query.error)
    return jsx(ErrorState, {
      title: 'Board unavailable',
      description: `${err.hint}${err.code != null ? ` (code ${err.code})` : ''}`,
      children: jsx(Button, {
        type: 'button',
        size: 'xs',
        variant: 'secondary',
        onClick: () => void query.refetch(),
        children: 'Retry'
      })
    })
  }

  const board = query.data
  if (!board || board.found !== true) {
    return jsx(EmptyState, {
      title: 'No roadmap for this scope',
      description: 'The board is unavailable for the selected roadmap.'
    })
  }
  if (board.version == null) {
    return jsx(EmptyState, {
      title: 'No active version',
      description: 'This roadmap has no active version to display.'
    })
  }

  const milestones = board.milestones ?? []
  const objective = board.objective
  const todoCount = milestones.reduce((n, m) => n + m.phases.reduce((p, ph) => p + ph.todos.length, 0), 0)

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      jsx(SectionTitle, {
        right: jsx('span', { className: 'tabular-nums text-(--ui-text-quaternary)', children: plural(todoCount, 'todo') }),
        children: 'Board'
      }),
      objective
        ? jsxs('div', {
            className: 'flex flex-col gap-0.5 rounded-[3px] border border-(--ui-stroke-tertiary) px-2 py-1.5',
            children: [
              jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx(Codicon, { name: 'target', size: '0.7rem', className: 'shrink-0 text-(--ui-text-tertiary)' }),
                  jsx('span', { className: 'min-w-0 flex-1 truncate text-xs font-medium', children: nodeLabel(objective) }),
                  jsx(NodeStateTag, { state: objective.state })
                ]
              }),
              objective.description
                ? jsx('div', { className: 'truncate text-[0.625rem] text-(--ui-text-tertiary)', children: objective.description })
                : null
            ]
          })
        : null,
      milestones.length === 0
        ? jsx(EmptyState, {
            title: 'No milestones',
            description: 'The active version contains no milestones to display.'
          })
        : jsx('div', {
            className: 'flex flex-col divide-y divide-(--ui-stroke-tertiary)',
            children: milestones.map((m) => jsx(MilestoneGroup, { milestone: m, selectedId, onSelect }, m.milestone.node_id))
          })
    ]
  })
}
