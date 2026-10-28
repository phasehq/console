import { useEffect, useState } from 'react'

/**
 * Responsive colSpan for tables that hide columns below md: spanning cells
 * must match the rendered column count, or the extra spans create phantom
 * columns that steal width from auto-sized columns.
 */
export const useResponsiveColSpan = (mobileCols: number, desktopCols: number) => {
  const [colSpan, setColSpan] = useState(desktopCols)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const update = () => setColSpan(mq.matches ? desktopCols : mobileCols)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [mobileCols, desktopCols])

  return colSpan
}
