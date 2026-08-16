/**
 * Roadmaps plugin — scope bar.
 *
 * Read-only active profile (Tip) + project / roadmap selectors with copy
 * buttons, the + / ⋮ input flows (inline project and roadmap create + rename
 * forms, project and roadmap management menus), a compact summary count,
 * and a compact inline error for the projects list. Selection resets on
 * change happen here: any project change clears the roadmap and the node
 * selection; a roadmap change clears the node selection.
 *
 * Roadmap CRUD (create / rename / archive) is backed by the T5b RPCs
 * roadmaps.create / roadmaps.update / roadmaps.archive via data.js — the
 * selector badges each roadmap's lifecycle_state and hides archived ones.
 */

import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Button, Codicon, CopyButton, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tip, useQueryClient } from '@hermes/plugin-sdk'
import { ID, plural } from './data.js'
import {
  ProjectCreateForm,
  ProjectMenu,
  ProjectRenameForm,
  RoadmapCreateForm,
  RoadmapMenu,
  RoadmapRenameForm
} from './scope-actions.js'

export function ScopeBar({
  profile,
  projectId,
  setProjectId,
  roadmapId,
  setRoadmapId,
  setSelectedNodeId,
  projects,
  projectNameById,
  roadmapOptions,
  compact,
  roadmapsCount,
  projectsError,
  onRetryProjects,
  actor
}) {
  const [projectCreateOpen, setProjectCreateOpen] = useState(false)
  const [projectRenameOpen, setProjectRenameOpen] = useState(false)
  const [roadmapCreateOpen, setRoadmapCreateOpen] = useState(false)
  const [roadmapRenameOpen, setRoadmapRenameOpen] = useState(false)
  const queryClient = useQueryClient()

  const selectProject = (v) => {
    setProjectId(v)
    setRoadmapId('')
    setSelectedNodeId('')
  }

  const selectRoadmap = (v) => {
    setRoadmapId(v)
    setSelectedNodeId('')
  }

  const currentName = projectNameById.get(projectId) || projectId

  // The selected roadmap record drives the ⋮ menu: title for the dialogs and
  // expected_version = the active version observed in the list (0 when none)
  // for the versioned update/archive calls.
  const selectedRoadmap = roadmapOptions.find((r) => r.roadmap_id === roadmapId) ?? null
  const roadmapTitle = selectedRoadmap?.title || roadmapId
  const roadmapActiveVersion = Number(selectedRoadmap?.active_version) || 0

  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2 px-0.5',
        children: [
          // Tip→TooltipTrigger uses Radix Slot (asChild): children MUST be a
          // single React element — jsx(), never jsxs() with an array of one.
          jsx(Tip, {
            label: 'Active profile (read-only)',
            children: jsx('span', {
              className:
                'inline-flex items-center gap-1.5 rounded-[3px] bg-(--ui-bg-quaternary) px-2 py-1 font-mono text-[0.625rem] text-(--ui-text-secondary)',
              children: [jsx(Codicon, { name: 'account', size: '0.7rem' }), profile]
            })
          }),
          jsxs('div', {
            className: 'flex items-center gap-1',
            children: [
              jsxs('span', { className: 'text-[0.625rem] text-(--ui-text-tertiary)', children: ['Project'] }),
              jsx(Select, {
                value: projectId,
                onValueChange: selectProject,
                children: [
                  jsx(SelectTrigger, {
                    className: 'h-7 w-40 text-xs',
                    'aria-label': 'Project',
                    children: jsx(SelectValue, { placeholder: 'select…' })
                  }),
                  jsx(SelectContent, {
                    children:
                      projects.length === 0
                        ? jsx(SelectItem, { value: '__none__', disabled: true, children: 'No projects' })
                        : projects.map((p) => jsx(SelectItem, { value: p.id, children: p.name || p.id }, p.id))
                  })
                ]
              }),
              // "+" — inline create form (projects.create).
              jsx(Button, {
                type: 'button',
                variant: 'ghost',
                size: 'icon-xs',
                'aria-label': 'Create project',
                onClick: () => setProjectCreateOpen((v) => !v),
                children: jsx(Codicon, { name: 'add', size: '0.8rem' })
              }),
              // "⋮" — project management menu (rename / archive / copy id).
              jsx(ProjectMenu, {
                projectId,
                projectName: currentName,
                onRequestRename: () => setProjectRenameOpen(true),
                onArchived: () => {
                  setProjectRenameOpen(false)
                  setProjectCreateOpen(false)
                }
              }),
              projectId !== ''
                ? jsx(CopyButton, {
                    appearance: 'icon',
                    buttonSize: 'icon-xs',
                    buttonVariant: 'ghost',
                    text: projectId,
                    title: 'Copy project ID',
                    label: 'Copy project ID'
                  })
                : null
            ]
          }),
          // projects.list failure — compact inline error with retry.
          projectsError
            ? jsxs('span', {
                className: 'flex items-center gap-1 text-[0.625rem] text-destructive',
                children: [
                  jsx(Codicon, { name: 'error', size: '0.7rem' }),
                  jsx('span', { className: 'max-w-40 truncate', children: projectsError.hint }),
                  jsx(Button, { type: 'button', size: 'xs', variant: 'ghost', onClick: onRetryProjects, children: 'Retry' })
                ]
              })
            : null,
          jsxs('div', {
            className: 'flex items-center gap-1',
            children: [
              jsxs('span', { className: 'text-[0.625rem] text-(--ui-text-tertiary)', children: ['Roadmap'] }),
              jsx(Select, {
                value: roadmapId,
                onValueChange: selectRoadmap,
                disabled: projectId === '',
                children: [
                  jsx(SelectTrigger, {
                    className: 'h-7 w-48 text-xs',
                    'aria-label': 'Roadmap',
                    children: jsx(SelectValue, { placeholder: projectId === '' ? '—' : 'select…' })
                  }),
                  jsx(SelectContent, {
                    children:
                      roadmapOptions.length === 0
                        ? jsx(SelectItem, { value: '__none__', disabled: true, children: 'No roadmaps' })
                        : roadmapOptions.map((r) =>
                            jsx(
                              SelectItem,
                              {
                                value: r.roadmap_id,
                                children: jsx('span', {
                                  className: 'block min-w-0 truncate',
                                  children: r.title || r.roadmap_id
                                })
                              },
                              r.roadmap_id
                            )
                          )
                  })
                ]
              }),
              // "+" — inline roadmap create form (roadmaps.create, T5b).
              jsx(Button, {
                type: 'button',
                variant: 'ghost',
                size: 'icon-xs',
                'aria-label': 'Create roadmap',
                disabled: projectId === '',
                onClick: () => setRoadmapCreateOpen((v) => !v),
                children: jsx(Codicon, { name: 'add', size: '0.8rem' })
              }),
              // "⋮" — roadmap management menu (rename / archive / copy id).
              jsx(RoadmapMenu, {
                profile,
                projectId,
                roadmapId,
                roadmapTitle,
                expectedVersion: roadmapActiveVersion,
                actor,
                onRequestRename: () => setRoadmapRenameOpen(true),
                onArchived: () => {
                  setRoadmapRenameOpen(false)
                  setRoadmapCreateOpen(false)
                }
              }),
              roadmapId !== ''
                ? jsx(CopyButton, {
                    appearance: 'icon',
                    buttonSize: 'icon-xs',
                    buttonVariant: 'ghost',
                    text: roadmapId,
                    title: 'Copy roadmap ID',
                    label: 'Copy roadmap ID'
                  })
                : null
            ]
          }),
          compact
            ? null
            : jsx('span', {
                className: 'ml-auto text-[0.625rem] text-(--ui-text-tertiary)',
                children: `${plural(roadmapsCount, 'roadmap')} · profile ${profile}`
              })
        ]
      }),
      projectCreateOpen
        ? jsx(ProjectCreateForm, { onCreated: selectProject, onCancel: () => setProjectCreateOpen(false) })
        : null,
      projectRenameOpen
        ? jsx(ProjectRenameForm, {
            projectId,
            currentName,
            onRenamed: () => setProjectRenameOpen(false),
            onCancel: () => setProjectRenameOpen(false)
          })
        : null,
      roadmapCreateOpen
        ? jsx(RoadmapCreateForm, {
            profile,
            projectId,
            actor,
            onCreated: (id) => {
              selectRoadmap(id)
              setRoadmapCreateOpen(false)
            },
            onCancel: () => setRoadmapCreateOpen(false)
          })
        : null,
      roadmapRenameOpen
        ? jsx(RoadmapRenameForm, {
            profile,
            projectId,
            roadmapId,
            currentTitle: roadmapTitle,
            expectedVersion: roadmapActiveVersion,
            actor,
            onRenamed: () => {
              setRoadmapRenameOpen(false)
              // The selector already refetched the list; refetch the snapshot
              // so the header title reflects the rename immediately.
              void queryClient.invalidateQueries({ queryKey: [ID, 'steer'] })
            },
            onCancel: () => setRoadmapRenameOpen(false)
          })
        : null
    ]
  })
}
