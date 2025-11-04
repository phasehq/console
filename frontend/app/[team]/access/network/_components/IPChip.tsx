import clsx from 'clsx'
import { ReactNode } from 'react'

export const IPChip = ({ ip, children }: { ip: string; children?: ReactNode }) => {
  const isCidr = ip.includes('/')
  return (
    <div
      key={ip}
      className={clsx(
        'flex items-center px-2 py-1 rounded-full ring-1 ring-inset text-xs font-medium font-mono ',
        isCidr
          ? 'bg-indigo-200 dark:bg-indigo-400/20 ring-indigo-400/40 text-indigo-800 dark:text-indigo-200'
          : 'bg-sky-200 dark:bg-sky-400/20 ring-sky-400/40 text-sky-800 dark:text-sky-200'
      )}
    >
      {ip}
      {children}
    </div>
  )
}
