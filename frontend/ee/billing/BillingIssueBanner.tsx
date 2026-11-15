'use client'

import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import Link from 'next/link'
import { useContext, useLayoutEffect, useRef, useState } from 'react'
import { FaArrowRight, FaExclamationTriangle, FaExternalLinkAlt, FaTimes } from 'react-icons/fa'
import { BILLING_ISSUE_MESSAGES, BillingIssue, useBillingIssue } from './billingIssue'

const CTA_STYLE =
  'inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-0.5 font-medium text-red-700 transition-colors hover:bg-red-50'

const Banner = ({ issue, onDismiss }: { issue: BillingIssue; onDismiss: () => void }) => {
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
  const { title, detail } = BILLING_ISSUE_MESSAGES[issue.status]

  return (
    <div
      ref={bannerRef}
      role="alert"
      className="fixed inset-x-0 bottom-[var(--mobile-tabbar-height)] z-10 flex min-h-9 items-center gap-3 bg-red-600 py-1.5 pl-4 pr-2 text-2xs text-white shadow-lg dark:bg-red-700 sm:text-xs/5"
    >
      <FaExclamationTriangle className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{title}.</span>
        <span className="max-sm:hidden"> {detail}</span>
        {!canResolve && ' Contact your organisation admin to resolve this issue.'}
      </p>
      {canResolve &&
        (issue.invoiceUrl ? (
          <a
            href={issue.invoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={CTA_STYLE}
          >
            Pay invoice
            <FaExternalLinkAlt className="size-2.5 shrink-0" />
          </a>
        ) : (
          <Link
            href={`/${activeOrganisation?.name}/settings?tab=organisation`}
            className={CTA_STYLE}
          >
            Go to billing
            <FaArrowRight className="size-3 shrink-0" />
          </Link>
        ))}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
        className="shrink-0 rounded-full p-1 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
      >
        <FaTimes className="size-3.5" />
      </button>
    </div>
  )
}

export const BillingIssueBanner = () => {
  const { activeOrganisation } = useContext(organisationContext)
  const issue = useBillingIssue({ poll: true })
  // In memory only: back on every page load, and for another org or a new issue.
  const [dismissed, setDismissed] = useState<string | null>(null)

  if (!issue || !activeOrganisation) return null
  const key = `${activeOrganisation.id}:${issue.status}`
  if (dismissed === key) return null

  return <Banner issue={issue} onDismiss={() => setDismissed(key)} />
}
