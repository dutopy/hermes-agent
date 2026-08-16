/**
 * Roadmaps plugin — Files view.
 *
 * Honest empty state (no fixtures): files linked to nodes and versions will
 * be listed here once evidence lands backend.
 */

import { jsx } from 'react/jsx-runtime'
import { EmptyState } from '@hermes/plugin-sdk'

export function FilesView() {
  return jsx(EmptyState, {
    title: 'No attached files',
    description: 'Evidence is coming (Phase 5) — files linked to nodes and versions will be listed here.'
  })
}
