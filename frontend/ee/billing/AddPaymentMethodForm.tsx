import { useMutation } from '@apollo/client'
import { useContext, useRef, useState } from 'react'
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js'
import { Elements, useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js'
import CreateStripeSetupIntentOp from '@/graphql/mutations/billing/createStripeSetupIntent.gql'

import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import GenericDialog from '@/components/common/GenericDialog'
import { FaPlus } from 'react-icons/fa'
import { toast } from 'react-toastify'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY!)

export const AddPaymentMethodForm = ({ onSuccess }: { onSuccess: () => void }) => {
  const { activeOrganisation } = useContext(organisationContext)
  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const stripe = useStripe()
  const elements = useElements()
  const [createSetupIntent] = useMutation(CreateStripeSetupIntentOp)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!stripe || !elements) {
      setError('Stripe has not loaded yet.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { error: submitError } = await elements.submit()
      if (submitError) setError(submitError.message || 'An error occurred')
      // Fetch the client secret from the server
      const { data } = await createSetupIntent({
        variables: { organisationId: activeOrganisation!.id },
      })
      const clientSecret = data.createSetupIntent.clientSecret

      // Confirm the payment setup
      const result = await stripe.confirmSetup({
        elements,
        clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/${activeOrganisation?.name}/settings`,
        },
        redirect: 'if_required',
      })

      if (result.error) {
        setError(result.error.message || 'Failed to set up payment method.')
        setLoading(false)
        return
      }

      // Handle success
      setSuccess(true)
      toast.success('Added payment method')
      onSuccess()
      if (dialogRef.current) dialogRef.current.closeModal()
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 py-4">
      <div className="p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg ring-1 ring-neutral-500/20">
        <PaymentElement />
      </div>
      <div className="text-neutral-500 text-xs">Powered by Stripe</div>
      {error && <div className="text-red-500 text-sm">{error}</div>}

      <div className="flex justify-end">
        <Button variant="primary" type="submit" disabled={!stripe} isLoading={loading}>
          <FaPlus /> Add Payment Method
        </Button>
      </div>
    </form>
  )
}

export const AddPaymentMethodDialog = ({ onSuccess }: { onSuccess: () => void }) => {
  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const handleSuccess = () => {
    dialogRef.current?.closeModal()
    onSuccess()
  }

  const elementsOptions: StripeElementsOptions = {
    mode: 'setup',
    currency: 'usd',
    setupFutureUsage: 'off_session',
    payment_method_types: ['card'],
    appearance: {
      theme: 'night',
      variables: {
        colorPrimary: '#10b981',
      },
    },
  }

  return (
    <GenericDialog
      title="Add a payment method"
      buttonContent={
        <>
          <FaPlus /> Add payment method
        </>
      }
      buttonVariant="primary"
      ref={dialogRef}
    >
      <Elements stripe={stripePromise} options={elementsOptions}>
        <AddPaymentMethodForm onSuccess={handleSuccess} />
      </Elements>
    </GenericDialog>
  )
}
