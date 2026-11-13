'use client'

import { BillingIssueEnum } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { GetOrganisationBillingIssue } from '@/graphql/queries/billing/getOrganisationBillingIssue.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { isCloudHosted } from '@/utils/appConfig'
import { useQuery } from '@apollo/client'
import Link from 'next/link'
import { useContext, useLayoutEffect, useRef } from 'react'
import { FaArrowRight, FaExclamationTriangle } from 'react-icons/fa'

const POLL_INTERVAL = 60_000

const ISSUE_MESSAGES: Record<BillingIssueEnum, { title: string; detail: string }> = {
  [BillingIssueEnum.PastDue]: {
    title: 'Payment failed',
    detail: "The latest payment for this organisation's subscription didn't go through.",
  },
  [BillingIssueEnum.Unpaid]: {
    title: 'Payment overdue',
    detail: "This organisation's subscription has an unpaid invoice.",
  },
  [BillingIssueEnum.Incomplete]: {
    title: 'Payment incomplete',
    detail: "The first payment for this organisation's subscription hasn't gone through.",
  },
  [BillingIssueEnum.Paused]: {
    title: 'Subscription paused',
    detail: "This organisation's subscription is paused because there's no payment method.",
  },
}

const Banner = ({ issue }: { issue: BillingIssueEnum }) => {
  const { activeOrganisation } = useContext(organisationContext)
  const bannerRef = useRef<HTMLDivElement>(null)

  // Page layouts subtract this from their height, so the banner never covers content.
  useLayoutEffect(() => {
    const banner = bannerRef.current
    if (!banner) return
    const root = document.documentElement
    const observer = new ResizeObserver(() =>
      root.style.setProperty('--bottom-banner-height', `${banner.offsetHeight}px`)
    )
    observer.observe(banner)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--bottom-banner-height')
    }
  }, [])

  const canResolve = userHasPermission(activeOrganisation?.role?.permissions, 'Billing', 'update')
  const { title, detail } = ISSUE_MESSAGES[issue]

  return (
    <div
      ref={bannerRef}
      role="alert"
      className="fixed inset-x-0 bottom-[var(--mobile-tabbar-height)] z-10 flex min-h-14 items-center gap-x-4 gap-y-2 bg-red-600 px-4 py-2 text-xs text-white shadow-lg dark:bg-red-700 max-sm:flex-wrap"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 max-sm:basis-full">
        <FaExclamationTriangle className="size-4 shrink-0" />
        <p className="leading-5">
          <span className="font-semibold">{title}.</span> {detail}
          {!canResolve && ' Contact your organisation admin to resolve this issue.'}
        </p>
      </div>
      {canResolve && (
        <Link
          href={`/${activeOrganisation?.name}/settings?tab=organisation`}
          className="ml-7 inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1 font-medium text-red-700 transition-colors hover:bg-red-50 sm:ml-0"
        >
          Go to billing
          <FaArrowRight className="size-3.5 shrink-0" />
        </Link>
      )}
    </div>
  )
}

export const BillingIssueBanner = () => {
  const { activeOrganisation } = useContext(organisationContext)

  const { data } = useQuery(GetOrganisationBillingIssue, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !isCloudHosted() || !activeOrganisation,
    pollInterval: POLL_INTERVAL,
    // A background check: errors aren't actionable, so never toast them.
    context: { suppressGlobalErrorToast: true },
  })

  const issue = data?.organisationBillingIssue
  return issue ? <Banner issue={issue} /> : null
}
