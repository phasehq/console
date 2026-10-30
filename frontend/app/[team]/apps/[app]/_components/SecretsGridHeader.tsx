'use client'

import {
  DragEvent,
  Fragment,
  KeyboardEvent,
  PointerEvent,
  RefObject,
  memo,
  useRef,
  useState,
} from 'react'
import { Menu, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaArrowLeft, FaArrowRight, FaChevronDown, FaDownload } from 'react-icons/fa'
import { FaCircle, FaGripVertical } from 'react-icons/fa6'
import { IconType } from 'react-icons'
import { EnvironmentType } from '@/apollo/graphql'
import { Checkbox } from '@/components/common/Checkbox'
import {
  CreateEnvironmentDialog,
  CreateEnvironmentDialogHandle,
} from '@/components/environments/CreateEnvironmentDialog'
import { ManageEnvironmentDialog } from '@/components/environments/ManageEnvironmentDialog'
import { envColor } from '@/utils/environment'
import { COLUMN_MAX_PX, COLUMN_MIN_PX, GridColumn, NEW_ENV_CELL } from './gridColumns'

// Translucent + blur like the old thead; rows scroll underneath the sticky cells
export const GRID_HEADER_BG = 'bg-zinc-200/90 dark:bg-zinc-900/90 backdrop-blur-sm'
/** For the pinned corner and trailing cells, which env headers also scroll under sideways */
export const GRID_HEADER_BG_SOLID = 'bg-zinc-200 dark:bg-zinc-900'
const TH_BASE =
  'sticky top-0 p-0 font-normal text-left align-middle border-b border-r border-neutral-500/20'
/** The grid sets data-hovered on an env header while a cell in its column is hovered */
const ENV_TH_HOVERED = 'data-[hovered]:bg-zinc-300 dark:data-[hovered]:bg-zinc-700'

const EnvMenuItem = ({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: IconType
  label: string
  disabled?: boolean
  onClick: () => void
}) => (
  <Menu.Item disabled={disabled}>
    {({ focus }) => (
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left',
          focus && 'bg-zinc-200 dark:bg-zinc-700',
          disabled && 'opacity-40'
        )}
      >
        <Icon className="shrink-0 text-2xs text-neutral-500" />
        {label}
      </button>
    )}
  </Menu.Item>
)

const EnvColumnMenu = ({
  env,
  allowReordering,
  canMoveLeft,
  canMoveRight,
  onMove,
  onExport,
}: {
  env: EnvironmentType
  allowReordering: boolean
  canMoveLeft: boolean
  canMoveRight: boolean
  onMove: (envId: string, direction: 'left' | 'right') => void
  onExport: (envId: string) => void
}) => (
  <Menu as="div" className="relative">
    <Menu.Button
      className="rounded p-1 text-neutral-500 hover:bg-zinc-300/60 hover:text-zinc-900 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-100"
      title={`${env.name} options`}
    >
      <FaChevronDown className="text-3xs" />
    </Menu.Button>
    <Transition
      as={Fragment}
      enter="transition ease-out duration-100"
      enterFrom="transform opacity-0 scale-95"
      enterTo="transform opacity-100 scale-100"
      leave="transition ease-in duration-75"
      leaveFrom="transform opacity-100 scale-100"
      leaveTo="transform opacity-0 scale-95"
    >
      {/* Anchored into a portal so the table's scroll container can't clip it */}
      <Menu.Items
        anchor={{ to: 'bottom end', gap: 4 }}
        className="z-50 w-44 rounded-md bg-zinc-100 p-1 text-xs text-zinc-900 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none dark:bg-zinc-800 dark:text-zinc-100"
      >
        {allowReordering && (
          <>
            <EnvMenuItem
              icon={FaArrowLeft}
              label="Move left"
              disabled={!canMoveLeft}
              onClick={() => onMove(env.id, 'left')}
            />
            <EnvMenuItem
              icon={FaArrowRight}
              label="Move right"
              disabled={!canMoveRight}
              onClick={() => onMove(env.id, 'right')}
            />
          </>
        )}
        <EnvMenuItem icon={FaDownload} label="Export as .env" onClick={() => onExport(env.id)} />
      </Menu.Items>
    </Transition>
  </Menu>
)

type SecretsGridHeaderProps = {
  columns: GridColumn[]
  appId: string
  canCreateEnvironments: boolean
  canManageEnvironments: boolean
  allowReordering: boolean
  dirtyEnvIds: Set<string>
  onToggle: (envId: string) => void
  onSolo: (envId: string) => void
  onMove: (envId: string, direction: 'left' | 'right') => void
  /** A header dropped on another env's header, landing before or after it */
  onDrop: (envId: string, targetEnvId: string, after: boolean) => void
  onExport: (envId: string) => void
  /** Checked env columns can be resized (not when one env fills the grid) */
  resizable: boolean
  /** The key column's id for resizing (env columns use their env id) */
  keyColumnId: string
  /** Live width while dragging (applied to the table directly, without a render) */
  onResizePreview: (columnId: string, px: number) => void
  /** Saves a column's width; null resets it to the default */
  onResize: (columnId: string, px: number | null) => void
  newEnvironmentRef: RefObject<CreateEnvironmentDialogHandle | null>
}

type DropTarget = { envId: string; after: boolean }

const DropIndicator = ({ after }: { after: boolean }) => (
  <span
    aria-hidden
    className={clsx(
      'pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-emerald-500',
      after ? '-right-px' : '-left-px'
    )}
  />
)

/**
 * The grid's header row doubles as the environment tabs: checked envs are full
 * columns (click the name to show only that env, again to restore), unchecked
 * envs stay in place as slim columns that expand on click.
 */
const SecretsGridHeaderBase = ({
  columns,
  appId,
  canCreateEnvironments,
  canManageEnvironments,
  allowReordering,
  dirtyEnvIds,
  onToggle,
  onSolo,
  onMove,
  onDrop,
  onExport,
  resizable,
  keyColumnId,
  onResizePreview,
  onResize,
  newEnvironmentRef,
}: SecretsGridHeaderProps) => {
  const checkedCount = columns.filter((c) => c.checked).length

  // The key and env columns resize from a handle on their header's right edge
  const resizingRef = useRef(false)
  const clampWidth = (px: number) => Math.min(Math.max(px, COLUMN_MIN_PX), COLUMN_MAX_PX)
  const startResize = (e: PointerEvent<HTMLElement>, columnId: string) => {
    if (e.button !== 0) return
    // No text selection, and no tab drag from the header around it
    e.preventDefault()
    e.stopPropagation()
    resizingRef.current = true
    const handle = e.currentTarget
    const startX = e.clientX
    const startWidth = handle.closest('th')!.getBoundingClientRect().width
    let width = startWidth
    let frame = 0
    handle.setPointerCapture(e.pointerId)
    const move = (event: globalThis.PointerEvent) => {
      width = clampWidth(startWidth + event.clientX - startX)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => onResizePreview(columnId, width))
    }
    const end = () => {
      cancelAnimationFrame(frame)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      resizingRef.current = false
      if (Math.abs(width - startWidth) >= 1) onResize(columnId, width)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
  const resizeByKey = (e: KeyboardEvent<HTMLElement>, columnId: string) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = (e.shiftKey ? 64 : 16) * (e.key === 'ArrowLeft' ? -1 : 1)
    const width = e.currentTarget.closest('th')!.getBoundingClientRect().width
    onResize(columnId, clampWidth(width + step))
  }
  // A render helper, not a component: the handle must not remount mid-drag
  const renderResizeHandle = (columnId: string, label: string) => (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className="group/resize absolute inset-y-0 right-0 z-10 flex w-2 cursor-col-resize touch-none justify-end focus:outline-none"
      onPointerDown={(e) => startResize(e, columnId)}
      onDoubleClick={() => onResize(columnId, null)}
      onKeyDown={(e) => resizeByKey(e, columnId)}
    >
      <span className="h-full w-0.5 transition-colors group-hover/resize:bg-emerald-500/70 group-focus-visible/resize:bg-emerald-500" />
    </span>
  )

  // Env headers drag like tabs to reorder the columns. Refs carry the drag between events
  // (dragover can fire before a re-render); state only drives the visuals.
  const [draggedEnvId, setDraggedEnvId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const draggedRef = useRef<string | null>(null)
  const dropTargetRef = useRef<DropTarget | null>(null)
  const endDrag = () => {
    draggedRef.current = null
    dropTargetRef.current = null
    setDraggedEnvId(null)
    setDropTarget(null)
  }
  const dragProps = (envId: string) =>
    allowReordering
      ? {
          draggable: true,
          onDragStart: (e: DragEvent<HTMLElement>) => {
            if (resizingRef.current) {
              e.preventDefault()
              return
            }
            e.dataTransfer.effectAllowed = 'move'
            // Firefox only starts a drag that carries data
            e.dataTransfer.setData('text/plain', envId)
            draggedRef.current = envId
            setDraggedEnvId(envId)
          },
          onDragOver: (e: DragEvent<HTMLElement>) => {
            if (!draggedRef.current) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const rect = e.currentTarget.getBoundingClientRect()
            const after = e.clientX > rect.left + rect.width / 2
            const current = dropTargetRef.current
            if (current?.envId === envId && current.after === after) return
            dropTargetRef.current = { envId, after }
            setDropTarget(dropTargetRef.current)
          },
          onDrop: (e: DragEvent<HTMLElement>) => {
            e.preventDefault()
            const dragged = draggedRef.current
            const target = dropTargetRef.current
            if (dragged && target) onDrop(dragged, target.envId, target.after)
            endDrag()
          },
          onDragEnd: endDrag,
        }
      : {}
  const dropIndicatorFor = (envId: string) =>
    dropTarget?.envId === envId && draggedEnvId && draggedEnvId !== envId ? (
      <DropIndicator after={dropTarget.after} />
    ) : null

  return (
    <thead>
      <tr>
        <th className={clsx(TH_BASE, GRID_HEADER_BG_SOLID, 'left-0 z-40')}>
          {/* The right side is left free for the scroll-back button (GridScrollControls) */}
          <div className="flex h-9 items-center pl-10 pr-2">
            <span className="text-2xs font-medium uppercase tracking-wide text-neutral-500 2xl:text-xs">
              key
            </span>
          </div>
          {renderResizeHandle(keyColumnId, 'the key column')}
        </th>

        {columns.map((column, index) => {
          const { env } = column
          const color = envColor(env)

          if (!column.checked) {
            return (
              <th
                key={env.id}
                data-env-column=""
                className={clsx(
                  TH_BASE,
                  GRID_HEADER_BG,
                  ENV_TH_HOVERED,
                  'z-20',
                  draggedEnvId === env.id && 'opacity-50'
                )}
                {...dragProps(env.id)}
              >
                {dropIndicatorFor(env.id)}
                <button
                  type="button"
                  onClick={() => onToggle(env.id)}
                  title={`Show ${env.name}`}
                  className="flex h-9 w-full flex-col items-center justify-center gap-0.5 px-1 transition-colors hover:bg-zinc-300/60 dark:hover:bg-zinc-700/60"
                >
                  {/* Same look as an unchecked Checkbox — a real one can't nest in this button */}
                  <span className="h-3.5 w-3.5 rounded-full bg-zinc-100 ring-1 ring-inset ring-neutral-500/40 dark:bg-zinc-800" />
                  <span className="flex max-w-full items-center gap-1 text-3xs text-neutral-500">
                    <FaCircle className="shrink-0 text-[5px]" style={{ color }} />
                    <span className="truncate">{env.name}</span>
                  </span>
                </button>
              </th>
            )
          }

          const isOnlyChecked = checkedCount === 1
          const lockReason = isOnlyChecked
            ? 'At least one environment stays shown'
            : dirtyEnvIds.has(env.id)
              ? `Deploy or discard the changes in ${env.name} before hiding it`
              : undefined

          return (
            <th
              key={env.id}
              data-env-column=""
              data-checked=""
              className={clsx(
                TH_BASE,
                GRID_HEADER_BG,
                ENV_TH_HOVERED,
                'z-20',
                allowReordering && 'cursor-grab active:cursor-grabbing',
                draggedEnvId === env.id && 'opacity-50'
              )}
              // The env's color as a tab accent along the top edge
              style={{ boxShadow: `inset 0 2px 0 ${color}` }}
              {...dragProps(env.id)}
            >
              {dropIndicatorFor(env.id)}
              {resizable && renderResizeHandle(env.id, env.name)}
              <div className="group/env flex h-9 items-center gap-1.5 px-2">
                {allowReordering && (
                  <FaGripVertical
                    aria-hidden
                    title="Drag to reorder"
                    className="-ml-1 -mr-0.5 shrink-0 text-2xs text-neutral-500/60 opacity-0 transition-opacity group-hover/env:opacity-100"
                  />
                )}
                <span title={lockReason ?? `Hide ${env.name}`} className="shrink-0">
                  <Checkbox
                    size="sm"
                    checked
                    onChange={() => onToggle(env.id)}
                    disabled={Boolean(lockReason)}
                  />
                </span>
                <button
                  type="button"
                  onClick={() => onSolo(env.id)}
                  title={isOnlyChecked ? 'Show the previous selection' : `Show only ${env.name}`}
                  className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-zinc-300/60 dark:hover:bg-zinc-700/60"
                >
                  <FaCircle className="shrink-0 text-[7px]" style={{ color }} />
                  <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    {env.name}
                  </span>
                </button>
                <div className="ml-auto flex shrink-0 items-center">
                  {canManageEnvironments && (
                    <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/env:opacity-100">
                      <ManageEnvironmentDialog environment={env} buttonVariant="ghost" />
                    </div>
                  )}
                  {/* Always shown: it's where the column's options (move, export) live */}
                  <EnvColumnMenu
                    env={env}
                    allowReordering={allowReordering}
                    canMoveLeft={index > 0}
                    canMoveRight={index < columns.length - 1}
                    onMove={onMove}
                    onExport={onExport}
                  />
                </div>
              </div>
            </th>
          )
        })}

        {/* After the last env, like a browser's new-tab button; the whole column opens it */}
        <th
          className={clsx(
            TH_BASE,
            GRID_HEADER_BG,
            'z-20 border-l !border-r-0',
            canCreateEnvironments && 'cursor-pointer'
          )}
          {...(canCreateEnvironments ? NEW_ENV_CELL : {})}
        >
          {canCreateEnvironments && (
            <div className="flex h-9 items-center px-1">
              <CreateEnvironmentDialog ref={newEnvironmentRef} appId={appId} />
            </div>
          )}
        </th>
      </tr>
    </thead>
  )
}

export const SecretsGridHeader = memo(SecretsGridHeaderBase)
