'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'

const MIN_WIDTH = 208
const MAX_WIDTH = 448
const DEFAULT_WIDTH = 256
const KEYBOARD_STEP = 16
const WIDTH_KEY = 'sidebar-width'

export const SIDEBAR_WIDTH = `var(--sidebar-width, ${DEFAULT_WIDTH}px)`

const clamp = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))

// Resizes its parent. The width lives in a CSS variable there, so dragging never re-renders the sidebar
export const SidebarResizeHandle = () => {
  const handleRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ x: number; width: number } | null>(null)

  const apply = useCallback(
    (next: number) =>
      handleRef.current?.parentElement?.style.setProperty('--sidebar-width', `${next}px`),
    []
  )

  const commit = useCallback(
    (next: number) => {
      const clamped = clamp(next)
      apply(clamped)
      setWidth(clamped)
      try {
        localStorage.setItem(WIDTH_KEY, String(clamped))
      } catch {
        // Storage can be blocked; the width then resets when the page reloads
      }
    },
    [apply]
  )

  // A layout effect, so a saved width is applied before the first paint
  useLayoutEffect(() => {
    let stored = NaN
    try {
      stored = Number(localStorage.getItem(WIDTH_KEY))
    } catch {
      // Storage can be blocked
    }
    if (!stored) return
    apply(clamp(stored))
    setWidth(clamp(stored))
  }, [apply])

  const draggedWidth = (clientX: number) =>
    dragStart.current ? dragStart.current.width + clientX - dragStart.current.x : width

  const endDrag = (event: React.PointerEvent) => {
    if (!dragStart.current) return
    commit(draggedWidth(event.clientX))
    dragStart.current = null
    setDragging(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const next = {
      ArrowLeft: width - KEYBOARD_STEP,
      ArrowRight: width + KEYBOARD_STEP,
      Home: MIN_WIDTH,
      End: MAX_WIDTH,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    commit(next)
  }

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        // Stops the drag from selecting text
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragStart.current = {
          x: event.clientX,
          width: event.currentTarget.parentElement?.getBoundingClientRect().width ?? width,
        }
        setDragging(true)
      }}
      onPointerMove={(event) => dragStart.current && apply(clamp(draggedWidth(event.clientX)))}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => commit(DEFAULT_WIDTH)}
      onKeyDown={handleKeyDown}
      className="group/resize absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none"
    >
      <div
        className={clsx(
          'absolute inset-y-0 left-1 w-px transition-colors',
          dragging
            ? 'bg-emerald-500'
            : 'group-hover/resize:bg-neutral-500/60 group-focus-visible/resize:bg-emerald-500'
        )}
      />
    </div>
  )
}
