import { FaCopy, FaFileDownload } from 'react-icons/fa'
import { Button } from '../common/Button'

export const AccountRecovery = (props: {
  mnemonic: string
  onDownload: Function
  onCopy: Function
}) => {
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
          <li>You can also copy this recovery kit and store it in a password manager.</li>
        </ul>
        <div className="pt-4 flex items-center gap-4">
          <Button variant="primary" onClick={() => props.onDownload()} type="button">
            Download Recovery Kit <FaFileDownload />
          </Button>
          <Button
            variant={'outline'}
            title="Copy recovery phrase to the clipboard"
            onClick={() => props.onCopy()}
            type="button"
          >
            Copy recovery kit
            <FaCopy />
          </Button>
        </div>
      </div>
    </div>
  )
}
