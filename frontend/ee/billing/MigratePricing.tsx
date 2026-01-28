import { useRef, useContext } from 'react'
import GenericDialog from '@/components/common/GenericDialog'
import { useMutation, useQuery } from '@apollo/client'
import { MigratePricingOp as MigratePricing } from '@/graphql/mutations/billing/migratePricing.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { FaExchangeAlt, FaExternalLinkAlt } from 'react-icons/fa'
import { Alert } from '@/components/common/Alert'
import { GetStripeSubscriptionEstimate } from '@/graphql/queries/billing/getSubscriptionPrice.gql'
import { GetSubscriptionDetails } from '@/graphql/queries/billing/getSubscriptionDetails.gql'
import { PlanTypeEnum, BillingPeriodEnum, ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'

export const MigratePricingDialog = (props: { title?: string; buttonText?: string }) => {
  const { title = 'Switch to new pricing', buttonText = 'Switch to new pricing' } = props
  const { activeOrganisation } = useContext(organisationContext)
  const [migratePricing, { loading: migrationLoading }] = useMutation(MigratePricing)
  const dialogRef = useRef<any>(null)

  const { data: subData, loading: subLoading } = useQuery(GetSubscriptionDetails, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !activeOrganisation || activeOrganisation.plan === 'FR',
  })

  const planType = subData?.stripeSubscriptionDetails?.planType || PlanTypeEnum.Pro
  const planChoice =
    planType === PlanTypeEnum.Enterprise
      ? ApiOrganisationPlanChoices.En
      : ApiOrganisationPlanChoices.Pr

  const billingPeriod =
    subData?.stripeSubscriptionDetails?.billingPeriod || BillingPeriodEnum.Monthly

  const { data: v1Data, loading: v1Loading } = useQuery(GetStripeSubscriptionEstimate, {
    variables: {
      organisationId: activeOrganisation?.id,
      planType,
      billingPeriod,
      previewV2: false,
    },
    skip: !activeOrganisation,
    fetchPolicy: 'cache-and-network',
  })

  const { data: v2Data, loading: v2Loading } = useQuery(GetStripeSubscriptionEstimate, {
    variables: {
      organisationId: activeOrganisation?.id,
      planType,
      billingPeriod,
      previewV2: true,
    },
    skip: !activeOrganisation,
    fetchPolicy: 'cache-and-network',
  })

  const isLoading = subLoading || v1Loading || v2Loading

  // Only show for V1 pricing orgs
  if (activeOrganisation?.pricingVersion !== 1) return null

  const handleMigration = async () => {
    try {
      const { data } = await migratePricing({
        variables: {
          organisationId: activeOrganisation.id,
        },
        refetchQueries: [
          { query: GetOrganisations },
          { query: GetSubscriptionDetails, variables: { organisationId: activeOrganisation.id } },
          {
            query: GetStripeSubscriptionEstimate,
            variables: {
              organisationId: activeOrganisation.id,
              planType,
              billingPeriod,
              previewV2: false,
            },
          },
          {
            query: GetStripeSubscriptionEstimate,
            variables: {
              organisationId: activeOrganisation.id,
              planType,
              billingPeriod,
              previewV2: true,
            },
          },
        ],
      })

      if (data?.migratePricing?.success) {
        toast.success('Successfully migrated to new pricing model')
        dialogRef.current?.closeModal()
      } else {
        toast.error(data?.migratePricing?.message || 'Migration failed')
      }
    } catch (error) {
      toast.error('An error occurred during migration')
    }
  }

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount)
  }

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        title={title}
        buttonVariant="primary"
        buttonContent={
          <div className="flex items-center gap-2">
            <FaExchangeAlt /> {buttonText}
          </div>
        }
      >
        <div className="space-y-4 pt-4">
          <p className="text-zinc-600 dark:text-zinc-400 text-sm">
            Your organisation is currently on the old pricing model. We have updated our pricing to
            a simpler, linear model with a flat price for user accounts only. You can choose to
            remain on the old pricing model, or switch to the new pricing.
          </p>
          <p className="text-zinc-600 dark:text-zinc-400 text-sm">
            Here is a preview of your expected billing structure on the new pricing model. Please
            see the{' '}
            <a
              href="https://phase.dev/pricing"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-500 hover:text-emerald-400 font-medium underline inline-flex items-center gap-1"
            >
              pricing page <FaExternalLinkAlt className="text-xs" />
            </a>{' '}
            for more details.
          </p>

          {!isLoading && v1Data && v2Data && (
            <div className="grid grid-cols-2 gap-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <div className="space-y-1">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                  Current <PlanLabel plan={planChoice} />
                </h3>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {v1Data.estimateStripeSubscription.seatCount} seat
                  {v1Data.estimateStripeSubscription.seatCount !== 1 && 's'}
                </div>
                <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(
                    v1Data.estimateStripeSubscription.estimatedTotal,
                    v1Data.estimateStripeSubscription.currency
                  )}
                  <span className="text-sm font-normal text-zinc-500 ml-1">
                    /{billingPeriod === BillingPeriodEnum.Monthly ? 'mo' : 'yr'}
                  </span>
                </div>
              </div>

              <div className="space-y-1 border-l border-zinc-200 dark:border-zinc-700 pl-4">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                  New <PlanLabel plan={planChoice} />
                </h3>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {v2Data.estimateStripeSubscription.seatCount} seat
                  {v2Data.estimateStripeSubscription.seatCount !== 1 && 's'}
                  {v2Data.estimateStripeSubscription.seatCount <
                    v1Data.estimateStripeSubscription.seatCount && (
                    <span className="text-emerald-600 dark:text-emerald-400 ml-2 text-xs">
                      (User accounts only)
                    </span>
                  )}
                </div>
                <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(
                    v2Data.estimateStripeSubscription.estimatedTotal,
                    v2Data.estimateStripeSubscription.currency
                  )}
                  <span className="text-sm font-normal text-zinc-500 ml-1">
                    /{billingPeriod === BillingPeriodEnum.Monthly ? 'mo' : 'yr'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <ul className="list-disc list-inside  text-zinc-600 dark:text-zinc-400 ml-2 text-sm">
            <li>Your organisation will be switched to new per-user pricing</li>
            <li>Service Accounts will not be billed</li>
            <li>This action is permanent</li>
          </ul>

          <Alert variant="info" icon size="sm">
            This action cannot be undone
          </Alert>

          <div className="pt-4 flex justify-end gap-2">
            <Button variant="primary" isLoading={migrationLoading} onClick={handleMigration}>
              <FaExchangeAlt />
              Switch to new pricing
            </Button>
          </div>
        </div>
      </GenericDialog>
    </>
  )
}
