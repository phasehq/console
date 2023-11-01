import { copyToClipBoard } from '@/utils/clipboard'
import { FaCopy } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { Button } from '../common/Button'

export const AccountSeedGen = (props: { mnemonic: string }) => {
  const handleCopyClick = async () => {
    const copied = await copyToClipBoard(props.mnemonic)
    copied ? toast.success('Copied to clipboard') : toast.error('Failed to copy')
  }

  return (
    <div className="grid grid-cols-6 gap-4">
      <div className="col-span-6 flex justify-end items-center mb-8">
        <Button
          variant={'outline'}
          title="Copy recovery phrase to the clipboard"
          onClick={handleCopyClick}
          type="button"
        >
          Copy
          <FaCopy />
        </Button>
      </div>
      {props.mnemonic.split(' ').map((word: string, index: number) => (
        <div
          className="font-mono text-medium text-black dark:text-white flex gap-2 items-center border dark:border-violet-200/10 border-zinc-500/10 rounded-xl px-2 py-1 group"
          key={word + index}
        >
          <span className="text-zinc-400 dark:text-zinc-700">{index + 1}</span>
          <span className="hidden group-hover:block ph-mask">{word}</span>
          <span className="group-hover:hidden">*****</span>
        </div>
      ))}
    </div>
  )
}
