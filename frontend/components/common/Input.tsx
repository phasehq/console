import clsx from 'clsx'
import { useState } from 'react'
import { FaEyeSlash, FaEye } from 'react-icons/fa'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string
  setValue: (value: string) => void
  label: string
  placeholder?: string
  secret?: boolean
}

export const Input = (props: InputProps) => {
  const { value, setValue, label, secret } = props

  const [showValue, setShowValue] = useState<boolean>(false)

  return (
    <div className="space-y-2 w-full">
      <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="accountId">
        {label}
        {props.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40  focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
        <input
          {...props}
          type={showValue || !secret ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={clsx(
            'custom w-full text-zinc-800 dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md',
            secret ? 'ph-no-capture' : ''
          )}
        />
        {secret && (
          <button
            className="bg-zinc-100 dark:bg-zinc-800 px-4 text-neutral-500 rounded-md"
            type="button"
            onClick={() => setShowValue(!showValue)}
            tabIndex={-1}
          >
            {showValue ? <FaEyeSlash /> : <FaEye />}
          </button>
        )}
      </div>
    </div>
  )
}
