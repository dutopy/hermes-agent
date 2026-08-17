/**
 * Roadmaps plugin — Readiness view.
 *
 * The version's blockers + authorizations (kind, status, resolution) plus the
 * Batterie Readiness result. Dense, native — no boxes.
 */

import { jsx, jsxs } from 'react/jsx-runtime'
import { Button, Codicon, EmptyState, ErrorState, Skeleton, StatusDot } from '@hermes/plugin-sdk'
import { BatteryBadge, SectionTitle } from '../ui.js'
import { errorCopy, plural } from '../data.js'
import { useRoadmapReadiness } from '../state.js'

const ITEM_TONE = { resolved: 'good', verified: 'good', open: 'warn', missing: 'bad', unresolved: 'bad' }

function ItemRow({ item }) {
  const icon = item.kind === 'blocker' ? 'error' : 'check'
  const tone = ITEM_TONE[item.status] ?? 'muted'
  return jsxs('div', {
    className: 'flex flex-col gap-0.5 border-b border-(--ui-stroke-tertiary) py-1.5',
    children: [
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-x-2 gap-y-0.5',
        children: [
          jsx(Codicon, { name: icon, size: '0.7rem', className: 'shrink-0 text-(--ui-text-tertiary)' }),
          jsx('span', { className: 'min-w-0 flex-1 truncate text-xs', children: item.title || item.item_id }),
          jsx('span', { className: 'text-[0.625rem] text-(--ui-text-quaternary)', children: item.kind }),
          jsxs('span', {
            className: 'inline-flex items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)',
            children: [jsx(StatusDot, { tone }), item.status ?? '—']
          })
        ]
      }),
      item.detail ? jsx('div', { className: 'truncate text-[0.625rem] text-(--ui-text-quaternary)', children: item.detail }) : null
    ]
  })
}

export function ReadinessView({ scope, version }) {
  const query = useRoadmapReadiness(scope.profile, scope.projectId, scope.roadmapId, version, version != null)

  if (version == null) {
    return jsx(EmptyState, { title: 'No active version', description: 'This roadmap has no active version to check readiness for.' })
  }
  if (query.isLoading) {
    return jsx(Skeleton, { className: 'h-24 w-full' })
  }
  if (query.isError) {
    const err = errorCopy(query.error)
    return jsx(ErrorState, {
      title: 'Readiness unavailable',
      description: `${err.hint}${err.code != null ? ` (code ${err.code})` : ''}`,
      children: jsx(Button, { type: 'button', size: 'xs', variant: 'secondary', onClick: () => void query.refetch(), children: 'Retry' })
    })
  }

  const data = query.data ?? { items: [], battery: { ok: false, failures: [] } }
  const items = data.items

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      jsx(SectionTitle, { right: plural(items.length, 'item'), children: 'Readiness' }),
      jsx(BatteryBadge, { battery: data.battery, label: 'Readiness battery' }),
      items.length === 0
        ? jsx(EmptyState, { title: 'No readiness items', description: 'No blockers or authorizations are recorded for this version yet.' })
        : jsx('div', { className: 'flex flex-col', children: items.map((it) => jsx(ItemRow, { item: it }, it.item_id)) })
    ]
  })
}
