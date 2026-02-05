import { useRef, useState, useEffect } from 'react'
import { Button } from '@/components/common/Button'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import clsx from 'clsx'
import { FaExpand } from 'react-icons/fa'
import GenericDialog from '@/components/common/GenericDialog'

interface AppDescriptionViewerProps {
  description: string
  className?: string
  maxHeightClass?: string
}

export const AppDescriptionViewer = ({
  description,
  className,
  maxHeightClass = 'max-h-80',
}: AppDescriptionViewerProps) => {
  const dialogRef = useRef<{ openModal: () => void }>(null)
  const contentRef = useRef<HTMLDivElement>(null)
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

  const components = {
    code(props: any) {
      const { children, className, node, ...rest } = props
      const match = /language-(\w+)/.exec(className || '')
      return match ? (
        <SyntaxHighlighter
          {...rest}
          PreTag="div"
          children={String(children).replace(/\n$/, '')}
          language={match[1]}
          style={vscDarkPlus}
        />
      ) : (
        <code {...rest} className={className}>
          {children}
        </code>
      )
    },
  }

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
        <div className="absolute inset-0 z-10 bg-neutral-50/60 dark:bg-neutral-900/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg pointer-events-none" />
        <div
          ref={contentRef}
          className={clsx(
            'prose dark:prose-invert max-w-none p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800',
            maxHeightClass,
            'overflow-hidden'
          )}
        >
          <ReactMarkdown components={components}>{description}</ReactMarkdown>
        </div>
        {isOverflowing && (
          <div
            className={clsx(
              'absolute bottom-0 inset-x-0 h-12 pointer-events-none rounded-b-lg z-10',
              'bg-gradient-to-t from-neutral-50 dark:from-neutral-900 via-neutral-50/90 dark:via-neutral-900/90 to-transparent'
            )}
          />
        )}
      </div>

      <GenericDialog ref={dialogRef} title="App Description" size="lg">
        <div className="prose dark:prose-invert max-w-none">
          <ReactMarkdown components={components}>{description}</ReactMarkdown>
        </div>
      </GenericDialog>
    </>
  )
}
