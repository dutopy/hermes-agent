/**
 * Roadmaps plugin — shared state hooks.
 *
 * Query hooks (list / snapshot), scope selection state, node selection
 * hygiene, and the ResizeObserver compact layout. Intervals and thresholds
 * are config-driven (config.json, embedded at build time).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { host, useQuery } from '@hermes/plugin-sdk'
import config from './config.json'
import { ID, RPC, assertResponseScope, projectSelectorItems, roadmapSelectorItems } from './data.js'

/**
 * Layout mode measured on the REAL container via ResizeObserver
 * (host.state.viewport only seeds the initial value — the app atom tracks
 * the window, not this pane). Thresholds come from config.layout:
 *
 *   width >= layout.wide      -> 'wide'    (3 columns: Thread / view / Inspector)
 *   layout.compact <= width   -> 'mid'     (2 columns: Thread + view or Inspector)
 *   width < layout.compact    -> 'compact' (1 column: tabs + view, collapsible Inspector)
 */
export function useLayoutMode(initialWidth) {
  const containerRef = useRef(null)
  const [containerWidth, setContainerWidth] = useState(initialWidth)
  useEffect(() => {
    const el = containerRef.current
    const RO = globalThis.ResizeObserver
    if (!el || typeof RO !== 'function') return
    const ro = new RO((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const width = containerWidth > 0 ? containerWidth : initialWidth
  const mode = width >= config.layout.wide ? 'wide' : width >= config.layout.compact ? 'mid' : 'compact'
  return { containerRef, mode, compact: mode === 'compact' }
}

/** Roadmaps list — feeds both scope selectors. One query; invalidated by key. */
export function useRoadmapsList(profile, enabled) {
  return useQuery({
    queryKey: [ID, 'list', profile],
    queryFn: async () => {
      const res = await host.request(RPC.list, { profile })
      if (!assertResponseScope(res, { profile })) {
        throw Object.assign(new Error('Response out of scope'), { code: 5063 })
      }
      return res
    },
    enabled,
    refetchInterval: config.query.listRefetchMs
  })
}

/**
 * Projects list — the source of truth for the project selector. The
 * projects.* RPCs are inherently scoped to the active gateway profile
 * (projects_db is opened per profile), so no profile param is sent; the key
 * still carries the profile so a profile switch refetches.
 */
export function useProjectsList(profile, enabled) {
  return useQuery({
    queryKey: [ID, 'projects', profile],
    queryFn: async () => host.request(RPC.projects_list, {}),
    enabled,
    refetchInterval: config.query.projectsRefetchMs
  })
}

/**
 * Snapshot — the ONLY source of truth for the views. Loaded when the scope
 * is complete; reloaded (queryClient invalidation via key bump) after each
 * successful mutation.
 */
export function useRoadmapSnapshot(profile, projectId, roadmapId, enabled) {
  return useQuery({
    queryKey: [ID, 'steer', profile, projectId, roadmapId],
    queryFn: async () => {
      const res = await host.request(RPC.snapshot, { profile, project_id: projectId, roadmap_id: roadmapId })
      if (!assertResponseScope(res, { profile, projectId, roadmapId })) {
        throw Object.assign(new Error('Response out of scope'), { code: 5063 })
      }
      return res
    },
    enabled,
    refetchInterval: config.query.snapshotRefetchMs
  })
}

/**
 * Scope selection state (project / roadmap), with derived option lists.
 * The project dropdown is fed by projects.list (projects param); the
 * roadmap options by roadmaps.list. Selections are kept valid when a list
 * refreshes under them (merge, don't clobber: only clear when the value
 * genuinely disappeared — e.g. the selected project was archived).
 */
export function useScopeState(projects, roadmaps) {
  const [projectId, setProjectId] = useState('')
  const [roadmapId, setRoadmapId] = useState('')

  // Projects are {id, name, slug, …} records; archived ones are filtered
  // out by projectSelectorItems so the selector only offers live scopes.
  // Roadmaps likewise: roadmapSelectorItems drops archived roadmaps (the
  // lifecycle badge in the selector shows draft/proposed/in_progress/
  // validated on the rest) — consistent with the project selector.
  const projectItems = useMemo(() => projectSelectorItems(projects), [projects])
  const projectIds = useMemo(() => projectItems.map((p) => p.id), [projectItems])
  const projectNameById = useMemo(() => {
    const m = new Map()
    for (const p of projectItems) m.set(p.id, p.name || p.id)
    return m
  }, [projectItems])
  const roadmapOptions = useMemo(
    () => (projectId === '' ? [] : roadmapSelectorItems(roadmaps, projectId)),
    [roadmaps, projectId]
  )

  useEffect(() => {
    if (projectId !== '' && !projectIds.includes(projectId)) setProjectId('')
  }, [projectIds, projectId])
  useEffect(() => {
    if (roadmapId !== '' && !roadmapOptions.some((r) => r.roadmap_id === roadmapId)) setRoadmapId('')
  }, [roadmapOptions, roadmapId])

  return { projectId, setProjectId, roadmapId, setRoadmapId, projectNameById, projects: projectItems, roadmapOptions }
}

/**
 * Node selection with hygiene: reset whenever the scope identity changes
 * (covers the gap before the new snapshot) and drop a selected node that no
 * longer exists in the loaded version.
 */
export function useNodeSelection(scopeIdentity, version) {
  const [selectedNodeId, setSelectedNodeId] = useState('')

  useEffect(() => {
    setSelectedNodeId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scope identity only
  }, scopeIdentity)

  useEffect(() => {
    if (selectedNodeId !== '' && version && !version.nodes.some((n) => n.node_id === selectedNodeId)) {
      setSelectedNodeId('')
    }
  }, [version, selectedNodeId])

  const onSelect = useCallback((nodeId) => {
    setSelectedNodeId((cur) => (cur === nodeId ? '' : nodeId))
  }, [])

  return { selectedNodeId, setSelectedNodeId, onSelect }
}

/**
 * Product state derived from the backend snapshot (spec §2). Pure — no scope
 * inference and no local-tab fallback. Returns one of:
 *
 *   NO_PROJECT           — no snapshot loaded yet (no project/roadmap scope).
 *   NO_ROADMAP           — snapshot not found for the selected scope.
 *   DRAFT_NO_PLAN        — no active version, no proposed/validated version.
 *   PROPOSED             — a proposed version exists, none active.
 *   VALIDATED_NON_ACTIVE — a validated version exists, none active.
 *   ACTIVE               — an active version is authoritative.
 *
 * The empty version created with a new roadmap is a durable marker, not a
 * proposable plan: only `proposed` / `validated` versions leave DRAFT_NO_PLAN.
 * A roadmap whose active version is set stays ACTIVE even when a proposed or
 * validated revision exists in parallel (spec §2).
 */
export function deriveProductState(snapshot) {
  if (snapshot == null) return 'NO_PROJECT'
  if (snapshot.found !== true || !snapshot.roadmap) return 'NO_ROADMAP'

  const roadmap = snapshot.roadmap

  if (roadmap.active_version != null) return 'ACTIVE'

  const versions = Array.isArray(roadmap.versions) ? roadmap.versions : []
  if (versions.some((v) => v?.state === 'validated')) return 'VALIDATED_NON_ACTIVE'
  if (versions.some((v) => v?.state === 'proposed')) return 'PROPOSED'
  return 'DRAFT_NO_PLAN'
}
