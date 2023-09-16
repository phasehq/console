import clsx from 'clsx'
import { MdCheck } from 'react-icons/md'

interface AccountSeedCheckProps {
  mnemonic: string
  inputs: string[]
  required: boolean
  updateInputs: (newValue: string, index: number) => void
}

export const AccountSeedChecker = (props: AccountSeedCheckProps) => {
  const { inputs, updateInputs, required } = props

  const mnemonicWords = props.mnemonic.split(' ')

  const isCorrect = (index: number) =>
    props.mnemonic ? inputs[index] === mnemonicWords[index] : false

  return (
    <div className="grid grid-cols-6 gap-4">
      {[...Array(inputs.length)].map((n, index) => (
        <div key={index} className="relative">
          <input
            placeholder={String(index + 1)}
            value={inputs[index]}
            onChange={(e) => updateInputs(e.target.value, index)}
            required={required}
            type={isCorrect(index) ? 'password' : 'text'}
            readOnly={isCorrect(index) ? true : false}
            //maxLength={25}
            className={clsx(
              'font-mono w-full',
              isCorrect(index) && '!bg-emerald-400/20 !text-emerald-500'
            )}
          />
          {isCorrect(index) && (
            <MdCheck className="absolute pointer-events-none text-emerald-500/20 right-2 top-3" />
          )}
        </div>
      ))}
    </div>
  )
}
