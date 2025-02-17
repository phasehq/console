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

      <textarea
        {...props}
        ref={ref} // Attach the forwarded ref here
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={clsx(
          'w-full',
          props.readOnly || props.disabled ? 'opacity-60' : '',
          props.className
        )}
      />
    </div>
  )
})

// Provide a display name for better debugging in React DevTools
Textarea.displayName = 'Textarea'
