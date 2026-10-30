'use client'

import { RefObject, useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa'

type ScrollState = {
  keyWidth: number
  scrollbarWidth: number
  headerHeight: number
  contentHeight: number
  hiddenLeft: number
  hiddenRight: number
}

const IDLE: ScrollState = {
  keyWidth: 0,
  scrollbarWidth: 0,
  headerHeight: 0,
  contentHeight: 0,
  hiddenLeft: 0,
  hiddenRight: 0,
}

const sameState = (a: ScrollState, b: ScrollState) =>
  (Object.keys(a) as (keyof ScrollState)[]).every((key) => a[key] === b[key])

/** The header row split into the sticky key cell, the env columns and the new-environment cell */
const headerCells = (scroller: HTMLElement) => {
  const row = scroller.querySelector<HTMLTableRowElement>('thead tr')
  if (!row || row.cells.length < 3) return null
  const cells = Array.from(row.cells)
  return { row, key: cells[0], envs: cells.slice(1, -1) }
}

/**
 * Cues for the grid's sideways scroll: a fade on each side that has env
 * columns out of view, and ‹ › buttons in the header row that step one env
 * column at a time and count the envs out of view.
 */
export const GridScrollControls = ({
  scrollerRef,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>
}) => {
  const [state, setState] = useState<ScrollState>(IDLE)

  // Column positions in scroll-content coordinates (the env headers stick vertically only)
  const contentLeft = (scroller: HTMLElement, cell: HTMLElement) =>
    cell.getBoundingClientRect().left -
    (scroller.getBoundingClientRect().left + scroller.clientLeft) +
    scroller.scrollLeft

  const measure = useCallback(() => {
    const scroller = scrollerRef.current
    const cells = scroller && headerCells(scroller)
    if (!scroller || !cells) {
      setState(IDLE)
      return
    }

    const visibleLeft = scroller.scrollLeft + cells.key.offsetWidth
    const visibleRight = scroller.scrollLeft + scroller.clientWidth
    const table = scroller.querySelector('table')

    const next: ScrollState = {
      keyWidth: cells.key.offsetWidth,
      scrollbarWidth: scroller.offsetWidth - scroller.clientWidth,
      headerHeight: cells.row.offsetHeight,
      contentHeight: Math.min(table?.offsetHeight ?? 0, scroller.clientHeight),
      hiddenLeft: cells.envs.filter((cell) => contentLeft(scroller, cell) < visibleLeft - 1).length,
      hiddenRight: cells.envs.filter(
        (cell) => contentLeft(scroller, cell) + cell.offsetWidth > visibleRight + 1
      ).length,
    }
    setState((prev) => (sameState(prev, next) ? prev : next))
  }, [scrollerRef])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    schedule()
    scroller.addEventListener('scroll', schedule, { passive: true })
    // The table resizes when columns are checked/unchecked or the key column refits
    const observer = new ResizeObserver(schedule)
    observer.observe(scroller)
    const table = scroller.querySelector('table')
    if (table) observer.observe(table)
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', schedule)
      observer.disconnect()
    }
  }, [scrollerRef, measure])

  /** Lines the next (or previous) checked env column up against the sticky key column */
  const step = (direction: 'left' | 'right') => {
    const scroller = scrollerRef.current
    const cells = scroller && headerCells(scroller)
    if (!scroller || !cells) return

    const boundary = scroller.scrollLeft + cells.key.offsetWidth
    const checked = cells.envs.filter((cell) => cell.hasAttribute('data-checked'))
    const candidates = (checked.length > 0 ? checked : cells.envs).map((cell) =>
      contentLeft(scroller, cell)
    )

    const target =
      direction === 'right'
        ? candidates.find((left) => left > boundary + 1)
        : [...candidates].reverse().find((left) => left < boundary - 1)

    scroller.scrollTo({
      left:
        target !== undefined
          ? target - cells.key.offsetWidth
          : direction === 'right'
            ? scroller.scrollWidth
            : 0,
      behavior: 'smooth',
    })
  }

  const buttonTop = Math.max(0, (state.headerHeight - 24) / 2)
  const fadeHeight = state.contentHeight

  // A render helper, not a component: a component defined here would remount on every scroll update
  const renderScrollButton = (direction: 'left' | 'right', count: number) => {
    const label = `Scroll ${direction} — ${count} more environment${count === 1 ? '' : 's'}`
    return (
      <button
        type="button"
        onClick={() => step(direction)}
        title={label}
        aria-label={label}
        className="absolute z-10 flex h-6 items-center gap-1 rounded-full bg-zinc-100 px-2 text-2xs font-medium text-zinc-700 shadow-md ring-1 ring-inset ring-neutral-500/30 transition-colors hover:bg-white dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        style={
          direction === 'left'
            ? // Inside the corner cell, so it never covers the first visible env's controls
              { left: state.keyWidth - 6, top: buttonTop, transform: 'translateX(-100%)' }
            : // Over the partly hidden column at the right edge
              { right: state.scrollbarWidth + 6, top: buttonTop }
        }
      >
        {direction === 'left' && <FaChevronLeft className="text-[9px]" />}
        <span>{count}</span>
        {direction === 'right' && <FaChevronRight className="text-[9px]" />}
      </button>
    )
  }

  const fadeBase = 'pointer-events-none absolute top-0 z-10 w-8 from-zinc-900/15 to-transparent dark:from-black/50'

  return (
    <>
      {state.hiddenLeft > 0 && (
        <>
          {/* The sticky key column's shadow over the scrolled-away envs */}
          <div
            className={clsx(fadeBase, 'bg-gradient-to-r')}
            style={{ left: state.keyWidth, height: fadeHeight }}
          />
          {renderScrollButton('left', state.hiddenLeft)}
        </>
      )}
      {state.hiddenRight > 0 && (
        <>
          <div
            className={clsx(fadeBase, 'bg-gradient-to-l')}
            style={{ right: state.scrollbarWidth, height: fadeHeight }}
          />
          {renderScrollButton('right', state.hiddenRight)}
        </>
      )}
    </>
  )
}
