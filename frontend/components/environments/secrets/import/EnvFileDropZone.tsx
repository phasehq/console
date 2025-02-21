import clsx from 'clsx'
import { useState, useRef } from 'react'
import { TbDownload } from 'react-icons/tb'
import { toast } from 'react-toastify'

interface EnvFileDropZoneProps {
  onFileProcessed: (content: string) => void
}

const MAX_FILE_SIZE = 100 * 1024 // 100KB

const EnvFileDropZone = ({ onFileProcessed }: EnvFileDropZoneProps) => {
  const [dragOver, setDragOver] = useState(false)
  const dragCounter = useRef(0) // Track nested drag events
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = (file: File | null) => {
    if (!file) return

    if (!/\.env(\..+)?$/.test(file.name)) {
      toast.error('Invalid file type. Please upload a valid .env file.')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error('File size exceeds 100KB limit.')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      if (e.target?.result) {
        onFileProcessed(e.target.result as string)
        fileInputRef.current!.value = '' // Reset input to allow re-uploading the same file
      }
    }
    reader.onerror = () => {
      toast.error('Failed to read the file. Please try again.')
    }
    reader.readAsText(file)
  }

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFileUpload(event.target.files?.[0] || null)
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (dragCounter.current === 0) setDragOver(true)
    dragCounter.current++
  }

  const handleDragLeave = () => {
    dragCounter.current--
    if (dragCounter.current === 0) setDragOver(false)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragOver(false)
    dragCounter.current = 0

    if (event.dataTransfer.files.length > 0) {
      handleFileUpload(event.dataTransfer.files[0])
    }
  }

  return (
    <div
      className={clsx(
        'w-full h-full p-4 border border-dashed rounded flex flex-col gap-2 items-center justify-center text-neutral-500 cursor-pointer transition ease',
        dragOver
          ? 'border-emerald-400/20 bg-emerald-400/10'
          : 'border-neutral-500/40 hover:border-emerald-400/20 bg-neutral-200 dark:bg-neutral-900/50 hover:bg-emerald-400/20 dark:hover:bg-emerald-400/10'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      <TbDownload className="text-4xl" />
      <div className="font-medium text-sm">Choose a file or drag it here</div>
      <input type="file" onChange={handleFileInputChange} className="hidden" ref={fileInputRef} />
    </div>
  )
}

export default EnvFileDropZone
