/**
 * Roadmaps plugin — Team view.
 *
 * The version's lane workers (model, thinking, toolsets, skills) and their
 * todo assignments, plus the Batterie Team result. Dense, native — no boxes.
 */

import { jsx, jsxs } from 'react/jsx-runtime'
import { Button, Codicon, EmptyState, ErrorState, Skeleton } from '@hermes/plugin-sdk'
import { BatteryBadge, SectionTitle } from '../ui.js'
import { errorCopy, plural } from '../data.js'
import { useRoadmapTeam } from '../state.js'

function WorkerRow({ worker, todos }) {
  const modelLabel = worker.model ? [worker.provider, worker.model].filter(Boolean).join('/') : worker.provider
  const meta = [modelLabel, worker.thinking_level ? `thinking ${worker.thinking_level}` : null].filter(Boolean)
  const capabilities = [
    worker.toolsets?.length ? `tools: ${worker.toolsets.join(', ')}` : null,
    worker.skills?.length ? `skills: ${worker.skills.join(', ')}` : null
  ].filter(Boolean)
  return jsxs('div', {
    className: 'flex flex-col gap-0.5 border-b border-(--ui-stroke-tertiary) py-1.5',
    children: [
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-x-2 gap-y-0.5',
        children: [
          jsx(Codicon, { name: 'person', size: '0.7rem', className: 'shrink-0 text-(--ui-text-tertiary)' }),
          jsx('span', { className: 'text-xs font-medium', children: worker.lane || worker.worker_id }),
          meta.length ? jsx('span', { className: 'font-mono text-[0.625rem] text-(--ui-text-tertiary)', children: meta.join(' · ') }) : null,
          jsx('span', { className: 'ml-auto text-[0.625rem] text-(--ui-text-quaternary)', children: plural(todos.length, 'todo') })
        ]
      }),
      capabilities.length
        ? jsx('div', { className: 'flex flex-wrap gap-x-2 text-[0.625rem] text-(--ui-text-quaternary)', children: capabilities.map((c) => jsx('span', { children: c }, c)) })
        : null
    ]
  })
}

export function TeamView({ scope, version }) {
  const query = useRoadmapTeam(scope.profile, scope.projectId, scope.roadmapId, version, version != null)

  if (version == null) {
    return jsx(EmptyState, { title: 'No active version', description: 'This roadmap has no active version to team up.' })
  }
  if (query.isLoading) {
    return jsx(Skeleton, { className: 'h-24 w-full' })
  }
  if (query.isError) {
    const err = errorCopy(query.error)
    return jsx(ErrorState, {
      title: 'Team unavailable',
      description: `${err.hint}${err.code != null ? ` (code ${err.code})` : ''}`,
      children: jsx(Button, { type: 'button', size: 'xs', variant: 'secondary', onClick: () => void query.refetch(), children: 'Retry' })
    })
  }

  const data = query.data ?? { workers: [], assignments: [], battery: { ok: false, failures: [] } }
  const workers = data.workers
  const byWorker = new Map()
  for (const w of workers) byWorker.set(w.worker_id, [])
  for (const a of data.assignments) {
    if (byWorker.has(a.worker_id)) byWorker.get(a.worker_id).push(a.todo_id)
  }

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      jsx(SectionTitle, { right: plural(workers.length, 'worker'), children: 'Team' }),
      jsx(BatteryBadge, { battery: data.battery, label: 'Team battery' }),
      workers.length === 0
        ? jsx(EmptyState, { title: 'No team', description: 'No lane workers are assigned for this version yet.' })
        : jsx('div', { className: 'flex flex-col', children: workers.map((w) => jsx(WorkerRow, { worker: w, todos: byWorker.get(w.worker_id) ?? [] }, w.worker_id)) })
    ]
  })
}
