/**
 * Roadmaps plugin — scope bar.
 *
 * Read-only active profile (Tip) + project selector with copy button and the
 * + / ⋮ input flows (inline create + rename, project management menu). The
 * roadmap is the project's single plan (spec §1.2) — derived, never selected.
 * A project change clears the node selection.
 */

import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Button, Codicon, CopyButton, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tip } from '@hermes/plugin-sdk'
import { plural } from './data.js'
import { ProjectCreateForm, ProjectMenu, ProjectRenameForm } from './scope-actions.js'

export function ScopeBar({
  profile,
  projectId,
  setProjectId,
  setSelectedNodeId,
  projects,
  projectNameById,
  compact,
  roadmapsCount,
  projectsError,
  onRetryProjects,
  follow,
  onToggleFollow
}) {
  const [projectCreateOpen, setProjectCreateOpen] = useState(false)
  const [projectRenameOpen, setProjectRenameOpen] = useState(false)

  const selectProject = (v) => {
    setProjectId(v)
    setSelectedNodeId('')
  }

  const currentName = projectNameById.get(projectId) || projectId

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
              // follow toggle — track the app's active project (sidebar).
              jsx(Button, {
                type: 'button',
                variant: 'ghost',
                size: 'icon-xs',
                'aria-label': follow ? 'Stop following active project' : 'Follow active project',
                title: follow ? 'Stop following the active project' : 'Follow the active project',
                onClick: onToggleFollow,
                className: follow ? 'text-primary' : 'text-(--ui-text-tertiary)',
                children: jsx(Codicon, { name: 'arrow-right', size: '0.8rem' })
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
        : null
    ]
  })
}
