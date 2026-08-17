/**
 * Roadmaps plugin — scope input actions.
 *
 * The + / ⋮ flows around the project and roadmap selectors: inline create
 * and rename forms, management menus (rename / archive / copy id) for both
 * selectors. Project flows are backed by projects.create/update/archive;
 * roadmap flows by roadmaps.create/update/archive (T5b, live).
 *
 * Every write goes through the data.js RPC drivers (host.request only); the
 * UI renders stable English guidance keyed by error code, never a backend
 * message. Locally-authored validation hints (code null) surface verbatim.
 */

import { useCallback, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import {
  Button,
  Codicon,
  ConfirmDialog,
  CopyButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  host,
  useQueryClient
} from '@hermes/plugin-sdk'
import {
  ID,
  mutationErrorCopy,
  projectArchive,
  projectCreate,
  projectUpdate,
  roadmapArchive,
  roadmapCreate,
  roadmapUpdate,
  rpcError,
  validateRoadmapTitle
} from './data.js'

/**
 * Compact inline error: stable guidance by code only. A `{ code: null }`
 * error is a locally-authored validation hint; a numeric code resolves to
 * ERROR_GUIDANCE copy. The backend message never reaches the DOM.
 */
function FormError({ error }) {
  if (!error) return null
  const ec = mutationErrorCopy(error)
  if (!ec) return null
  return jsxs('div', {
    className: 'flex items-start gap-1.5 rounded-[3px] bg-destructive/10 px-2 py-1 text-xs text-destructive',
    children: [
      jsx(Codicon, { name: 'error', size: '0.75rem', className: 'mt-px shrink-0' }),
      jsxs('span', { children: [ec.hint, ec.code != null ? ` (code ${ec.code})` : ''] })
    ]
  })
}

/** Inline project creation: name input + Create/Cancel. */
export function ProjectCreateForm({ onCreated, onCancel }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const queryClient = useQueryClient()

  const submit = useCallback(async () => {
    if (busy) return
    const trimmed = name.trim()
    if (trimmed === '') return
    setBusy(true)
    setError(null)
    try {
      const res = await projectCreate(trimmed)
      // Wait for the authoritative refresh so the new project is in the
      // selector BEFORE the scope selection points at it (the selection
      // hygiene effect clears a selection that is not in the list yet).
      await queryClient.invalidateQueries({ queryKey: [ID, 'projects'] })
      host.notify({ kind: 'success', title: 'Project created', message: `Created "${trimmed}".` })
      onCreated(res?.project?.id ?? '')
    } catch (err) {
      setError({ code: rpcError(err).code })
    } finally {
      setBusy(false)
    }
  }, [busy, name, onCreated, queryClient])

  return jsxs('div', {
    className: 'flex flex-col gap-1 px-0.5',
    children: [
      jsxs('div', {
        className: 'flex items-center gap-1.5',
        children: [
          jsx(Input, {
            value: name,
            onChange: (ev) => setName(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === 'Enter') void submit()
              if (ev.key === 'Escape') onCancel()
            },
            placeholder: 'Project name…',
            autoFocus: true,
            disabled: busy,
            className: 'h-6 w-48 px-1.5 text-xs',
            'aria-label': 'New project name'
          }),
          jsx(Button, {
            type: 'button',
            size: 'xs',
            variant: 'secondary',
            onClick: () => void submit(),
            disabled: busy || name.trim() === '',
            children: 'Create'
          }),
          jsx(Button, {
            type: 'button',
            size: 'xs',
            variant: 'ghost',
            onClick: onCancel,
            disabled: busy,
            children: 'Cancel'
          })
        ]
      }),
      jsx(FormError, { error })
    ]
  })
}

/** Inline project rename: the ⋮ → Rename flow, pre-filled with the current name. */
export function ProjectRenameForm({ projectId, currentName, onRenamed, onCancel }) {
  const [name, setName] = useState(currentName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const queryClient = useQueryClient()

  const submit = useCallback(async () => {
    if (busy) return
    const trimmed = name.trim()
    if (trimmed === '') return
    setBusy(true)
    setError(null)
    try {
      await projectUpdate(projectId, trimmed)
      await queryClient.invalidateQueries({ queryKey: [ID, 'projects'] })
      host.notify({ kind: 'success', title: 'Project renamed', message: `Renamed to "${trimmed}".` })
      onRenamed()
    } catch (err) {
      setError({ code: rpcError(err).code })
    } finally {
      setBusy(false)
    }
  }, [busy, name, onRenamed, projectId, queryClient])

  return jsxs('div', {
    className: 'flex flex-col gap-1 px-0.5',
    children: [
      jsxs('div', {
        className: 'flex items-center gap-1.5',
        children: [
          jsx(Input, {
            value: name,
            onChange: (ev) => setName(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === 'Enter') void submit()
              if (ev.key === 'Escape') onCancel()
            },
            placeholder: 'Project name…',
            autoFocus: true,
            disabled: busy,
            className: 'h-6 w-48 px-1.5 text-xs',
            'aria-label': 'Rename project'
          }),
          jsx(Button, {
            type: 'button',
            size: 'xs',
            variant: 'secondary',
            onClick: () => void submit(),
            disabled: busy || name.trim() === '',
            children: 'Save'
          }),
          jsx(Button, {
            type: 'button',
            size: 'xs',
            variant: 'ghost',
            onClick: onCancel,
            disabled: busy,
            children: 'Cancel'
          })
        ]
      }),
      jsx(FormError, { error })
    ]
  })
}

/**
 * Project ⋮ menu: Rename (inline form), Copy ID (SDK CopyButton as a menu
 * item), Archive (confirm dialog, soft archive only — never delete).
 * Rename/archive are backed by projects.update / projects.archive (both
 * exist); anything without a native RPC is not offered.
 */
export function ProjectMenu({ projectId, projectName, onRequestRename, onArchived }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()

  const archive = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await projectArchive(projectId)
      await queryClient.invalidateQueries({ queryKey: [ID, 'projects'] })
      setConfirmOpen(false)
      host.notify({ kind: 'success', title: 'Project archived', message: `Archived "${projectName}".` })
      onArchived()
    } catch (err) {
      // Throw the GENERIC hint so ConfirmDialog surfaces stable guidance
      // (its inline error renders the thrown message — never a backend one).
      const ec = mutationErrorCopy({ code: rpcError(err).code })
      throw new Error(ec.hint)
    } finally {
      setBusy(false)
    }
  }, [busy, onArchived, projectId, projectName, queryClient])

  const hasProject = projectId !== ''

  return jsxs('div', {
    className: 'flex items-center gap-1.5',
    children: [
      jsx(DropdownMenu, {
        children: [
          jsx(DropdownMenuTrigger, {
            asChild: true,
            children: jsx(Button, {
              type: 'button',
              variant: 'ghost',
              size: 'icon-xs',
              className: 'data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground',
              'aria-label': 'Project actions',
              disabled: !hasProject,
              children: jsx(Codicon, { name: 'ellipsis', size: '0.8rem' })
            })
          }),
          jsx(DropdownMenuContent, {
            align: 'end',
            sideOffset: 4,
            className: 'w-44',
            children: [
              jsx(DropdownMenuItem, {
                onSelect: onRequestRename,
                disabled: !hasProject,
                children: [jsx(Codicon, { name: 'edit', size: '0.75rem' }), 'Rename']
              }),
              jsx(CopyButton, { appearance: 'menu-item', text: projectId, label: 'Copy ID', disabled: !hasProject }),
              jsx(DropdownMenuSeparator, {}),
              jsx(DropdownMenuItem, {
                variant: 'destructive',
                disabled: !hasProject,
                onSelect: () => setConfirmOpen(true),
                children: [jsx(Codicon, { name: 'archive', size: '0.75rem' }), 'Archive']
              })
            ]
          })
        ]
      }),
      jsx(ConfirmDialog, {
        open: confirmOpen,
        onClose: () => {
          if (!busy) setConfirmOpen(false)
        },
        onConfirm: archive,
        title: 'Archive project',
        description: `Archive "${projectName}"? The project leaves the selector; its roadmaps stay on the backend.`,
        confirmLabel: 'Archive',
        cancelLabel: 'Cancel',
        destructive: true
      })
    ]
  })
}

/**
 * Inline roadmap creation: title input + Create/Cancel (Enter submits,
 * Escape cancels — same pattern as the project create form). On success the
 * list is refetched BEFORE the new roadmap is selected (selection hygiene),
 * mirroring the project flow.
 *
 * Extensible by design: the submit closure is the natural seam for a future
 * "create from Vision" variant (same wrapper, extra source/reason payload) —
 * nothing is pre-wired today, the form stays a title-only inline input.
 */
export function RoadmapCreateForm({ profile, projectId, actor, onCreated, onCancel }) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const queryClient = useQueryClient()

  const submit = useCallback(async () => {
    if (busy) return
    const trimmed = title.trim() || 'untitled'
    if (!validateRoadmapTitle(trimmed)) {
      setError({
        code: null,
        hint: 'Roadmap title must be non-empty, at most 200 characters, and free of control characters.'
      })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await roadmapCreate(profile, projectId, trimmed, actor)
      // Wait for the authoritative refresh so the new roadmap is in the
      // selector BEFORE the scope selection points at it (the selection
      // hygiene effect clears a selection that is not in the list yet).
      await queryClient.invalidateQueries({ queryKey: [ID, 'list', profile] })
      const createdId = res?.roadmap_id ?? res?.scope?.roadmap_id ?? ''
      host.notify({ kind: 'success', title: 'Roadmap created', message: `Created "${trimmed}".` })
      onCreated(createdId)
    } catch (err) {
      // Backend errors keep the code only (guidance by code); local
      // validation failures carry their authored hint along the code:null.
      setError({ code: rpcError(err).code, hint: err?.hint })
    } finally {
      setBusy(false)
    }
  }, [actor, busy, onCreated, profile, projectId, queryClient, title])

  return jsxs('div', {
    className: 'flex flex-col gap-1 px-0.5',
    children: [
      jsxs('div', {
        className: 'flex items-center gap-1.5',
        children: [
          jsx(Input, {
            value: title,
            onChange: (ev) => setTitle(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === 'Enter') void submit()
              if (ev.key === 'Escape') onCancel()
            },
            placeholder: 'Roadmap title (blank = untitled)…',
            autoFocus: true,
            disabled: busy,
            className: 'h-6 w-48 px-1.5 text-xs',
            'aria-label': 'New roadmap title'
          }),
          jsx(Button, {
            type: 'button',
            size: 'xs',
            variant: 'secondary',
            onClick: () => void submit(),
            disabled: busy,
            children: 'Create'
          }),
          jsx(Button, {
            type: 'button',
            size: 'xs',
            variant: 'ghost',
            onClick: onCancel,
            disabled: busy,
            children: 'Cancel'
          })
        ]
      }),
      jsx(FormError, { error })
    ]
  })
}

/**
 * Inline roadmap rename: the ⋮ → Rename flow, pre-filled with the current
 * title. roadmaps.update is versioned — expected_version is the active
 * version observed in the selector list (0 when none); a stale one is
 * rejected by the backend with 5064 (guidance suggests reloading).
 */
export function RoadmapRenameForm({ profile, projectId, roadmapId, currentTitle, expectedVersion, actor, onRenamed, onCancel }) {
  const [title, setTitle] = useState(currentTitle)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const queryClient = useQueryClient()

  const submit = useCallback(async () => {
    if (busy) return
    const trimmed = title.trim()
    if (!validateRoadmapTitle(trimmed)) {
      setError({
        code: null,
        hint: 'Roadmap title must be non-empty, at most 200 characters, and free of control characters.'
      })
      return
    }
    setBusy(true)
    setError(null)
    try {
      await roadmapUpdate(profile, projectId, roadmapId, expectedVersion, trimmed, actor)
      await queryClient.invalidateQueries({ queryKey: [ID, 'list', profile] })
      host.notify({ kind: 'success', title: 'Roadmap renamed', message: `Renamed to "${trimmed}".` })
      onRenamed()
    } catch (err) {
      setError({ code: rpcError(err).code, hint: err?.hint })
    } finally {
      setBusy(false)
    }
  }, [actor, busy, expectedVersion, onRenamed, profile, projectId, queryClient, roadmapId, title])

  return jsxs('div', {
    className: 'flex flex-col gap-1 px-0.5',
    children: [
      jsxs('div', {
        className: 'flex items-center gap-1.5',
        children: [
          jsx(Input, {
            value: title,
            onChange: (ev) => setTitle(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === 'Enter') void submit()
              if (ev.key === 'Escape') onCancel()
            },
            placeholder: 'Roadmap title…',
            autoFocus: true,
            disabled: busy,
            className: 'h-6 w-48 px-1.5 text-xs',
            'aria-label': 'Rename roadmap'
          }),
          jsx(Button, {
            type: 'button',
            size: 'xs',
            variant: 'secondary',
            onClick: () => void submit(),
            disabled: busy || title.trim() === '',
            children: 'Save'
          }),
          jsx(Button, {
            type: 'button',
            size: 'xs',
            variant: 'ghost',
            onClick: onCancel,
            disabled: busy,
            children: 'Cancel'
          })
        ]
      }),
      jsx(FormError, { error })
    ]
  })
}

/**
 * Roadmap ⋮ menu: Rename (inline form), Copy ID (SDK CopyButton as a menu
 * item), Archive (confirm dialog, soft archive — never delete). Backed by
 * roadmaps.update / roadmaps.archive (T5b, live). The trigger is disabled
 * while no roadmap is selected — nothing to manage, honest disabled state.
 */
export function RoadmapMenu({ profile, projectId, roadmapId, roadmapTitle, expectedVersion, actor, onRequestRename, onArchived }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()

  const archive = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await roadmapArchive(profile, projectId, roadmapId, expectedVersion, actor)
      await queryClient.invalidateQueries({ queryKey: [ID, 'list', profile] })
      setConfirmOpen(false)
      host.notify({ kind: 'success', title: 'Roadmap archived', message: `Archived "${roadmapTitle}".` })
      onArchived()
    } catch (err) {
      // Throw the GENERIC hint so ConfirmDialog surfaces stable guidance
      // (its inline error renders the thrown message — never a backend one).
      const ec = mutationErrorCopy({ code: rpcError(err).code })
      throw new Error(ec.hint)
    } finally {
      setBusy(false)
    }
  }, [actor, busy, expectedVersion, onArchived, profile, projectId, queryClient, roadmapId, roadmapTitle])

  const hasRoadmap = roadmapId !== ''

  return jsxs('div', {
    className: 'flex items-center gap-1.5',
    children: [
      jsx(DropdownMenu, {
        children: [
          jsx(DropdownMenuTrigger, {
            asChild: true,
            children: jsx(Button, {
              type: 'button',
              variant: 'ghost',
              size: 'icon-xs',
              className: 'data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground',
              'aria-label': 'Roadmap actions',
              disabled: !hasRoadmap,
              children: jsx(Codicon, { name: 'ellipsis', size: '0.8rem' })
            })
          }),
          jsx(DropdownMenuContent, {
            align: 'end',
            sideOffset: 4,
            className: 'w-44',
            children: [
              jsx(DropdownMenuItem, {
                onSelect: onRequestRename,
                disabled: !hasRoadmap,
                children: [jsx(Codicon, { name: 'edit', size: '0.75rem' }), 'Rename']
              }),
              jsx(CopyButton, { appearance: 'menu-item', text: roadmapId, label: 'Copy ID', disabled: !hasRoadmap }),
              jsx(DropdownMenuSeparator, {}),
              jsx(DropdownMenuItem, {
                variant: 'destructive',
                disabled: !hasRoadmap,
                onSelect: () => setConfirmOpen(true),
                children: [jsx(Codicon, { name: 'archive', size: '0.75rem' }), 'Archive']
              })
            ]
          })
        ]
      }),
      jsx(ConfirmDialog, {
        open: confirmOpen,
        onClose: () => {
          if (!busy) setConfirmOpen(false)
        },
        onConfirm: archive,
        title: 'Archive roadmap',
        description: `Archive "${roadmapTitle}"? The roadmap leaves the selector; its versions stay on the backend.`,
        confirmLabel: 'Archive',
        cancelLabel: 'Cancel',
        destructive: true
      })
    ]
  })
}
