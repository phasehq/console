import { copyToClipBoard } from '@/utils/clipboard'
import { FaCopy, FaFileDownload } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { Button } from '../common/Button'

export const AccountRecovery = (props: { mnemonic: string; onDownload: Function }) => {
  const handleCopyClick = async () => {
    const copied = await copyToClipBoard(props.mnemonic)
    copied ? toast.info('Copied to clipboard', { autoClose: 2000 }) : toast.error('Failed to copy')
  }

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <div className="text-black dark:text-white font-medium text-xl">Recovery kit</div>
        <div className="text-neutral-500">
          Please download this account recovery kit. It contains your account recovery phrase along
          with your account name, email and other information to help you recover your account if
          you get locked out or forget your sudo password.
        </div>
        <ul className="list-disc list-inside text-neutral-500">
          <li>We recommend printing out this recovery kit and keeping it somewhere safe.</li>
          <li>Do not share this recovery kit with anyone else.</li>
        </ul>
        <div className="pt-2">
          <Button variant="primary" onClick={() => props.onDownload()} type="button">
            Download Recovery Kit <FaFileDownload />
          </Button>
        </div>
      </div>

      <hr className="border-neutral-500/20" />

      <div className="space-y-2">
        <div className="text-black dark:text-white font-medium text-xl">
          Recovery phrase (optional)
        </div>
        <div className="text-neutral-500">
          You may also copy your account recovery phrase below and store it in a password manager if
          you use one. This step is optional.
        </div>
        <div className="pt-2">
          <Button
            variant={'outline'}
            title="Copy recovery phrase to the clipboard"
            onClick={handleCopyClick}
            type="button"
          >
            Copy recovery phrase
            <FaCopy />
          </Button>
        </div>
      </div>
    </div>
  )
}
