'use client'

import { Button } from '@/components/common/Button'
import { SIDEBAR_WIDTH } from '@/components/layout/SidebarResizeHandle'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { Popover, Transition } from '@headlessui/react'
import Link from 'next/link'
import { Fragment, useContext, useState } from 'react'
import { FaArrowRight, FaExclamationTriangle, FaExternalLinkAlt, FaTimes } from 'react-icons/fa'
import { BILLING_ISSUE_MESSAGES, BillingIssue, useBillingIssue } from './billingIssue'

export type BillingIssueNoticeState = { issue: BillingIssue | null; dismiss: () => void }

/** The active organisation's billing issue, until dismissed. It polls, so call it once. */
export const useBillingIssueNotice = (): BillingIssueNoticeState => {
  const { activeOrganisation } = useContext(organisationContext)
  const issue = useBillingIssue({ poll: true })
  // In memory only: back on every page load, and for another org or a new issue.
  const [dismissed, setDismissed] = useState<string | null>(null)

  const key = issue && activeOrganisation ? `${activeOrganisation.id}:${issue.status}` : null
  return {
    issue: key !== null && dismissed !== key ? issue : null,
    dismiss: () => setDismissed(key),
  }
}

// The standard link Button. White like the card's text, so the underline marks it as a link
const ACTION_STYLE =
  '!text-white underline decoration-white/40 underline-offset-2 hover:decoration-white'

// Flat red, like the toasts
export const BillingIssueCard = ({
  issue,
  onDismiss,
  onAction,
}: {
  issue: BillingIssue
  onDismiss: () => void
  onAction?: () => void
}) => {
  const { activeOrganisation } = useContext(organisationContext)
  const canResolve = userHasPermission(activeOrganisation?.role?.permissions, 'Billing', 'update')
  const { title, detail } = BILLING_ISSUE_MESSAGES[issue.status]

  return (
    <div role="alert" className="rounded-lg bg-red-600 p-3 text-white shadow-sm dark:bg-red-700">
      <div className="flex items-start gap-2">
        <FaExclamationTriangle className="mt-1 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs/5 font-semibold">{title}</p>
          <p className="mt-0.5 text-2xs/4 text-white/90">
            {detail}
            {!canResolve && ' Contact your organisation admin to resolve this issue.'}
          </p>
          {canResolve && (
            <div className="mt-1.5">
              {issue.invoiceUrl ? (
                <Button
                  variant="text"
                  classString={ACTION_STYLE}
                  icon={FaExternalLinkAlt}
                  onClick={() => {
                    window.open(issue.invoiceUrl!, '_blank', 'noopener,noreferrer')
                    onAction?.()
                  }}
                >
                  Pay invoice
                </Button>
              ) : (
                <Link
                  href={`/${activeOrganisation?.name}/settings?tab=organisation`}
                  onClick={onAction}
                >
                  <Button
                    variant="text"
                    classString={ACTION_STYLE}
                    icon={FaArrowRight}
                    iconPosition="right"
                  >
                    Go to billing
                  </Button>
                </Link>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="-mr-1 -mt-1 shrink-0 rounded-full p-1 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
        >
          <FaTimes className="size-3" />
        </button>
      </div>
    </div>
  )
}

/** Above the sidebar's footer. The icon rail shows an icon that opens the card beside it. */
export const SidebarBillingIssue = ({
  notice: { issue, dismiss },
  collapsed,
  animating,
  tooltipClassName,
}: {
  notice: BillingIssueNoticeState
  collapsed: boolean
  animating: boolean
  tooltipClassName: string
}) => {
  if (!issue) return null

  if (!collapsed)
    return (
      // Kept at the expanded width and clipped, so the text doesn't reflow while the sidebar opens
      <div className="shrink-0 overflow-hidden px-3 pb-3">
        <div style={{ width: `calc(${SIDEBAR_WIDTH} - 1.5rem)` }}>
          <BillingIssueCard issue={issue} onDismiss={dismiss} />
        </div>
      </div>
    )

  const { title } = BILLING_ISSUE_MESSAGES[issue.status]
  return (
    <div className="shrink-0 px-3 pb-3">
      <Popover className="group/item relative w-10">
        {({ open }) => (
          <>
            <Popover.Button
              aria-label={title}
              className="flex h-9 w-10 items-center justify-center rounded-lg bg-red-600 text-white outline-none transition-colors hover:bg-red-500 data-[focus]:ring-2 data-[focus]:ring-neutral-500 dark:bg-red-700 dark:hover:bg-red-600"
            >
              <FaExclamationTriangle className="size-3.5" />
            </Popover.Button>
            {!animating && !open && <div className={tooltipClassName}>{title}</div>}
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              {/* Beside the rail, like the footer menus */}
              <Popover.Panel className="absolute bottom-0 left-full z-20 ml-4 w-60 origin-bottom-left rounded-lg shadow-2xl">
                {({ close }) => (
                  <BillingIssueCard
                    issue={issue}
                    onDismiss={() => {
                      close()
                      dismiss()
                    }}
                    onAction={close}
                  />
                )}
              </Popover.Panel>
            </Transition>
          </>
        )}
      </Popover>
    </div>
  )
}
