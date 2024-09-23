import clsx from 'clsx'
import React, { forwardRef } from 'react'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string
  setValue: (value: string) => void
  label?: string
  placeholder?: string
}

// Use forwardRef to allow refs to be passed to the component
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>((props, ref) => {
  const { value, setValue, label } = props

  return (
    <div className="space-y-2 w-full">
      {label && (
        <label className="block text-neutral-500 text-sm mb-2" htmlFor={props.id}>
          {label}
          {props.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
        <textarea
          {...props}
          ref={ref} // Attach the forwarded ref here
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={clsx(
            'custom w-full text-zinc-800 dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md resize-none', // Added 'resize-none' to prevent resizing
            props.readOnly || props.disabled ? 'opacity-60' : ''
          )}
        />
      </div>
    </div>
  )
})

// Provide a display name for better debugging in React DevTools
Textarea.displayName = 'Textarea'
