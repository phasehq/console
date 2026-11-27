import { ReactNode, useRef } from 'react'
import { toast } from 'react-toastify'
import { Textarea } from '@/components/common/TextArea'
import { envFilePlaceholder, readEnvFile } from '@/utils/secrets'
import { EnvFileDropHint } from './EnvFileDropHint'

/** Reads a .env file and hands over its text, or says why it can't */
export const readEnvFileInto = (onText: (text: string) => void) => (file: File) =>
  readEnvFile(file).then(onText, (error: Error) => toast.error(error.message))

/**
 * Where a .env goes in: typed or pasted into the box, dropped onto it, or chosen from disk.
 * The parent takes drops (useFileDrop) on whatever area it likes and passes `over` in.
 */
export const EnvFileInput = ({
  value,
  setValue,
  onFile,
  over,
  rows = 12,
  lead,
}: {
  value: string
  setValue: (text: string) => void
  onFile: (file: File) => void
  /** A file is being dragged over the drop area */
  over: boolean
  rows?: number
  /** Said first, before how to put secrets in */
  lead?: ReactNode
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <p className="text-neutral-500 text-sm">
        {lead && <>{lead} </>}
        Type or paste your secrets, drop a .env file onto the box, or{' '}
        <button
          type="button"
          className="text-emerald-600 hover:underline dark:text-emerald-400"
          onClick={() => fileInputRef.current?.click()}
        >
          choose a file
        </button>
        .
      </p>
      <input
        type="file"
        hidden
        ref={fileInputRef}
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Lets the same file be chosen again
          event.target.value = ''
          if (file) onFile(file)
        }}
      />

      <div className="relative">
        <Textarea
          value={value}
          setValue={setValue}
          placeholder={envFilePlaceholder}
          rows={rows}
          className="block font-mono text-zinc-700 dark:text-zinc-300 text-sm placeholder:text-zinc-500"
        />
        {over && <EnvFileDropHint>Drop your .env file here</EnvFileDropHint>}
      </div>
    </>
  )
}
