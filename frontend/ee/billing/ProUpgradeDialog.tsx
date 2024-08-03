import { useSession } from 'next-auth/react'
import { useCallback, useContext, useState } from 'react'
import { toast } from 'react-toastify'
import { InitStripeProUpgradeCheckout } from '@/graphql/mutations/billing/initProUpgradeCheckout.gql'
import { useMutation } from '@apollo/client'
import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js'
import { organisationContext } from '@/contexts/organisationContext'
import { LogoWordMark } from '@/components/common/LogoWordMark'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'
import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { FaArrowRight, FaCheckCircle, FaUser } from 'react-icons/fa'
import { Button } from '@/components/common/Button'
import { FaCartShopping } from 'react-icons/fa6'

type BillingPeriods = 'monthly' | 'yearly'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY!)

const UpgradeForm = (props: { onSuccess: Function; billingPeriod: BillingPeriods }) => {
  const { billingPeriod } = props

  const [createCheckoutSession] = useMutation(InitStripeProUpgradeCheckout)
  const { activeOrganisation } = useContext(organisationContext)

  const fetchClientSecret = useCallback(async () => {
    // Create a Checkout Session
    const { data } = await createCheckoutSession({
      variables: { organisationId: activeOrganisation!.id, billingPeriod },
    })
    const clientSecret = data.createProUpgradeCheckoutSession.clientSecret

    return clientSecret
  }, [])

  const options = { fetchClientSecret }

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  )
}

const prices: { name: BillingPeriods; unitPrice: number; monthlyPrice: number }[] = [
  {
    name: 'monthly',
    unitPrice: 18,
    monthlyPrice: 18,
  },
  {
    name: 'yearly',
    unitPrice: 192,
    monthlyPrice: 16,
  },
]

export const ProUpgradeDialog = (props: { userCount: number }) => {
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriods | null>(null)

  if (billingPeriod === null)
    return (
      <div className="space-y-8">
        <div className="col-span-2 flex items-center justify-center gap-2">
          <LogoWordMark className="fill-black dark:fill-white h-10" />{' '}
          <PlanLabel plan={ApiOrganisationPlanChoices.Pr} />
        </div>

        <div className="grid grid-cols-2 gap-8">
          {prices.map((price) => (
            <div
              key={price.name}
              className="group shadow-xl bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 rounded-lg p-4 space-y-4 transition ease"
            >
              <div className="text-zinc-900 dark:text-zinc-100 font-semibold text-lg capitalize">
                Pay {price.name}
              </div>
              <div className="text-zinc-900 dark:text-zinc-100">
                <span className="font-extralight text-7xl">${price.monthlyPrice}</span>
                <span className="text-neutral-500">/mo per user</span>
              </div>

              <div className="bg-zinc-200 dark:bg-zinc-700 p-3 rounded-lg mt-4 text-zinc-900 dark:text-zinc-100 text-xs space-y-1">
                <div className="flex justify-between text-zinc-900 dark:text-zinc-100">
                  <span>Unit Price:</span>
                  <span>${price.unitPrice}</span>
                </div>
                <div className="flex justify-between text-zinc-900 dark:text-zinc-100">
                  <span>Number of Users:</span>
                  <span>{props.userCount}</span>
                </div>
                <hr className="my-2 border-zinc-300 dark:border-zinc-600" />
                <div className="flex justify-between font-semibold text-zinc-900 dark:text-zinc-100">
                  <span>Total:</span>
                  <span>${price.unitPrice * props.userCount}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 text-emerald-500 font-medium pt-4 justify-end">
                <Button variant="primary" onClick={() => setBillingPeriod(price.name)}>
                  <FaCartShopping /> Checkout
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  return (
    <div className="space-y-2">
      <UpgradeForm
        billingPeriod={billingPeriod}
        onSuccess={() => console.log('Upgrade successful!')}
      />
      <div>
        <Button variant="secondary" onClick={() => setBillingPeriod(null)}>
          Back
        </Button>
      </div>
    </div>
  )
}
