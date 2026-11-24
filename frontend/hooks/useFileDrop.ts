import { DragEvent, useRef, useState } from 'react'

// Page content dragged about (an image, a link) can carry a file too, but brings markup with it
const carriesFile = ({ dataTransfer }: DragEvent) =>
  dataTransfer.types.includes('Files') && !dataTransfer.types.includes('text/html')

/** Lets an element take a file dropped from the desktop; `over` is true while one is dragged across it */
export const useFileDrop = (onFile: (file: File) => void, enabled = true) => {
  const [over, setOver] = useState(false)
  // Elements the drag is inside; one removed from the page mid-drag never reports leaving
  const entered = useRef<EventTarget[]>([])

  // A dialog's events bubble to its React parents from outside their DOM
  const accepts = (event: DragEvent<HTMLElement>) =>
    enabled && carriesFile(event) && event.currentTarget.contains(event.target as Node)

  const dropTarget = {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      if (!accepts(event)) return
      entered.current = [...entered.current, event.target]
      setOver(true)
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!accepts(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!accepts(event)) return
      const root = event.currentTarget
      entered.current = entered.current.filter(
        (element) => element !== event.target && root.contains(element as Node)
      )
      if (entered.current.length === 0) setOver(false)
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!accepts(event)) return
      event.preventDefault()
      entered.current = []
      setOver(false)
      const file = event.dataTransfer.files[0]
      if (file) onFile(file)
    },
  }

  return { over: over && enabled, dropTarget }
}
