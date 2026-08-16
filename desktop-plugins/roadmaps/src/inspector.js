/**
 * Roadmaps plugin — Inspector panel.
 *
 * Details of the selected node (description, todos, parent) plus versioned
 * manual steering: claim / progress / complete / block / unblock and todo
 * start / finish / cancel / reopen. Every write is a versioned mutation
 * (expected_version = the active version of the loaded snapshot); the
 * caller reloads an authoritative snapshot after each success. Backend
 * messages are never rendered — stable English guidance by code only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Button, Codicon, CopyButton, EmptyState, Input, Separator, StatusDot, cn, host } from '@hermes/plugin-sdk'
import { NodeStateTag, SectionTitle } from './ui.js'
import {
  RPC,
  formatDate,
  isValidIdentifier,
  mutationErrorCopy,
  nodeBlockers,
  nodeBlocks,
  nodeDependants,
  nodeDepsInfo,
  nodeLabel,
  plural,
  rpcError,
  validateProgress
} from './data.js'

function MutationButton({ label, codicon, onClick, busy, disabled, tone }) {
  return jsxs(Button, {
    type: 'button',
    variant: tone === 'danger' ? 'destructive' : 'secondary',
    size: 'xs',
    onClick,
    disabled: disabled || busy,
    className: 'gap-1',
    children: [jsx(Codicon, { name: codicon, size: '0.75rem' }), label]
  })
}

export function TodoRow({ todo, onMutate, busyTodoId }) {
  const done = todo.state === 'done' || todo.state === 'cancelled'
  return jsxs('div', {
    className: 'flex items-center gap-2 px-0.5 py-0.5 text-xs',
    children: [
      jsx(StatusDot, { tone: done ? 'muted' : 'good' }),
      jsx('span', {
        className: cn('min-w-0 flex-1 truncate', done && 'line-through opacity-60'),
        children: todo.title
      }),
      jsxs('div', {
        className: 'flex shrink-0 items-center gap-1',
        children: [
          todo.state === 'open'
            ? jsx(MutationButton, {
                label: 'Start',
                codicon: 'play',
                onClick: () => onMutate(todo.todo_id, 'in_progress'),
                busy: busyTodoId === todo.todo_id
              })
            : null,
          todo.state === 'in_progress'
            ? jsx(MutationButton, {
                label: 'Finish',
                codicon: 'pass-filled',
                onClick: () => onMutate(todo.todo_id, 'done'),
                busy: busyTodoId === todo.todo_id
              })
            : null,
          !done
            ? jsx(MutationButton, {
                label: 'Cancel',
                codicon: 'close',
                onClick: () => onMutate(todo.todo_id, 'cancelled'),
                busy: busyTodoId === todo.todo_id,
                tone: 'danger'
              })
            : null,
          todo.state === 'cancelled'
            ? jsx(MutationButton, {
                label: 'Reopen',
                codicon: 'debug-restart',
                onClick: () => onMutate(todo.todo_id, 'open'),
                busy: busyTodoId === todo.todo_id
              })
            : null
        ]
      })
    ]
  })
}

/** Relation chips: "Blockers / Dependants / Blocks" compact labeled rows. */
function RelationChips({ title, codicon, items, onSelect, destructive }) {
  if (items.length === 0) return null
  return jsxs('div', {
    className: 'flex items-start gap-2 text-[0.625rem]',
    children: [
      jsxs('span', {
        className: 'mt-px inline-flex w-16 shrink-0 items-center gap-1 font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
        children: [jsx(Codicon, { name: codicon, size: '0.65rem' }), title]
      }),
      jsxs('div', {
        className: 'flex min-w-0 flex-wrap gap-1',
        children: items.map((it) =>
          jsx(
            'button',
            {
              type: 'button',
              onClick: () => onSelect(it.id),
              title: it.hint,
              className: cn(
                'min-w-0 max-w-48 truncate rounded-[3px] px-1 py-px transition-colors',
                destructive
                  ? 'text-destructive hover:bg-(--chrome-action-hover)'
                  : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground'
              ),
              children: it.label
            },
            it.id
          )
        )
      })
    ]
  })
}

export function Inspector({ snapshot, version, nodeId, scope, onMutated, compact, actor, setActor, onSelect }) {
  const [progressInput, setProgressInput] = useState('')
  const [reason, setReason] = useState('')
  const [busyOp, setBusyOp] = useState(null)
  const [busyTodoId, setBusyTodoId] = useState(null)
  const [error, setError] = useState(null)

  const node = (version?.nodes ?? []).find((n) => n.node_id === nodeId) ?? null
  const todos = (version?.todos ?? []).filter((t) => t.node_id === nodeId)
  const expectedVersion = snapshot?.roadmap?.active_version

  const deps = useMemo(() => (node ? nodeDepsInfo(node, version) : null), [node, version])
  const dependants = useMemo(() => (node ? nodeDependants(node, version) : []), [node, version])
  const blockers = useMemo(() => (node ? nodeBlockers(node, version) : []), [node, version])
  const blocks = useMemo(() => (node ? nodeBlocks(node, version) : []), [node, version])

  // Reset transient form/error state when the inspected node changes.
  useEffect(() => {
    setProgressInput('')
    setReason('')
    setError(null)
  }, [nodeId])

  // Local validation before any write: the actor must be a valid identifier
  // (the backend validates too — the plugin must not depend on it alone).
  const guardActor = useCallback(() => {
    const sent = actor.trim() || 'user'
    if (isValidIdentifier(sent)) return true
    setError({ code: null, hint: 'Actor must be a valid identifier: non-empty, at most 128 characters, no control characters.' })
    return false
  }, [actor])

  const mutate = useCallback(
    async (op, extra) => {
      if (!node || !scope || !guardActor()) return
      if (op === 'update_progress') {
        const p = Number(extra?.progress)
        if (!validateProgress(p)) {
          setError({ code: null, hint: 'Progress must be an integer between 0 and 100.' })
          return
        }
      }
      setBusyOp(op)
      setError(null)
      try {
        await host.request(RPC[op], {
          profile: scope.profile,
          project_id: scope.projectId,
          roadmap_id: scope.roadmapId,
          node_id: node.node_id,
          actor: actor.trim() || 'user',
          expected_version: expectedVersion,
          ...(extra ?? {})
        })
        onMutated()
      } catch (err) {
        // Only the structured code is kept — the backend message is never rendered.
        setError({ code: rpcError(err).code })
      } finally {
        setBusyOp(null)
      }
    },
    [actor, expectedVersion, guardActor, node, onMutated, scope]
  )

  const mutateTodo = useCallback(
    async (todoId, state) => {
      if (!scope || !guardActor()) return
      setBusyTodoId(todoId)
      setError(null)
      try {
        await host.request(RPC.update_todo, {
          profile: scope.profile,
          project_id: scope.projectId,
          roadmap_id: scope.roadmapId,
          todo_id: todoId,
          actor: actor.trim() || 'user',
          state,
          expected_version: expectedVersion
        })
        onMutated()
      } catch (err) {
        setError({ code: rpcError(err).code })
      } finally {
        setBusyTodoId(null)
      }
    },
    [actor, expectedVersion, guardActor, onMutated, scope]
  )

  if (!node) {
    return jsx(EmptyState, {
      title: 'No node selected',
      description: 'Pick a node in the Thread, Map, or Milestones view.'
    })
  }

  const ec = mutationErrorCopy(error)

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      jsx(SectionTitle, { children: 'Inspector' }),

      jsxs('div', {
        className: 'flex items-start justify-between gap-2 px-0.5',
        children: [
          jsxs('div', {
            className: 'min-w-0',
            children: [
              jsxs('div', {
                className: 'flex items-center gap-1 text-[0.625rem] uppercase tracking-wide text-(--ui-text-tertiary)',
                children: [
                  jsx('span', { className: 'truncate', children: [`${node.kind} · ${node.node_id}`] }),
                  jsx(CopyButton, {
                    appearance: 'icon',
                    buttonSize: 'icon-xs',
                    buttonVariant: 'ghost',
                    text: node.node_id,
                    title: 'Copy node ID',
                    label: 'Copy node ID'
                  })
                ]
              }),
              jsx('div', { className: 'truncate text-[0.8125rem] font-medium', children: nodeLabel(node) })
            ]
          }),
          jsx(NodeStateTag, { state: node.state })
        ]
      }),

      node.description
        ? jsx('p', {
            className: 'whitespace-pre-wrap break-words px-0.5 text-xs leading-relaxed text-(--ui-text-tertiary)',
            children: node.description
          })
        : null,

      jsxs('div', {
        className: 'flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-[0.625rem] text-(--ui-text-tertiary)',
        children: [
          jsxs('span', { children: ['Progress: ', node.progress ?? 0, ' %'] }),
          node.owner_agent
            ? jsxs('span', { children: ['Owner: ', node.owner_agent] })
            : jsx('span', { children: 'Owner: —' }),
          node.parent_node_id ? jsxs('span', { children: ['Parent: ', node.parent_node_id] }) : null,
          node.created_at ? jsxs('span', { className: 'tabular-nums', children: [formatDate(node.created_at)] }) : null
        ]
      }),

      // Dependencies — the depends_on drill-down (satisfied or not).
      jsxs('div', {
        className: 'flex flex-col gap-0.5 px-0.5',
        children: [
          jsxs(SectionTitle, {
            right: deps
              ? jsx('span', {
                  className: cn('tabular-nums', deps.satisfied === deps.total ? 'text-(--ui-text-tertiary)' : 'text-amber-500/90 dark:text-amber-300/90'),
                  children: deps.total === 0 ? 'none' : `${deps.satisfied}/${deps.total} satisfied`
                })
              : null,
            children: 'Dependencies'
          }),
          deps && deps.total > 0
            ? jsxs('div', {
                className: 'flex flex-col divide-y divide-(--ui-stroke-tertiary)',
                children: deps.deps.map((d) =>
                  jsxs(
                    'div',
                    {
                      className: 'flex items-center gap-1.5 py-0.5 text-[0.625rem]',
                      children: [
                        jsx(Codicon, {
                          name: d.satisfied ? 'check' : 'hourglass',
                          size: '0.65rem',
                          className: d.satisfied ? 'shrink-0 text-(--ui-accent)' : 'shrink-0 text-amber-500/90 dark:text-amber-300/90'
                        }),
                        d.target
                          ? jsxs('button', {
                              type: 'button',
                              onClick: () => onSelect(d.target.node_id),
                              className: 'min-w-0 truncate hover:underline',
                              children: nodeLabel(d.target)
                            })
                          : jsx('span', { className: 'min-w-0 truncate font-mono', children: d.targetId }),
                        jsx('span', { className: 'ml-auto shrink-0 text-(--ui-text-quaternary)', children: d.target ? d.target.state : 'missing' })
                      ]
                    },
                    d.targetId
                  )
                )
              })
            : jsx('div', { className: 'px-0.5 text-[0.625rem] text-(--ui-text-quaternary)', children: 'No depends_on relations on this node.' })
        ]
      }),

      // Graph relations — blockers in, dependants, and what this node blocks.
      jsxs('div', {
        className: 'flex flex-col gap-1 px-0.5',
        children: [
          jsx(RelationChips, {
            title: 'Blockers',
            codicon: 'debug-disconnect',
            destructive: true,
            items: blockers.map((b) => ({ id: b.from.node_id, label: nodeLabel(b.from), hint: b.reason || undefined })),
            onSelect
          }),
          jsx(RelationChips, {
            title: 'Dependants',
            codicon: 'arrow-down',
            items: dependants.map((n) => ({ id: n.node_id, label: nodeLabel(n) })),
            onSelect
          }),
          jsx(RelationChips, {
            title: 'Blocks',
            codicon: 'arrow-up',
            items: blocks.map((n) => ({ id: n.node_id, label: nodeLabel(n) })),
            onSelect
          })
        ]
      }),

      todos.length > 0
        ? jsxs('div', {
            className: 'flex flex-col gap-0.5 px-0.5',
            children: [
              jsx(SectionTitle, {
                right: jsx('span', { className: 'tabular-nums text-(--ui-text-quaternary)', children: plural(todos.length, 'todo') }),
                children: 'Todos'
              }),
              jsxs('div', {
                className: 'flex flex-col divide-y divide-(--ui-stroke-tertiary)',
                children: todos.map((t) => jsx(TodoRow, { todo: t, onMutate: mutateTodo, busyTodoId }, t.todo_id))
              })
            ]
          })
        : null,

      jsx(Separator, { className: 'my-0.5' }),

      // Actor + expected_version context row — always visible before acting.
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2 px-0.5',
        children: [
          jsxs('label', {
            className: 'flex items-center gap-1.5 text-[0.625rem] text-(--ui-text-tertiary)',
            children: [
              'Actor',
              jsx(Input, {
                value: actor,
                onChange: (ev) => setActor(ev.target.value),
                className: 'h-6 w-28 px-1.5 text-xs',
                spellCheck: false,
                'aria-label': 'Actor'
              })
            ]
          }),
          jsxs('span', {
            className: 'font-mono text-[0.6rem] text-(--ui-text-quaternary)',
            children: ['expected_version = ', String(expectedVersion)]
          })
        ]
      }),

      error && ec
        ? jsxs('div', {
            className: 'flex items-start gap-2 rounded-[3px] bg-destructive/10 px-2 py-1.5 text-xs text-destructive',
            children: [
              jsx(Codicon, { name: 'error', size: '0.85rem', className: 'mt-px shrink-0' }),
              jsxs('div', {
                className: 'min-w-0 flex-1',
                children: [
                  jsxs('div', {
                    className: 'font-medium',
                    children: [ec.title, ec.code != null ? ` (code ${ec.code})` : '']
                  }),
                  jsx('div', { className: 'mt-0.5 opacity-90', children: ec.hint })
                ]
              }),
              error.code === 5064 || error.code === 5065
                ? jsx(Button, {
                    type: 'button',
                    variant: 'secondary',
                    size: 'xs',
                    onClick: onMutated,
                    children: 'Reload snapshot'
                  })
                : null
            ]
          })
        : null,

      // Node actions — availability mirrors the node's lifecycle state.
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-1.5 px-0.5',
        children: [
          jsx(MutationButton, {
            label: 'Claim',
            codicon: 'person-add',
            busy: busyOp === 'claim_node',
            disabled: node.state !== 'ready',
            onClick: () => mutate('claim_node')
          }),
          jsxs('div', {
            className: 'flex items-center gap-1.5',
            children: [
              jsx(Input, {
                value: progressInput,
                onChange: (ev) => setProgressInput(ev.target.value.replace(/[^0-9]/g, '')),
                placeholder: '0-100',
                className: 'h-6 w-16 px-1.5 text-xs tabular-nums',
                inputMode: 'numeric',
                'aria-label': 'Progress (0-100)'
              }),
              jsx(MutationButton, {
                label: 'Progress',
                codicon: 'arrow-up',
                busy: busyOp === 'update_progress',
                disabled: node.state !== 'in_progress' || progressInput === '',
                onClick: () => mutate('update_progress', { progress: Number(progressInput) })
              })
            ]
          }),
          jsx(MutationButton, {
            label: 'Complete',
            codicon: 'pass-filled',
            busy: busyOp === 'complete_node',
            disabled: node.state !== 'in_progress',
            onClick: () => mutate('complete_node')
          }),
          node.state === 'blocked'
            ? jsx(MutationButton, {
                label: 'Unblock',
                codicon: 'debug-restart',
                busy: busyOp === 'unblock_node',
                onClick: () => mutate('unblock_node')
              })
            : jsxs('div', {
                className: 'flex items-center gap-1.5',
                children: [
                  jsx(Input, {
                    value: reason,
                    onChange: (ev) => setReason(ev.target.value),
                    placeholder: compact ? 'reason…' : 'block reason (required)',
                    className: 'h-6 w-40 px-1.5 text-xs',
                    'aria-label': 'Block reason'
                  }),
                  jsx(MutationButton, {
                    label: 'Block',
                    codicon: 'debug-disconnect',
                    tone: 'danger',
                    busy: busyOp === 'block_node',
                    disabled: (node.state === 'ready' || node.state === 'in_progress') && !reason.trim(),
                    onClick: () => mutate('block_node', { reason: reason.trim() })
                  })
                ]
              })
        ]
      })
    ]
  })
}
