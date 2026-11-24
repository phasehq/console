import { BillingIssueEnum, GetOrganisationBillingIssueQuery } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { GetOrganisationBillingIssue } from '@/graphql/queries/billing/getOrganisationBillingIssue.gql'
import { isCloudHosted } from '@/utils/appConfig'
import { useQuery } from '@apollo/client'
import { useContext } from 'react'

export type BillingIssue = NonNullable<GetOrganisationBillingIssueQuery['organisationBillingIssue']>

export const BILLING_ISSUE_MESSAGES: Record<BillingIssueEnum, { title: string; detail: string }> = {
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
