import { useRef, useState, useEffect } from 'react'
import { Button } from '@/components/common/Button'
import clsx from 'clsx'
import { FaExpand } from 'react-icons/fa'
import GenericDialog from '@/components/common/GenericDialog'
import { MarkdownViewer } from '@/components/common/MarkdownViewer'

interface AppDescriptionViewerProps {
  description: string
  className?: string
  maxHeightClass?: string
}

/** The README as a collapsed card that expands into a dialog */
export const AppDescriptionViewer = ({
  description,
  className,
  maxHeightClass = 'max-h-80',
}: AppDescriptionViewerProps) => {
  const dialogRef = useRef<{ openModal: () => void }>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const dialogContentRef = useRef(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  useEffect(() => {
    const element = contentRef.current
    if (!element) return

    const checkOverflow = () => {
      setIsOverflowing(element.scrollHeight > element.clientHeight + 1)
    }

    const observer = new ResizeObserver(checkOverflow)
    observer.observe(element)

    checkOverflow()

    return () => observer.disconnect()
  }, [description])

  if (!description) return null

  return (
    <>
      <div
        className={clsx('relative group cursor-pointer', className)}
        onClick={() => dialogRef.current?.openModal()}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="secondary" size="md">
            <FaExpand /> <span className="ml-1">Expand</span>
          </Button>
        </div>
        <div className="absolute inset-0 z-10 bg-neutral-50/30 dark:bg-neutral-900/30 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg" />
        <div
          ref={contentRef}
          className={clsx(
            'prose dark:prose-invert max-w-none p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 pointer-events-none select-none',
            maxHeightClass,
            'overflow-hidden'
          )}
        >
          <MarkdownViewer text={description} />
        </div>
        {isOverflowing && (
          <div
            className={clsx(
              'absolute bottom-0 inset-x-0 h-20 pointer-events-none rounded-b-lg z-10',
              'bg-gradient-to-t from-neutral-50 dark:from-neutral-900 via-neutral-50/90 dark:via-neutral-900/90 to-transparent'
            )}
          />
        )}
      </div>

      <GenericDialog
        ref={dialogRef}
        title="App description and documentation"
        dialogTitle={
          <div className="pb-2">
            <h3 className="font-semibold text-lg">App README</h3>
            <p className="text-neutral-500 text-sm">App description and documentation</p>
          </div>
        }
        size="lg"
        initialFocus={dialogContentRef}
      >
        <div ref={dialogContentRef} className="prose dark:prose-invert max-w-none">
          <MarkdownViewer text={description} />
        </div>
      </GenericDialog>
    </>
  )
}
