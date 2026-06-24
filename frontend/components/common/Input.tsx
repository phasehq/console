import clsx from 'clsx'
import React, { useState, forwardRef } from 'react'
import { FaEyeSlash, FaEye } from 'react-icons/fa'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string
  setValue: (value: string) => void
  label?: string
  placeholder?: string
  secret?: boolean
  labelClassName?: string
}

// Use forwardRef to allow refs to be passed to the component
export const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => {
  const { value, setValue, label, secret, labelClassName, ...restProps } = props

  const [showValue, setShowValue] = useState<boolean>(false)

  return (
    <div className="space-y-2 w-full">
      {label && (
        <label
          className={clsx('block text-neutral-500 text-xs mb-2', labelClassName)}
          htmlFor={restProps.id}
        >
          {label}
          {restProps.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40  focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
        <input
          {...restProps}
          ref={ref}
          type={showValue || !secret ? restProps.type || 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={clsx(
            'custom w-full text-zinc-800 dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md',
            secret ? 'ph-no-capture' : '',
            restProps.readOnly || restProps.disabled ? 'opacity-60 cursor-not-allowed' : '',
            restProps.className
          )}
        />
        {secret && (
          <button
            className="bg-zinc-100 dark:bg-zinc-800 px-3 text-neutral-500 rounded-md"
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
})

// Provide a display name for better debugging in React DevTools
Input.displayName = 'Input'
