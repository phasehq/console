'use client'

import { useContext } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { FaUsersCog } from 'react-icons/fa'
import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { EmptyState } from '@/components/common/EmptyState'
import { UpsellDialog } from '@/components/settings/organisation/UpsellDialog'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'
import { organisationContext } from '@/contexts/organisationContext'

const tabs = [
  { name: 'Home', segment: '' },
  { name: 'Connections', segment: 'connections' },
  { name: 'Logs', segment: 'logs' },
]

export default function SCIMLayout({ children, params }: { children: React.ReactNode; params: { team: string } }) {
  const pathname = usePathname()
  const { activeOrganisation: organisation } = useContext(organisationContext)
  // pathname: /<team>/access/scim or /<team>/access/scim/connections or /<team>/access/scim/logs
  const segments = pathname?.split('/') || []
  // segments[4] is the sub-segment after "scim"
  const activeSegment = segments[4] || ''

  if (organisation && organisation.plan !== ApiOrganisationPlanChoices.En) {
    return (
      <section className="px-3 sm:px-4 lg:px-6">
        <div className="w-full space-y-6 text-zinc-900 dark:text-zinc-100">
          <div>
            <h2 className="text-base font-medium">SCIM Provisioning</h2>
            <p className="text-neutral-500 text-sm">
              Manage SCIM tokens for automatic user and group provisioning from your identity
              provider.
            </p>
          </div>
          <EmptyState
            title="SCIM provisioning is available on the Enterprise tier"
            subtitle="Upgrade your organisation to enable automatic user and group provisioning from your identity provider."
            graphic={
              <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                <FaUsersCog />
              </div>
            }
          >
            <div className="pt-2">
              <UpsellDialog
                title="Upgrade to Enterprise to enable SCIM provisioning"
                targetPlan={ApiOrganisationPlanChoices.En}
                buttonLabel={
                  <span className="flex items-center gap-2">
                    Upgrade
                    <PlanLabel plan={ApiOrganisationPlanChoices.En} />
                  </span>
                }
              />
            </div>
          </EmptyState>
        </div>
      </section>
    )
  }

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
