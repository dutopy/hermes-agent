/**
 * Roadmaps plugin — entry point.
 *
 * Composes the root page from the module slices (scope bar, copilot, six
 * tab views, inspector, shared state hooks) and registers the plugin with
 * the desktop runtime. The plugin stays a pure renderer: business rules and
 * versioning live backend, reached only through host.request (data.js).
 *
 * Layout (T6a): the content area adapts to the REAL container width
 * (ResizeObserver; thresholds in config.layout):
 *   - wide    (>= layout.wide, 1280): 3 columns — Thread | active tab view
 *     | Inspector (fixed ~340px, always visible when a node is selected).
 *   - mid     (layout.compact..wide): 2 columns — Thread | active view OR
 *     Inspector (two-segment switch, selection preserved).
 *   - compact (< layout.compact, 900): 1 column — tabs + active view,
 *     Inspector as a collapsible panel toggled from the tab row, never
 *     squeezed at the bottom.
 * Every column scrolls independently (ScrollArea). The roadmap header, the
 * CopilotBar and the ViewTabs stay above the columns in every mode.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import {
  Badge,
  Button,
  Codicon,
  CopyButton,
  EmptyState,
  ErrorState,
  ROUTES_AREA,
  ScrollArea,
  SIDEBAR_NAV_AREA,
  Skeleton,
  StatusDot,
  cn,
  host,
  useValue
} from '@hermes/plugin-sdk'
import config from './config.json'
import { ID, activeVersion, errorCopy } from './data.js'
import { useLayoutMode, useNodeSelection, useProjectsList, useRoadmapPlanBattery, useRoadmapReadinessBattery, useRoadmapSnapshot, useRoadmapTeamBattery, useRoadmapsList, useScopeState } from './state.js'
import { usePersistedState } from './persist.js'
import { ScopeBar } from './scope.js'
import { CopilotBar } from './copilot.js'
import { ThreadView } from './views/fil.js'
import { MapView } from './views/map.js'
import { BoardView } from './views/board.js'
import { PlanView } from './views/plan.js'
import { TeamView } from './views/team.js'
import { ReadinessView } from './views/readiness.js'
import { VisionLane } from './views/vision.js'
import { Inspector } from './inspector.js'

/** Tabs that participate in node selection + the Inspector panel. */
const INSPECTOR_TABS = new Set(['map'])

/** Underline tabs — active = accent underline, no boxes. */
function ViewTabs({ active, onChange, locked }) {
  return jsxs('div', {
    className: 'flex flex-wrap items-center gap-4 px-0.5',
    children: config.tabs.map((t) => {
      const isLocked = locked?.[t.id] === true
      return jsx(
        'button',
        {
          type: 'button',
          disabled: isLocked,
          onClick: () => onChange(t.id),
          title: isLocked ? `${t.label} — locked` : t.label,
          className: cn(
            'inline-flex items-center gap-1 border-b-2 px-0.5 pb-1.5 pt-0.5 text-xs transition-colors',
            isLocked
              ? 'cursor-not-allowed border-transparent text-(--ui-text-quaternary)'
              : active === t.id
                ? 'border-(--ui-accent) font-medium text-foreground'
                : 'border-transparent text-(--ui-text-tertiary) hover:text-foreground'
          ),
          children: [jsx(Codicon, { name: isLocked ? 'lock' : t.codicon, size: '0.7rem' }), jsx('span', { children: t.label })]
        },
        t.id
      )
    })
  })
}

// ── tab content dispatch ────────────────────────────────────────────────────
// The view only — scroll containers and the Inspector placement live in the
// grid so the same view renders at any breakpoint.

function ActiveView({ tab, snapshot, version, selectedId, onSelect, scope, actor, onMutated }) {
  if (tab === 'plan') {
    return jsx(PlanView, { snapshot, scope, actor, onMutated })
  }
  if (tab === 'map') {
    return jsx(MapView, { version, selectedId, onSelect, scope })
  }
  if (tab === 'team') {
    return jsx(TeamView, { scope, version })
  }
  if (tab === 'readiness') {
    return jsx(ReadinessView, { scope, version })
  }
  return jsx(BoardView, { scope, selectedId, onSelect })
}

// ── grid columns ────────────────────────────────────────────────────────────

/**
 * One scrollable grid column. The optional `header` slot sits above the
 * content; `divider` draws the hairline between parallel columns. Every
 * column scrolls independently, so a long thread never squashes the view
 * nor the Inspector.
 */
function GridColumn({ header, divider, children }) {
  return jsxs('div', {
    className: cn('flex min-h-0 min-w-0 flex-col gap-1.5', divider && 'border-l border-(--ui-stroke-tertiary) pl-2.5'),
    children: [
      header ?? null,
      jsx(ScrollArea, { className: 'min-h-0 flex-1 px-0.5', children })
    ]
  })
}

/** Mid-mode two-segment switch: active view ↔ Inspector, selection kept. */
function MidPaneSwitch({ activeTab, pane, onPane }) {
  const tabMeta = config.tabs.find((t) => t.id === activeTab)
  const seg = (key, codicon, label) =>
    jsx(
      'button',
      {
        type: 'button',
        onClick: () => onPane(key),
        title: label,
        className: cn(
          'inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 text-[0.625rem] transition-colors',
          pane === key ? 'bg-(--ui-bg-elevated) font-medium text-foreground' : 'text-(--ui-text-tertiary) hover:text-foreground'
        ),
        children: [jsx(Codicon, { name: codicon, size: '0.65rem' }), jsx('span', { children: label })]
      },
      key
    )
  return jsxs('div', {
    className: 'inline-flex items-center gap-0.5 self-start rounded-[3px] bg-(--ui-bg-quaternary) p-0.5',
    children: [
      seg('view', tabMeta?.codicon ?? 'milestone', tabMeta?.label ?? activeTab),
      seg('inspector', 'info', 'Inspector')
    ]
  })
}

/**
 * The content grid. Three modes (config.layout thresholds, container width):
 *   wide    — Thread | active view | Inspector (Inspector always visible;
 *             the thread column is the "what to do now" surface).
 *   mid     — Thread | active view or Inspector via a two-segment switch.
 *   compact — single column: active view, Inspector as a collapsible panel
 *             toggled from the tab row ("Details"), never squeezed.
 */
function RoadmapsGrid({
  mode,
  activeTab,
  canInspect,
  snapshot,
  version,
  selectedNodeId,
  onSelect,
  scope,
  onMutated,
  compact,
  actor,
  setActor,
  inspectorOpen
}) {
  const [midPane, setMidPane] = useState('inspector')
  const pane = canInspect ? midPane : 'view'

  const thread = jsx(ThreadView, { version, selectedId: selectedNodeId, onSelect, dense: true })
  const view = jsx(ActiveView, { tab: activeTab, snapshot, version, selectedId: selectedNodeId, onSelect, compact, dense: true, scope, actor, onMutated })
  const inspector = jsx(Inspector, { snapshot, version, nodeId: selectedNodeId, scope, onMutated, compact, actor, setActor, onSelect })

  if (mode === 'wide') {
    return jsxs('div', {
      className: 'grid min-h-0 flex-1 gap-2.5',
      style: { gridTemplateColumns: `minmax(0, 1.1fr) minmax(0, 1fr) ${config.layout.inspectorWidth}px` },
      children: [
        jsx(GridColumn, { children: thread }),
        jsx(GridColumn, { divider: true, children: view }),
        jsx(GridColumn, { divider: true, children: inspector })
      ]
    })
  }

  if (mode === 'mid') {
    return jsxs('div', {
      className: 'grid min-h-0 flex-1 grid-cols-2 gap-2.5',
      children: [
        jsx(GridColumn, { children: thread }),
        jsx(GridColumn, {
          divider: true,
          header: canInspect ? jsx(MidPaneSwitch, { activeTab, pane, onPane: setMidPane }) : null,
          children: pane === 'inspector' ? inspector : view
        })
      ]
    })
  }

  // compact — single column; the Inspector panel is toggled from the tab row.
  return jsxs('div', {
    className: 'flex min-h-0 flex-1 flex-col gap-2',
    children: [
      jsx(ScrollArea, { className: 'min-h-0 flex-1 px-0.5', children: view }),
      compact && canInspect && inspectorOpen
        ? jsxs('div', {
            className: 'flex min-h-0 flex-1 flex-col border-t border-(--ui-stroke-tertiary) pt-1.5',
            children: [jsx(ScrollArea, { className: 'min-h-0 flex-1 px-0.5', children: inspector })]
          })
        : null
    ]
  })
}

// ── page ────────────────────────────────────────────────────────────────────

function RoadmapsPage() {
  const profile = useValue(host.state.profile)
  const viewport = useValue(host.state.viewport)

  const [actor, setActor] = useState('user')
  const [inspectorOpen, setInspectorOpen] = useState(false)

  const { containerRef, mode, compact } = useLayoutMode(viewport?.width ?? 0)

  // Identity guard: profile is displayed read-only; a missing profile is an
  // explicit "not initialized" state — NEVER a silent fallback to 'default'.
  const profileReady = typeof profile === 'string' && profile.trim() !== ''

  // Roadmaps list — feeds the roadmap scope selector. One query; invalidated by key.
  const listQuery = useRoadmapsList(profile, profileReady)

  // Projects list — source of truth for the project selector (projects.list,
  // inherently scoped to the active profile). Archived projects are filtered
  // out in useScopeState, so archiving a selected project clears the scope.
  const projectsQuery = useProjectsList(profile, profileReady)

  const roadmaps = listQuery.data?.roadmaps ?? []
  const projectsData = projectsQuery.data?.projects ?? []
  const { projectId, setProjectId, roadmapId, projectNameById, projects, roadmapOptions } = useScopeState(profile, projectsData, roadmaps)
  const [activeTab, setActiveTab] = usePersistedState(`roadmaps:${profile}:${projectId}:tab`, 'plan')
  const [follow, setFollow] = usePersistedState(`roadmaps:${profile}:follow`, false)
  const [activeProjectId, setActiveProjectId] = useState(null)

  // Follow: while enabled, the selected project tracks the app's active
  // project (sidebar). Manual selection still wins until the next change.
  // Tolerates a renderer that does not yet expose activeProjectId.
  useEffect(() => {
    const atom = host.state.activeProjectId
    if (!atom) return undefined
    return atom.listen(setActiveProjectId)
  }, [])

  useEffect(() => {
    if (follow && activeProjectId && activeProjectId !== projectId) {
      setProjectId(activeProjectId)
    }
  }, [follow, activeProjectId, projectId, setProjectId])

  const scopeReady = profileReady && projectId !== '' && roadmapId !== ''

  // Snapshot — the ONLY source of truth for the views.
  const snapshotQuery = useRoadmapSnapshot(profile, projectId, roadmapId, scopeReady)

  const snapshot = snapshotQuery.data
  const found = snapshot?.found === true
  const version = useMemo(() => activeVersion(snapshot), [snapshot])

  // Selection hygiene: reset on scope identity change, drop vanished nodes.
  const { selectedNodeId, setSelectedNodeId, onSelect } = useNodeSelection([profile, projectId, roadmapId], version)

  const reloadSnapshot = useCallback(() => {
    void snapshotQuery.refetch()
  }, [snapshotQuery])

  const scope = scopeReady ? { profile, projectId, roadmapId } : null

  // Pipeline gating (spec §3): each step unlocks the next once its battery is
  // green. Plan is always open; Team needs Batterie Plan, Readiness needs
  // Batterie Team, Map needs Batterie Readiness.
  const versionReady = version != null
  const planBatteryQuery = useRoadmapPlanBattery(profile, projectId, roadmapId, version, scopeReady && versionReady)
  const teamBatteryQuery = useRoadmapTeamBattery(profile, projectId, roadmapId, version, scopeReady && versionReady)
  const readinessBatteryQuery = useRoadmapReadinessBattery(profile, projectId, roadmapId, version, scopeReady && versionReady)
  const planOk = planBatteryQuery.data?.ok === true
  const teamOk = teamBatteryQuery.data?.ok === true
  const readinessOk = readinessBatteryQuery.data?.ok === true
  const lockedTabs = { plan: false, team: !planOk, readiness: !teamOk, map: !readinessOk }

  // If the active tab becomes locked (a gate regressed), fall back to Plan.
  useEffect(() => {
    if (activeTab === 'team' && !planOk) setActiveTab('plan')
    else if (activeTab === 'readiness' && !teamOk) setActiveTab('plan')
    else if (activeTab === 'map' && !readinessOk) setActiveTab('plan')
  }, [activeTab, planOk, teamOk, readinessOk])

  // Selection only swaps panes on the selection-aware tabs; on the others
  // (Plan / Decisions / Files) mid and compact keep showing the active view.
  const canInspect = selectedNodeId !== '' && INSPECTOR_TABS.has(activeTab)

  // ── guided empty states ──
  if (!profileReady) {
    return jsx(EmptyState, {
      title: 'Profile not initialized',
      description: 'No active profile identity is available. Roadmaps refuses to guess a profile (no silent fallback to "default").'
    })
  }

  const listError = listQuery.isError ? errorCopy(listQuery.error) : null
  const snapshotError = snapshotQuery.isError ? errorCopy(snapshotQuery.error) : null
  const panel = (content) => jsx(ScrollArea, { className: 'min-h-0 flex-1 px-0.5', children: content })
  const needsVersion = activeTab === 'map'

  // Shared snapshot states (loading / error / not-found / no active version)
  // gate every tab uniformly; Plan still lists versions even without an
  // active one, Decisions and Files are honest static empty states.
  let content
  if (!scopeReady) {
    content = panel(
      jsx(EmptyState, {
        title: 'Select a project…',
        description: 'The Plan, Team, Readiness, and Map views appear once a project is chosen.'
      })
    )
  } else if (snapshotQuery.isLoading) {
    content = panel(jsx(Skeleton, { className: 'h-24 w-full' }))
  } else if (snapshotQuery.isError) {
    content = panel(
      jsx(ErrorState, {
        title: 'Snapshot unavailable',
        description: `${snapshotError.hint}${snapshotError.code != null ? ` (code ${snapshotError.code})` : ''}`,
        children: jsx(Button, {
          type: 'button',
          size: 'xs',
          variant: 'secondary',
          onClick: () => void snapshotQuery.refetch(),
          children: snapshotError.code === 5064 ? 'Reload' : 'Retry'
        })
      })
    )
  } else if (!found) {
    content = panel(
      jsx(EmptyState, {
        title: 'No roadmap for this scope',
        description: `No roadmap found for ${projectId} / ${roadmapId} in profile ${profile}.`
      })
    )
  } else if (needsVersion && !version) {
    content = panel(
      jsx(EmptyState, {
        title: 'No active version',
        description: 'This roadmap has no active version to display.'
      })
    )
  } else {
    content = jsx(RoadmapsGrid, {
      mode,
      activeTab,
      canInspect,
      snapshot,
      version,
      selectedNodeId,
      onSelect,
      scope,
      onMutated: reloadSnapshot,
      compact,
      actor,
      setActor,
      inspectorOpen
    })
  }

  return jsxs('div', {
    ref: containerRef,
    className: 'flex h-full min-h-0 flex-col gap-2 p-3',
    children: [
      // Scope bar: profile (read-only) → project → roadmap (+ / ⋮ input flows).
      // `actor` is the shared identity for versioned writes (roadmap CRUD and
      // the Inspector's node mutations), defaulting to 'user'.
      jsx(ScopeBar, {
        profile,
        projectId,
        setProjectId,
        setSelectedNodeId,
        projects,
        projectNameById,
        compact,
        roadmapsCount: roadmaps.length,
        projectsError: projectsQuery.isError ? errorCopy(projectsQuery.error) : null,
        onRetryProjects: () => void projectsQuery.refetch(),
        follow,
        onToggleFollow: () => setFollow((v) => !v)
      }),

      // List states: explicit error (with retry) before any empty state.
      listError
        ? jsx(ErrorState, {
            title: 'Roadmap list unavailable',
            description: `${listError.hint}${listError.code != null ? ` (code ${listError.code})` : ''}`,
            children: jsx(Button, {
              type: 'button',
              size: 'xs',
              variant: 'secondary',
              onClick: () => void listQuery.refetch(),
              children: 'Retry'
            })
          })
        : projectId !== '' && roadmapOptions.length === 0 && !listQuery.isLoading
          ? jsx(EmptyState, {
              title: 'No roadmaps for this scope',
              description: `Project "${projectNameById.get(projectId) || projectId}" has no roadmaps in profile ${profile}. Create one on the backend (projects.db remains the source of truth).`
            })
          : null,

      // Roadmap header (title + lifecycle + version) once a roadmap is chosen.
      found && snapshot?.roadmap
        ? jsxs('div', {
            className: 'flex flex-wrap items-center gap-2 border-b border-(--ui-stroke-tertiary) px-0.5 pb-2',
            children: [
              jsxs('div', {
                className: 'min-w-0 flex-1',
                children: [
                  jsx('div', { className: 'truncate text-[0.8125rem] font-medium', children: snapshot.roadmap.title || roadmapId }),
                  !compact && snapshot.roadmap.purpose
                    ? jsx('div', { className: 'truncate text-[0.625rem] text-(--ui-text-tertiary)', children: snapshot.roadmap.purpose })
                    : null
                ]
              }),
              jsxs(Badge, { size: 'xs', variant: 'outline', children: [jsx(StatusDot, { tone: 'good' }), snapshot.roadmap.lifecycle_state] }),
              jsxs('span', { className: 'font-mono text-[0.625rem] text-(--ui-text-tertiary)', children: ['v', String(snapshot.roadmap.active_version)] }),
              jsx(CopyButton, {
                appearance: 'icon',
                buttonSize: 'icon-xs',
                buttonVariant: 'ghost',
                text: `${profile} / ${projectId} / ${roadmapId}`,
                title: 'Copy scope (profile / project / roadmap)',
                label: 'Copy scope'
              })
            ]
          })
        : null,

      // Orchestration copilot — data-driven, only once the snapshot is loaded.
      // Stays above the columns at every breakpoint; denser in compact.
      found && snapshot?.roadmap ? jsx(CopilotBar, { version, selectedId: selectedNodeId, onSelect, dense: compact }) : null,

      // Module navigation — visible as soon as a scope is chosen. In compact
      // the tab row also hosts the "Details" toggle for the Inspector panel.
      scopeReady
        ? jsxs('div', {
            className: 'flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-(--ui-stroke-tertiary)',
            children: [
              jsx(ViewTabs, { active: activeTab, onChange: setActiveTab, locked: lockedTabs }),
              compact && canInspect
                ? jsx(Button, {
                    type: 'button',
                    variant: inspectorOpen ? 'secondary' : 'ghost',
                    size: 'xs',
                    onClick: () => setInspectorOpen((v) => !v),
                    className: 'gap-1',
                    children: [jsx(Codicon, { name: 'info', size: '0.7rem' }), 'Details']
                  })
                : null
            ]
          })
        : null,

      content
    ]
  })
}

// ── plugin registration ─────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'Roadmaps',
  description:
    'Project roadmaps — orchestration thread, canonical relation map, versioned plan history, milestones, and a data-driven copilot with versioned manual steering.',
  defaultEnabled: true,
  register(ctx) {
    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/roadmaps' },
        render: () => jsx(RoadmapsPage, {})
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 51,
        data: { codicon: 'milestone', label: 'Roadmaps', path: '/roadmaps' }
      }
    ])
  }
}
