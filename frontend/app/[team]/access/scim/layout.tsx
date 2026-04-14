'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'

const tabs = [
  { name: 'Home', segment: '' },
  { name: 'Connections', segment: 'connections' },
  { name: 'Logs', segment: 'logs' },
]

export default function SCIMLayout({ children, params }: { children: React.ReactNode; params: { team: string } }) {
  const pathname = usePathname()
  // pathname: /<team>/access/scim or /<team>/access/scim/connections or /<team>/access/scim/logs
  const segments = pathname?.split('/') || []
  // segments[4] is the sub-segment after "scim"
  const activeSegment = segments[4] || ''

  return (
    <div className="w-full">
      <nav className="flex gap-2 border-b border-neutral-500/20 px-3 sm:px-4 lg:px-6 mb-4">
        {tabs.map((tab) => {
          const isActive = activeSegment === tab.segment
          const href = tab.segment
            ? `/${params.team}/access/scim/${tab.segment}`
            : `/${params.team}/access/scim`
          return (
            <Link
              key={tab.name}
              href={href}
              className={clsx(
                'p-2 text-xs font-medium border-b -mb-px focus:outline-none transition ease',
                isActive
                  ? 'border-emerald-500 font-semibold text-zinc-900 dark:text-zinc-100'
                  : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              )}
            >
              {tab.name}
            </Link>
          )
        })}
      </nav>
      {children}
    </div>
  )
}
