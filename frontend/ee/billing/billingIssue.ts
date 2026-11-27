import { BillingIssueEnum, GetOrganisationBillingIssueQuery } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { GetOrganisationBillingIssue } from '@/graphql/queries/billing/getOrganisationBillingIssue.gql'
import { isCloudHosted } from '@/utils/appConfig'
import { useQuery } from '@apollo/client'
import { useContext } from 'react'

export type BillingIssue = NonNullable<GetOrganisationBillingIssueQuery['organisationBillingIssue']>

// Stripe resolves subscription status from all invoices, so either status can come from any
// unpaid invoice, not only the latest, and the fix is the same: pay it
const OVERDUE = {
  title: 'Payment overdue',
  detail: "An invoice for this organisation's subscription hasn't been paid.",
}

export const BILLING_ISSUE_MESSAGES: Record<BillingIssueEnum, { title: string; detail: string }> = {
  [BillingIssueEnum.PastDue]: OVERDUE,
  [BillingIssueEnum.Unpaid]: OVERDUE,
  [BillingIssueEnum.Incomplete]: {
    title: 'Payment incomplete',
    detail: "The first payment for this organisation's subscription hasn't gone through.",
  },
  [BillingIssueEnum.Paused]: {
    title: 'Subscription paused',
    detail: "This organisation's subscription is paused because a payment hasn't been made.",
  },
}

const POLL_INTERVAL = 60_000

/** The active organisation's billing issue on Phase Cloud, or null. */
export const useBillingIssue = ({ poll = false } = {}): BillingIssue | null => {
  const { activeOrganisation } = useContext(organisationContext)

  const { data } = useQuery<GetOrganisationBillingIssueQuery>(GetOrganisationBillingIssue, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !isCloudHosted() || !activeOrganisation,
    pollInterval: poll ? POLL_INTERVAL : undefined,
    // A background check: errors aren't actionable, so never toast them.
    context: { suppressGlobalErrorToast: true },
  })

  return data?.organisationBillingIssue ?? null
}
