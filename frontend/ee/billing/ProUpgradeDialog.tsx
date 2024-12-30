import { useCallback, useContext, useState } from 'react'
import { InitStripeProUpgradeCheckout } from '@/graphql/mutations/billing/initProUpgradeCheckout.gql'
import { useMutation } from '@apollo/client'
import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js'
import { organisationContext } from '@/contexts/organisationContext'
import { LogoWordMark } from '@/components/common/LogoWordMark'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'
import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { FaCartShopping } from 'react-icons/fa6'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import clsx from 'clsx'

type BillingPeriods = 'monthly' | 'yearly'

type PriceOption = { name: BillingPeriods; unitPrice: number; monthlyPrice: number }

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

const prices: PriceOption[] = [
  {
    name: 'monthly',
    unitPrice: 2,
    monthlyPrice: 2,
  },
  {
    name: 'yearly',
    unitPrice: 24,
    monthlyPrice: 2,
  },
]

const ProUpgradeDialog = (props: { userCount: number; onSuccess: () => void }) => {
  const [checkoutPreview, setCheckoutPreview] = useState<BillingPeriods>('yearly')
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriods | null>(null)

  const toggleCheckoutPreview = () => {
    if (checkoutPreview === 'yearly') setCheckoutPreview('monthly')
    else setCheckoutPreview('yearly')
  }

  const calculateGraduatedPrice = (seats: number) => {
    const basePrice = 2

    // Define graduated tiers with unit prices
    const tiers = [
      { min: 0, max: 49, discount: 0 },
      { min: 50, max: 99, discount: 0.25 },
      { min: 100, max: 249, discount: 0.35 },
      { min: 250, max: 999, discount: 0.45 },
      { min: 1000, max: 2500, discount: 0.6 },
    ]

    const calculateForTiers = (pricePerUnit: number) => {
      let totalPrice = 0
      let remainingSeats = seats

      // eslint-disable-next-line no-restricted-syntax
      for (const tier of tiers) {
        if (remainingSeats <= 0) break

        const seatsInTier = Math.min(remainingSeats, tier.max - tier.min + 1)
        const tierPrice = pricePerUnit * (1 - tier.discount)
        totalPrice += seatsInTier * tierPrice
        remainingSeats -= seatsInTier
      }

      return totalPrice
    }

    // Calculate monthly cost
    const monthlyCost = calculateForTiers(basePrice)

    // Calculate annualized cost
    const annualBasePrice = basePrice * 12
    const annualCost = calculateForTiers(annualBasePrice)

    const effectiveRateMonthly = monthlyCost / seats
    const effectiveRateAnnual = annualCost / seats

    const effectiveDiscountMonthly = ((basePrice - effectiveRateMonthly) / basePrice) * 100
    const effectiveDiscountAnnual =
      ((annualBasePrice / 12 - effectiveRateAnnual / 12) / (annualBasePrice / 12)) * 100

    return {
      monthly: monthlyCost,
      annually: annualCost,
      effectiveRate: {
        monthly: effectiveRateMonthly,
        annually: effectiveRateAnnual / 12,
      },
      discount: {
        monthly: effectiveDiscountMonthly,
        annually: effectiveDiscountAnnual,
      },
    }
  }

  const priceToPreview = prices.find((price) => price.name === checkoutPreview)

  const CheckoutPreview = ({ price }: { price: PriceOption }) => {
    const graduatedPrice = calculateGraduatedPrice(props.userCount)

    return (
      <div
        key={price.name}
        className="group shadow-xl bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 rounded-lg p-4 space-y-6 transition ease"
      >
        <div className="flex items-start justify-between">
          <div className="text-zinc-900 dark:text-zinc-100">
            <span className="font-extralight text-7xl">
              $
              {checkoutPreview === 'monthly'
                ? graduatedPrice.effectiveRate.monthly.toFixed(2)
                : graduatedPrice.effectiveRate.annually.toFixed(2)}
            </span>
            <span className="text-neutral-500">/mo per account</span>
          </div>
          <div>
            <div className="text-neutral-500 text-xs uppercase font-medium">Billed</div>
            <div className="flex items-center justify-center gap-2 text-zinc-900 dark:text-zinc-100 text-xs">
              <div>Monthly</div>
              <ToggleSwitch value={checkoutPreview === 'yearly'} onToggle={toggleCheckoutPreview} />
              <div>Yearly</div>
            </div>
          </div>
        </div>

        <div className="bg-zinc-200 dark:bg-zinc-700 p-3 rounded-lg mt-4 text-zinc-900 dark:text-zinc-100 text-xs space-y-1">
          <div className="flex justify-between text-zinc-900 dark:text-zinc-100">
            <span>Avg Unit Price:</span>
            <span>
              $
              {checkoutPreview === 'monthly'
                ? graduatedPrice.effectiveRate.monthly.toFixed(2)
                : graduatedPrice.effectiveRate.annually.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-zinc-900 dark:text-zinc-100">
            <span>Number of Accounts:</span>
            <span>{props.userCount}</span>
          </div>
          {graduatedPrice.discount.monthly > 0 && (
            <div className="flex justify-between text-zinc-900 dark:text-zinc-100">
              <span>Effective discount:</span>
              <span className="text-emerald-500">
                {graduatedPrice.discount.monthly.toFixed(1)}%
              </span>
            </div>
          )}
          <hr className="my-2 border-zinc-300 dark:border-zinc-600" />
          <div className="flex justify-between font-semibold text-zinc-900 dark:text-zinc-100">
            <span>Total:</span>
            <span>
              $
              {checkoutPreview === 'monthly'
                ? graduatedPrice.monthly.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : graduatedPrice.annually.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-emerald-500 font-medium pt-4 justify-end">
          <Button variant="primary" onClick={() => setBillingPeriod(price.name)}>
            <FaCartShopping /> Checkout
          </Button>
        </div>
      </div>
    )
  }

  if (billingPeriod === null)
    return (
      <div className="space-y-8">
        <div className="col-span-2 flex items-center justify-center gap-2">
          <LogoWordMark className="fill-black dark:fill-white h-10" />{' '}
          <PlanLabel plan={ApiOrganisationPlanChoices.Pr} />
        </div>

        <div>{priceToPreview && <CheckoutPreview price={priceToPreview} />}</div>
      </div>
    )
  return (
    <div className="space-y-2">
      <UpgradeForm billingPeriod={billingPeriod} onSuccess={props.onSuccess} />
      <div>
        <Button variant="secondary" onClick={() => setBillingPeriod(null)}>
          Back
        </Button>
      </div>
    </div>
  )
}

export default ProUpgradeDialog
