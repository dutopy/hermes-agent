/**
 * Roadmaps plugin — Vision lane.
 *
 * The embedded native Hermes transcript + composer, scoped to the roadmap's
 * durable Vision session (spec §6). SessionSurface owns runtime adoption and
 * resume; this component only hands it the durable identity
 * { profile, storedSessionId, runtimeSessionId? } returned by
 * startVisionSession. The wrapper is a flex column so the native surface
 * fills the lane's height and scrolls internally.
 */

import { jsx } from 'react/jsx-runtime'
import { SessionSurface } from '@hermes/plugin-sdk'

export function VisionLane({ session }) {
  return jsx('div', {
    className: 'flex min-h-0 flex-1 flex-col',
    children: jsx(SessionSurface, { session })
  })
}
