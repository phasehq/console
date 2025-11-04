import {
  ApiOrganisationPlanChoices,
  BillingPeriodEnum,
  PlanTypeEnum,
  StripeSubscriptionDetails,
} from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'
import { organisationContext } from '@/contexts/organisationContext'
import { GetSubscriptionDetails } from '@/graphql/queries/billing/getSubscriptionDetails.gql'
import { ModifyStripeSubscription } from '@/graphql/mutations/billing/modifySubscription.gql'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { useMutation, useQuery } from '@apollo/client'
import { useContext, useEffect, useRef, useState } from 'react'
import { FaCheck, FaCircle, FaCog } from 'react-icons/fa'
import { toast } from 'react-toastify'
import clsx from 'clsx'

export const ModifySubscriptionDialog = () => {
  const { activeOrganisation } = useContext(organisationContext)

  const [modifySubscription] = useMutation(ModifyStripeSubscription)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  // Permission checks
  const userCanReadBilling = activeOrganisation
    ? userHasPermission(activeOrganisation.role?.permissions, 'Billing', 'read')
    : false

  const userCanUpdateBilling = activeOrganisation
    ? userHasPermission(activeOrganisation.role?.permissions, 'Billing', 'update')
    : false

  const { data, loading } = useQuery(GetSubscriptionDetails, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !activeOrganisation || !userCanReadBilling,
  })

  const subscriptionData: StripeSubscriptionDetails | undefined =
    data?.stripeSubscriptionDetails ?? undefined

  const [billingPeriod, setBillingPeriod] = useState<BillingPeriodEnum | null>(null)
  const [planType, setPlanType] = useState<PlanTypeEnum | null>(null)

  const toggleBillingPeriod = () =>
    setBillingPeriod((prevState) =>
      prevState === BillingPeriodEnum.Monthly ? BillingPeriodEnum.Yearly : BillingPeriodEnum.Monthly
    )

  useEffect(() => {
    if (subscriptionData) {
      setBillingPeriod(subscriptionData.billingPeriod!)
      setPlanType(subscriptionData.planType!)
    }
  }, [subscriptionData])

  const handleModifySubscription = async () => {
    await modifySubscription({
      variables: {
        organisationId: activeOrganisation?.id,
        subscriptionId: subscriptionData!.subscriptionId,
        billingPeriod,
        planType,
      },
      refetchQueries: [
        { query: GetSubscriptionDetails, variables: { organisationId: activeOrganisation?.id } },
        { query: GetOrganisations },
      ],
    })

    toast.success('Your subscription has been updated!')
    dialogRef.current?.closeModal()
  }

  const currentPlanType: PlanTypeEnum = subscriptionData?.planType!
  const currentBillingPeriod: BillingPeriodEnum = subscriptionData?.billingPeriod!

  const subscriptionChanged = planType !== currentPlanType || billingPeriod !== currentBillingPeriod

  const reset = () => {
    setPlanType(currentPlanType)
    setBillingPeriod(currentBillingPeriod)
  }

  const handleClose = () => {
    reset()
    dialogRef.current?.closeModal()
  }

  const changes = () => (
    <>
      to
      <PlanLabel
        plan={
          planType === PlanTypeEnum.Pro
            ? ApiOrganisationPlanChoices.Pr
            : ApiOrganisationPlanChoices.En
        }
      />
      billed {billingPeriod?.toLowerCase()}
    </>
  )

  if (!userCanReadBilling && !userCanUpdateBilling) return <></>

  return (
    <GenericDialog
      ref={dialogRef}
      buttonContent={
        <>
          <FaCog /> Modify
        </>
      }
      buttonVariant="secondary"
      title="Modify Subscription"
    >
      <div className="space-y-8">
        <div className="text-neutral-500 py-1">
          Modify your subscription plan or billing period. Your organisation is currently on the{' '}
          <PlanLabel plan={activeOrganisation?.plan!} /> plan billed{' '}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {currentBillingPeriod.toLowerCase()}
          </span>
          .
        </div>

        <div className="divide-y divide-neutral-500/20 text-sm">
          <div className="flex justify-between items-center py-4">
            <div className="text-zinc-900 dark:text-zinc-100 font-semibold">Subscription plan</div>
            <div className="flex gap-4">
              <Button
                variant="ghost"
                disabled={planType === PlanTypeEnum.Pro}
                onClick={() => setPlanType(PlanTypeEnum.Pro)}
              >
                {planType === PlanTypeEnum.Pro && <FaCircle className="text-emerald-500" />}
                <PlanLabel plan={ApiOrganisationPlanChoices.Pr} />
              </Button>
              <Button
                variant="ghost"
                disabled={planType === PlanTypeEnum.Enterprise}
                onClick={() => setPlanType(PlanTypeEnum.Enterprise)}
              >
                {planType === PlanTypeEnum.Enterprise && <FaCircle className="text-amber-500" />}
                <PlanLabel plan={ApiOrganisationPlanChoices.En} />
              </Button>
            </div>
          </div>
          <div className="flex justify-between items-center py-4">
            <div className="text-zinc-900 dark:text-zinc-100 font-semibold">Billed</div>
            <div className="flex items-center justify-center gap-4 text-zinc-900 dark:text-zinc-100 text-xs">
              <div
                className={clsx(
                  billingPeriod === BillingPeriodEnum.Monthly
                    ? 'text-zinc-900 dark:text-zinc-100 font-semibold'
                    : 'text-neutral-500'
                )}
              >
                Monthly
              </div>
              <ToggleSwitch
                value={billingPeriod === BillingPeriodEnum.Yearly}
                onToggle={toggleBillingPeriod}
                asBoolean={false}
              />
              <div
                className={clsx(
                  billingPeriod === BillingPeriodEnum.Yearly
                    ? 'text-zinc-900 dark:text-zinc-100 font-semibold'
                    : 'text-neutral-500'
                )}
              >
                Yearly
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Button variant="secondary" onClick={handleClose}>
            Close
          </Button>
          <Button
            onClick={handleModifySubscription}
            disabled={!subscriptionChanged}
            variant="primary"
          >
            {subscriptionChanged && <FaCheck />} Modify subscription{' '}
            {subscriptionChanged && changes()}
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
