import React from 'react'
import clsx from 'clsx'
import { FaCheck, FaInfo } from 'react-icons/fa'

interface ProgressBarProps {
  percentage?: number // Optional, defaults to 0
  color?: string // Optional, defaults to a specific color class
  isStrong?: boolean // Optional, used to determine the icon
  message?: string // Optional, message to display
  size?: 'sm' | 'md' | 'lg'
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  percentage = 0,
  color = 'bg-blue-500',
  isStrong = false,
  message = '',
  size,
}) => {
  const height = () => {
    if (!size || size === 'md') return 'h-2'
    else if (size === 'sm') return 'h-1'
    else return 'h-4'
  }

  return (
    <div>
      <div className={clsx('w-full bg-neutral-300 dark:bg-neutral-600 rounded-sm', height())}>
        <div
          className={clsx(color, 'transition-all ease float-left rounded-sm', height())}
          style={{
            width: `${percentage}%`,
          }}
        ></div>
      </div>

      {message && (
        <div className="flex w-full items-center gap-4 p-2 bg-zinc-200 dark:bg-zinc-800 dark:bg-opacity-60 rounded-b-md text-neutral-500 text-sm">
          {isStrong ? <FaCheck /> : <FaInfo />}
          <span>{message}</span>
        </div>
      )}
    </div>
  )
}

export default ProgressBar
