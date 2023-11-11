import { FaCopy, FaFileDownload } from 'react-icons/fa'
import { Button } from '../common/Button'
import { Alert } from '../common/Alert'

export const AccountRecovery = (props: {
  mnemonic: string
  onDownload: Function
  onCopy: Function
}) => {
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <div className="text-black dark:text-white font-medium text-xl">Recovery kit</div>
        <p className="text-neutral-500">
          This recovery kit contains your account recovery phrase along with your account name,
          email and other information to help you recover your account if you get locked out.
        </p>
        <p className="text-neutral-500">
          Please download the recovery kit and keep it somewhere safe. You can also copy this
          recovery kit and store it in a password manager.
        </p>

        <Alert variant="warning" icon={true}>
          <p>
            If you forget your <strong>sudo password</strong> and lose your{' '}
            <strong>recovery kit</strong>, your account cannot be recovered!
          </p>
        </Alert>

        <div className="pt-4 flex items-center gap-4">
          <Button
            variant={'outline'}
            title="Copy recovery phrase to the clipboard"
            onClick={() => props.onCopy()}
            type="button"
          >
            Copy Recovery Kit
            <FaCopy />
          </Button>
          <Button variant="primary" onClick={() => props.onDownload()} type="button">
            Download Recovery Kit <FaFileDownload />
          </Button>
        </div>
      </div>
    </div>
  )
}
