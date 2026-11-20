'use client'

import Link from 'next/link'

import { generateBreadcrumbs } from '@/utils/navigation'

import { OrgSwitcher } from './OrgSwitcher'
import { useNavigationContext } from './PageTitle'

// TEMPORARY (utils/shellExperiment.ts): only the `breadcrumbs` variant renders this
// The trail for the current route, with the organisation switcher beside its first crumb
export const Breadcrumbs = () => {
  const breadcrumbs = generateBreadcrumbs(useNavigationContext())

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 overflow-hidden px-3 text-xs font-medium text-neutral-500 sm:px-4 lg:px-6">
      {breadcrumbs.map((crumb, index) => (
        <div key={index} className="flex min-w-0 items-center gap-2">
          {index > 0 && <span className="shrink-0">/</span>}
          {crumb.isLink && crumb.href ? (
            <Link
              href={crumb.href}
              title={crumb.label}
              className="capitalize overflow-hidden text-ellipsis whitespace-nowrap max-w-[12rem] text-zinc-600 dark:text-zinc-400"
            >
              {crumb.label}
            </Link>
          ) : (
            <span
              title={crumb.label}
              className="capitalize text-zinc-900 dark:text-zinc-100 overflow-hidden text-ellipsis whitespace-nowrap max-w-[12rem]"
            >
              {crumb.label}
            </span>
          )}
          {index === 0 && <OrgSwitcher />}
        </div>
      ))}
    </div>
  )
}
