/**
 * Roadmaps plugin — shared local UI pieces.
 *
 * Small presentational components reused across views. Machine-state labels
 * and tone live in config.json (English on purpose: the UI never rewrites
 * the state machine, only labels it).
 */

import { jsx, jsxs } from 'react/jsx-runtime'
import { StatusDot } from '@hermes/plugin-sdk'
import config from './config.json'

/** Semantic tones per node lifecycle state (StatusDot tones only). */
export const NODE_TONE = config.states.tone

/** Machine-state labels (English, config-driven). */
export const NODE_STATE_LABEL = config.states.label

export function ProgressBar({ value }) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  return jsxs('span', {
    className: 'inline-flex items-center gap-1.5',
    children: [
      jsxs('span', {
        className: 'h-1 w-14 overflow-hidden rounded-full bg-(--ui-stroke-secondary)',
        children: [jsx('span', { className: 'h-full rounded-full bg-primary transition-all', style: { width: `${pct}%` } })]
      }),
      jsx('span', { className: 'text-[0.625rem] tabular-nums text-(--ui-text-quaternary)', children: `${pct}%` })
    ]
  })
}

export function SectionTitle({ children, right }) {
  return jsxs('div', {
    className: 'flex items-center justify-between gap-2 px-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
    children: [jsx('span', { className: 'truncate', children }), right ?? null]
  })
}

/** State tag: StatusDot + label, no box — tone carries the semantics. */
export function NodeStateTag({ state }) {
  return jsxs('span', {
    className: 'inline-flex items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)',
    children: [jsx(StatusDot, { tone: NODE_TONE[state] ?? 'muted' }), NODE_STATE_LABEL[state] ?? state]
  })
}
