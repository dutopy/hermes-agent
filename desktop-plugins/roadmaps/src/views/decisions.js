/**
 * Roadmaps plugin — Decisions view.
 *
 * Honest empty state (no fixtures): plan governance (proposing, validating,
 * revising a version) will record each decision here once it lands backend.
 */

import { jsx } from 'react/jsx-runtime'
import { EmptyState } from '@hermes/plugin-sdk'

export function DecisionsView() {
  return jsx(EmptyState, {
    title: 'No decisions recorded',
    description: 'Plan governance is coming (Phase 6) — proposing, validating, and revising a version will record each decision here.'
  })
}
