import { useRef, useContext } from 'react'
import GenericDialog from '@/components/common/GenericDialog'
import { useMutation, useQuery } from '@apollo/client'
import { MigratePricing } from '@/graphql/mutations/billing/migratePricing.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { FaExchangeAlt, FaExternalLinkAlt } from 'react-icons/fa'
import { Alert } from '@/components/common/Alert'
import { GetStripeSubscriptionEstimate } from '@/graphql/queries/billing/getSubscriptionPrice.gql'
import { GetSubscriptionDetails } from '@/graphql/queries/billing/getSubscriptionDetails.gql'
import { PlanTypeEnum, BillingPeriodEnum } from '@/apollo/graphql'

export const MigratePricingDialog = () => {
  const { activeOrganisation } = useContext(organisationContext)
  const [migratePricing, { loading: migrationLoading }] = useMutation(MigratePricing)
  const dialogRef = useRef<any>(null)

  const { data: subData, loading: subLoading } = useQuery(GetSubscriptionDetails, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !activeOrganisation || activeOrganisation.plan === 'FR',
  })

  const planType = subData?.stripeSubscriptionDetails?.planType || PlanTypeEnum.Pro
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
  })

  const { data: v2Data, loading: v2Loading } = useQuery(GetStripeSubscriptionEstimate, {
    variables: {
      organisationId: activeOrganisation?.id,
      planType,
      billingPeriod,
      previewV2: true,
    },
    skip: !activeOrganisation,
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
        refetchQueries: [{ query: GetOrganisations }],
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
        title="Migrate Pricing Model"
        buttonVariant="primary"
        buttonContent={
          <div className="flex items-center gap-2">
            <FaExchangeAlt /> Migrate Pricing
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-zinc-600 dark:text-zinc-400 text-sm">
            We have updated our pricing to a simpler, linear model with a flat pricing structure.
            Migrating will switch your organization to the new pricing structure. You can learn more
            on our{' '}
            <a
              href="https://phase.dev/pricing"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-500 hover:text-emerald-400 font-medium underline inline-flex items-center gap-1"
            >
              pricing page <FaExternalLinkAlt className="text-xs" />
            </a>
            .
          </p>

          {!isLoading && v1Data && v2Data && (
            <div className="grid grid-cols-2 gap-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <div className="space-y-1">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Current (Legacy)
                </h3>
                <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(
                    v1Data.estimateStripeSubscription.estimatedTotal,
                    v1Data.estimateStripeSubscription.currency
                  )}
                  <span className="text-sm font-normal text-zinc-500 ml-1">
                    /{billingPeriod === BillingPeriodEnum.Monthly ? 'mo' : 'yr'}
                  </span>
                </div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {v1Data.estimateStripeSubscription.seatCount} seats
                </div>
                <div className="text-xs text-zinc-500">Graduated pricing</div>
              </div>

              <div className="space-y-1 border-l border-zinc-200 dark:border-zinc-700 pl-4">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  New (v2)
                </h3>
                <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(
                    v2Data.estimateStripeSubscription.estimatedTotal,
                    v2Data.estimateStripeSubscription.currency
                  )}
                  <span className="text-sm font-normal text-zinc-500 ml-1">
                    /{billingPeriod === BillingPeriodEnum.Monthly ? 'mo' : 'yr'}
                  </span>
                </div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {v2Data.estimateStripeSubscription.seatCount} seats
                </div>
                <div className="text-xs text-zinc-500">
                  Linear pricing
                  {v2Data.estimateStripeSubscription.seatCount <
                    v1Data.estimateStripeSubscription.seatCount && (
                    <span className="block text-emerald-600 dark:text-emerald-400 mt-1">
                      (Service accounts excluded)
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          <ul className="list-disc list-inside space-y-2 text-zinc-600 dark:text-zinc-400 ml-2 text-sm">
            <li>Your organisation will be switched to a flat-price, per-user billing model</li>
            <li>Service Accounts are no longer counted as billable seats</li>
            <li>New per-user prices will apply. Please see our pricing page for more details.</li>
          </ul>

          <Alert variant="warning" icon size="sm">
            This action cannot be undone
          </Alert>

          <div className="pt-4 flex justify-end gap-2">
            <Button variant="primary" isLoading={migrationLoading} onClick={handleMigration}>
              <FaExchangeAlt />
              Confirm Migration
            </Button>
          </div>
        </div>
      </GenericDialog>
    </>
  )
}
