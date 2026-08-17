/**
 * Roadmaps plugin — Vision lane (collapsible embedded chat).
 *
 * The embedded native Hermes transcript + composer, scoped to the roadmap's
 * durable Vision session (spec §6). SessionSurface owns runtime adoption and
 * resume; this component only hands it the durable identity
 * { profile, storedSessionId, runtimeSessionId? } returned by
 * startVisionSession. `collapsible` adds a compact header with a collapse
 * toggle so the lane can be tucked away (and reused) anywhere in the plugin.
 *
 * SessionSurface ships on the desktop core on a separate branch; a desktop
 * build without it would otherwise fail the ENTIRE plugin load with a named
 * ESM export error. Access it via the SDK namespace and degrade gracefully so
 * the rest of the plugin still loads and renders.
 */

import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import * as SDK from '@hermes/plugin-sdk'
import { Button, Codicon } from '@hermes/plugin-sdk'

const SessionSurface = SDK.SessionSurface

export function VisionLane({ session, collapsible = true }) {
  const [collapsed, setCollapsed] = useState(false)

  if (typeof SessionSurface !== 'function') {
    return jsx('div', { className: 'flex min-h-0 flex-1 flex-col' })
  }
  if (collapsible && collapsed) {
    return jsx(Button, {
      type: 'button',
      variant: 'ghost',
      size: 'xs',
      onClick: () => setCollapsed(false),
      className: 'justify-start gap-1 self-start',
      children: [jsx(Codicon, { name: 'chevron-right', size: '0.7rem' }), 'Vision']
    })
  }
  return jsxs('div', {
    className: 'flex min-h-0 flex-1 flex-col',
    children: [
      collapsible
        ? jsxs('div', {
            className: 'flex items-center justify-between gap-2 border-b border-(--ui-stroke-tertiary) px-0.5 py-0.5',
            children: [
              jsx('span', { className: 'text-[0.625rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)', children: 'Vision' }),
              jsx(Button, {
                type: 'button',
                variant: 'ghost',
                size: 'xs',
                onClick: () => setCollapsed(true),
                title: 'Collapse the Vision chat',
                className: 'gap-1',
                children: jsx(Codicon, { name: 'arrow-down', size: '0.7rem' })
              })
            ]
          })
        : null,
      jsx(SessionSurface, { session })
    ]
  })
}
