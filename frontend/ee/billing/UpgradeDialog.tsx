import { useCallback, useContext, useEffect, useState } from 'react'
import { InitStripeUpgradeCheckout } from '@/graphql/mutations/billing/initUpgradeCheckout.gql'
import { GetSubscriptionDetails } from '@/graphql/queries/billing/getSubscriptionDetails.gql'
import { ModifyStripeSubscription } from '@/graphql/mutations/billing/modifySubscription.gql'
import { EstimateStripeSubscription } from '@/graphql/queries/billing/getSubscriptionPrice.gql'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { useMutation, useQuery } from '@apollo/client'
import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js'
import { organisationContext } from '@/contexts/organisationContext'
import { LogoWordMark } from '@/components/common/LogoWordMark'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'
import {
  ApiOrganisationPlanChoices,
  BillingPeriodEnum,
  PlanTypeEnum,
  StripeSubscriptionDetails,
} from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { FaCartShopping } from 'react-icons/fa6'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import clsx from 'clsx'
import { Tab } from '@headlessui/react'
import { toast } from 'react-toastify'
import { userHasPermission } from '@/utils/access/permissions'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY!)

const UpgradeForm = (props: {
  onSuccess: Function
  planType: PlanTypeEnum
  billingPeriod: BillingPeriodEnum
}) => {
  const { planType, billingPeriod } = props

  const [createCheckoutSession] = useMutation(InitStripeUpgradeCheckout)
  const { activeOrganisation } = useContext(organisationContext)

  const fetchClientSecret = useCallback(async () => {
    // Create a Checkout Session
    const { data } = await createCheckoutSession({
      variables: {
        organisationId: activeOrganisation!.id,
        planType,
        billingPeriod,
      },
    })
    const clientSecret = data.createSubscriptionCheckoutSession.clientSecret

    return clientSecret
  }, [activeOrganisation, billingPeriod, createCheckoutSession])

  const options = { fetchClientSecret }

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  )
}

const UpgradeDialog = (props: { userCount: number; onSuccess: () => void }) => {
  const { activeOrganisation } = useContext(organisationContext)

  const [billingPeriodPreview, setBillingPeriodPreview] = useState<BillingPeriodEnum>(
    BillingPeriodEnum.Yearly
  )
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriodEnum | null>(null)
  const [planType, setPlanType] = useState<PlanTypeEnum>(PlanTypeEnum.Pro)

  const toggleCheckoutPreview = () => {
    billingPeriodPreview === BillingPeriodEnum.Yearly
      ? setBillingPeriodPreview(BillingPeriodEnum.Monthly)
      : setBillingPeriodPreview(BillingPeriodEnum.Yearly)
  }

  useEffect(() => {
    if (activeOrganisation?.plan === ApiOrganisationPlanChoices.Pr)
      setPlanType(PlanTypeEnum.Enterprise)
  }, [activeOrganisation])

  const CheckoutPreview = () => {
    // Permission checks
    const userCanReadBilling = activeOrganisation
      ? userHasPermission(activeOrganisation.role?.permissions, 'Billing', 'read')
      : false

    const [modifySubscription] = useMutation(ModifyStripeSubscription)
    const { data: subscriptionDataQuery } = useQuery(GetSubscriptionDetails, {
      variables: { organisationId: activeOrganisation?.id },
      skip: !activeOrganisation || !userCanReadBilling,
    })

    const { data: estimateData, loading: estimateLoading } = useQuery(EstimateStripeSubscription, {
      variables: {
        organisationId: activeOrganisation?.id!,
        planType,
        billingPeriod: billingPeriodPreview,
      },
      skip: !activeOrganisation,
    })

    const subscriptionData: StripeSubscriptionDetails | undefined =
      subscriptionDataQuery?.stripeSubscriptionDetails ?? undefined

    const estimate = estimateData?.estimateStripeSubscription

    const handleModifySubscription = async () => {
      await modifySubscription({
        variables: {
          organisationId: activeOrganisation?.id,
          subscriptionId: subscriptionData!.subscriptionId,
          billingPeriod: billingPeriodPreview,
          planType,
        },
        refetchQueries: [
          { query: GetSubscriptionDetails, variables: { organisationId: activeOrganisation?.id } },
          { query: GetOrganisations },
        ],
      })

      toast.success('Your subscription has been updated!')
      props.onSuccess()
      //dialogRef.current?.closeModal()
    }

    const handleCheckout = () => {
      if (activeOrganisation?.plan === ApiOrganisationPlanChoices.Fr)
        setBillingPeriod(billingPeriodPreview)
      else handleModifySubscription()
    }

    if (estimateLoading || !estimate)
      return <div className="text-center text-neutral-500 p-40">Loading...</div>

    const monthlyPricePerUser =
      billingPeriodPreview === BillingPeriodEnum.Monthly
        ? estimate.unitPrice
        : estimate.unitPrice / 12

    return (
      <div className="group shadow-xl bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 rounded-lg p-4 space-y-6 transition ease">
        <div className="flex items-start justify-between">
          <div className="text-zinc-900 dark:text-zinc-100">
            <span className="font-extralight text-7xl">${monthlyPricePerUser.toFixed(2)}</span>
            <div className="text-neutral-500">/mo per account</div>
          </div>
          <div>
            <div className="text-neutral-500 text-xs uppercase font-medium">Billed</div>
            <div className="flex items-center justify-center gap-2 text-zinc-900 dark:text-zinc-100 text-xs">
              <div>Monthly</div>
              <ToggleSwitch
                value={billingPeriodPreview === BillingPeriodEnum.Yearly}
                onToggle={toggleCheckoutPreview}
              />
              <div>Yearly</div>
            </div>
          </div>
        </div>

        <div className="bg-zinc-200 dark:bg-zinc-700 p-3 rounded-lg mt-4 text-zinc-900 dark:text-zinc-100 text-xs space-y-1">
          <div className="flex justify-between text-zinc-900 dark:text-zinc-100">
            <span>Avg Unit Price:</span>
            <span>${monthlyPricePerUser.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-zinc-900 dark:text-zinc-100">
            <span>Number of Accounts:</span>
            <span>{estimate.seatCount}</span>
          </div>
          <hr className="my-2 border-zinc-300 dark:border-zinc-600" />
          <div className="flex justify-between font-semibold text-zinc-900 dark:text-zinc-100">
            <span>Total:</span>
            <span>
              $
              {estimate.estimatedTotal.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-emerald-500 font-medium pt-4 justify-end">
          <Button variant="primary" onClick={handleCheckout}>
            <FaCartShopping />{' '}
            {activeOrganisation?.plan === ApiOrganisationPlanChoices.Pr
              ? 'Upgrade'
              : 'Start 14-day trial'}
          </Button>
        </div>
      </div>
    )
  }

  if (billingPeriod === null)
    return (
      <div className="space-y-8">
        <Tab.Group
          selectedIndex={planType === PlanTypeEnum.Pro ? 0 : 1}
          onChange={(index) =>
            setPlanType(index === 0 ? PlanTypeEnum.Pro : PlanTypeEnum.Enterprise)
          }
        >
          <Tab.List className="flex justify-center gap-8 border-b border-neutral-500/40">
            {activeOrganisation?.plan === ApiOrganisationPlanChoices.Fr && (
              <Tab>
                {({ selected }) => (
                  <div
                    className={clsx(
                      'col-span-2 flex items-center justify-center gap-2 transition ease border-b -mb-px',
                      selected
                        ? 'opacity-100 grayscale-0 border-emerald-500'
                        : 'opacity-50 grayscale border-transparent'
                    )}
                  >
                    <PlanLabel plan={ApiOrganisationPlanChoices.Pr} />
                  </div>
                )}
              </Tab>
            )}
            <Tab>
              {({ selected }) => (
                <div
                  className={clsx(
                    'col-span-2 flex items-center justify-center gap-2 transition ease border-b -mb-px',
                    selected
                      ? 'opacity-100 grayscale-0 border-amber-500'
                      : 'opacity-50 grayscale border-transparent'
                  )}
                >
                  <PlanLabel plan={ApiOrganisationPlanChoices.En} />
                </div>
              )}
            </Tab>
          </Tab.List>
          <Tab.Panels>
            <Tab.Panel>
              <div>
                <CheckoutPreview />
              </div>
            </Tab.Panel>
            <Tab.Panel>
              <div>
                <CheckoutPreview />
              </div>
            </Tab.Panel>
          </Tab.Panels>
        </Tab.Group>
      </div>
    )
  return (
    <div className="space-y-2">
      <UpgradeForm planType={planType} billingPeriod={billingPeriod} onSuccess={props.onSuccess} />
      <div>
        <Button variant="secondary" onClick={() => setBillingPeriod(null)}>
          Back
        </Button>
      </div>
    </div>
  )
}

export default UpgradeDialog
