import { StripeSubscriptionDetails } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import Spinner from '@/components/common/Spinner'
import { organisationContext } from '@/contexts/organisationContext'
import { GetSubscriptionDetails } from '@/graphql/queries/billing/getSubscriptionDetails.gql'
import { DeleteStripePaymentMethod } from '@/graphql/mutations/billing/deletePaymentMethod.gql'
import { CancelStripeSubscription } from '@/graphql/mutations/billing/cancelProSubscription.gql'
import { SetDefaultStripePaymentMethodOp } from '@/graphql/mutations/billing/setDefaultPaymentMethod.gql'
import { relativeTimeFromDates } from '@/utils/time'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useContext, useRef } from 'react'
import { FaCreditCard, FaTimes, FaTrash } from 'react-icons/fa'
import {
  SiAmericanexpress,
  SiDinersclub,
  SiDiscover,
  SiJcb,
  SiMastercard,
  SiVisa,
} from 'react-icons/si'
import { AddPaymentMethodDialog } from './AddPaymentMethodForm'
import { toast } from 'react-toastify'

const BrandIcon = ({ brand }: { brand?: string }) => {
  switch (brand) {
    case 'visa':
      return <SiVisa className="shrink-0 text-blue-600" />
    case 'mastercard':
      return <SiMastercard className="shrink-0 text-red-600" />
    case 'amex':
    case 'american_express':
      return <SiAmericanexpress className="shrink-0 text-blue-500" />
    case 'discover':
      return <SiDiscover className="shrink-0 text-orange-500" />
    case 'diners':
    case 'diners_club':
      return <SiDinersclub className="shrink-0 text-green-500" />
    case 'jcb':
      return <SiJcb className="shrink-0 text-purple-500" />
    default:
      return <FaCreditCard className="shrink-0 text-neutral-500" />
  }
}

const DeletePaymentMethodDialog = ({ paymentMethodId }: { paymentMethodId: string }) => {
  const { activeOrganisation } = useContext(organisationContext)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [deletePaymentMethod, { loading }] = useMutation(DeleteStripePaymentMethod)

  const handleDelete = async () =>
    await deletePaymentMethod({
      variables: { paymentMethodId, organisationId: activeOrganisation!.id },
      refetchQueries: [
        { query: GetSubscriptionDetails, variables: { organisationId: activeOrganisation?.id } },
      ],
    }).then(() => {
      if (dialogRef.current) dialogRef.current.closeModal()
    })

  return (
    <GenericDialog
      title="Delete payment method"
      buttonContent={
        <>
          <FaTrash /> Delete
        </>
      }
      buttonVariant="danger"
      ref={dialogRef}
    >
      <div>
        <p className="text-neutral-500 py-4">
          Are you sure you want to delete this payment method?
        </p>
        <div className="flex items-center justify-end">
          <Button variant="danger" onClick={handleDelete} isLoading={loading}>
            Delete
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}

const ManagePaymentMethodsDialog = () => {
  const { activeOrganisation } = useContext(organisationContext)

  const { data, loading } = useQuery(GetSubscriptionDetails, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !activeOrganisation,
  })

  const subscriptionData: StripeSubscriptionDetails | undefined =
    data?.stripeSubscriptionDetails ?? undefined

  const [getSubscriptionDetails] = useLazyQuery(GetSubscriptionDetails)
  const [setDefaultPaymentMethod, { loading: setDefaultPending }] = useMutation(
    SetDefaultStripePaymentMethodOp
  )

  const refetchSubscription = async () => {
    await getSubscriptionDetails({
      variables: { organisationId: activeOrganisation?.id },
      fetchPolicy: 'cache-and-network',
    })
  }

  const handleSetDefaultPaymentMethod = async (paymentMethodId: string) => {
    await setDefaultPaymentMethod({
      variables: { organisationId: activeOrganisation?.id, paymentMethodId },
      refetchQueries: [
        { query: GetSubscriptionDetails, variables: { organisationId: activeOrganisation?.id } },
      ],
    })
    toast.success('Updated default payment method')
  }

  if (loading || !subscriptionData)
    return (
      <div className="flex items-center justify-center p-40 mx-auto">
        <Spinner size="md" />
      </div>
    )

  return (
    <GenericDialog
      buttonContent={
        <>
          <FaCreditCard /> Manage payment methods
        </>
      }
      buttonVariant="secondary"
      title="Manage payment methods"
    >
      <div className="space-y-2">
        <div className="space-y-4 py-4">
          {subscriptionData.paymentMethods!.map((paymentMethod, index) => (
            <div
              key={paymentMethod!.id}
              className="p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg ring-1 ring-inset ring-neutral-500/20 flex items-center justify-between shadow-sm group"
            >
              {/* Payment Info */}
              <div className="flex items-center gap-4">
                <div className="flex flex-col gap-2 items-start">
                  <div className="text-lg font-medium flex items-center gap-6 text-zinc-900 dark:text-zinc-100">
                    <div className="text-4xl">
                      <BrandIcon brand={paymentMethod?.brand!} />
                    </div>
                    <span className="font-mono">**** {paymentMethod?.last4}</span>
                  </div>
                  <div className="text-sm text-neutral-500">
                    Expires {paymentMethod?.expMonth}/{paymentMethod?.expYear}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                {paymentMethod?.isDefault && (
                  <span className="px-2 py-1 text-xs font-semibold text-green-700 bg-green-200 rounded-md dark:text-green-200 dark:bg-green-700">
                    Default
                  </span>
                )}

                {subscriptionData?.paymentMethods!.length > 1 && !paymentMethod?.isDefault && (
                  <div className="opacity-0 group-hover:opacity-100 transition ease">
                    <Button
                      variant="secondary"
                      onClick={() => handleSetDefaultPaymentMethod(paymentMethod?.id!)}
                      isLoading={setDefaultPending}
                    >
                      Set as Default
                    </Button>
                  </div>
                )}
                <div className="opacity-0 group-hover:opacity-100 transition ease">
                  <DeletePaymentMethodDialog paymentMethodId={paymentMethod?.id!} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <AddPaymentMethodDialog onSuccess={refetchSubscription} />
        </div>
      </div>
    </GenericDialog>
  )
}

const CancelSubscriptionDialog = ({ subscriptionId }: { subscriptionId: string }) => {
  const { activeOrganisation } = useContext(organisationContext)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [cancelSubscription] = useMutation(CancelStripeSubscription)
  const handleCancelSubscription = async () =>
    await cancelSubscription({
      variables: { subscriptionId, organisationId: activeOrganisation!.id },
    }).then(() => {
      if (dialogRef.current) dialogRef.current.closeModal()
    })

  return (
    <GenericDialog
      title="Cancel subscription"
      buttonContent={
        <>
          <FaTimes /> Cancel
        </>
      }
      buttonVariant="danger"
      ref={dialogRef}
    >
      <div>
        <div className="py-4">
          <p className="text-neutral-500">
            Are you sure you want to cancel your subscription of Phase Pro? You will lose access to
            all current and future Phase Pro features.
          </p>
        </div>
        <div className="flex items-center justify-end">
          <Button variant="danger" onClick={handleCancelSubscription}>
            <FaTimes /> Cancel subscription
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}

export const StripeBillingInfo = () => {
  const { activeOrganisation } = useContext(organisationContext)

  const { data, loading } = useQuery(GetSubscriptionDetails, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !activeOrganisation,
  })

  const subscriptionData: StripeSubscriptionDetails | undefined =
    data?.stripeSubscriptionDetails ?? undefined

  if (loading || !subscriptionData)
    return (
      <div className="flex items-center justify-center p-40 mx-auto">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="space-y-8">
      <div>
        <div className="font-semibold text-xl">Current Subscription</div>
        <div className="py-4">
          <div className="font-medium">
            {subscriptionData.planName} ({subscriptionData.status})
          </div>
          <div className="text-neutral-500 text-sm">
            Current billing cycle:{' '}
            {new Date(subscriptionData.currentPeriodStart! * 1000).toDateString()}
            {' - '}
            {new Date(subscriptionData.currentPeriodEnd! * 1000).toDateString()}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-neutral-500 text-sm">
              Next payment in{' '}
              {relativeTimeFromDates(new Date(subscriptionData.renewalDate! * 1000))}
            </div>

            <div className="flex items-center gap-2">
              <ManagePaymentMethodsDialog />
              <CancelSubscriptionDialog subscriptionId={subscriptionData?.subscriptionId!} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
