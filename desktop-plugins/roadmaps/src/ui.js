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

/** Battery result: StatusDot + label, failures listed (code + hint). */
export function BatteryBadge({ battery, label }) {
  const failures = battery?.failures ?? []
  const ok = battery?.ok === true
  const count = failures.length
  return jsxs('div', {
    className: 'flex flex-col gap-1 px-0.5',
    children: [
      jsxs('span', {
        className: 'inline-flex items-center gap-1.5 text-[0.625rem]',
        children: [
          jsx(StatusDot, { tone: ok ? 'good' : 'bad' }),
          jsx('span', { className: 'text-(--ui-text-secondary)', children: label }),
          jsx('span', {
            className: ok ? 'text-(--ui-text-quaternary)' : 'text-destructive',
            children: ok ? 'ready' : `${count} ${count === 1 ? 'failure' : 'failures'}`
          })
        ]
      }),
      count === 0
        ? null
        : jsxs('div', {
            className: 'flex flex-col gap-0.5 pl-3.5',
            children: failures.map((f) =>
              jsxs('div', { className: 'flex flex-col', children: [
                jsx('span', { className: 'font-mono text-[0.625rem] text-destructive', children: f.code }),
                f.hint ? jsx('span', { className: 'text-[0.625rem] text-(--ui-text-tertiary)', children: f.hint }) : null
              ]}, f.code)
            )
          })
    ]
  })
}
