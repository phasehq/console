import {
  ApiOrganisationPlanChoices,
  PaymentMethodDetails,
  StripeSubscriptionDetails,
} from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import Spinner from '@/components/common/Spinner'
import { organisationContext } from '@/contexts/organisationContext'
import { GetSubscriptionDetails } from '@/graphql/queries/billing/getSubscriptionDetails.gql'
import { DeleteStripePaymentMethod } from '@/graphql/mutations/billing/deletePaymentMethod.gql'
import { CancelStripeSubscription } from '@/graphql/mutations/billing/cancelProSubscription.gql'
import { ResumeStripeSubscription } from '@/graphql/mutations/billing/resumeProSubscription.gql'
import { SetDefaultStripePaymentMethodOp } from '@/graphql/mutations/billing/setDefaultPaymentMethod.gql'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { relativeTimeFromDates } from '@/utils/time'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useContext, useRef } from 'react'
import { FaCheckCircle, FaCreditCard, FaPlay, FaTimes, FaTrash } from 'react-icons/fa'
import {
  SiAmericanexpress,
  SiDinersclub,
  SiDiscover,
  SiJcb,
  SiMastercard,
  SiVisa,
} from 'react-icons/si'
import { toast } from 'react-toastify'
import clsx from 'clsx'
import { Alert } from '@/components/common/Alert'
import { userHasPermission } from '@/utils/access/permissions'
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import { AddPaymentMethodDialog, AddPaymentMethodForm } from './AddPaymentMethodForm'
import { ModifySubscriptionDialog } from './ModifySubscriptionDialog'
import { StripeCustomerPortalLink } from './StripeCustomerPortalLink'

const BrandIcon = ({ brand }: { brand?: string }) => {
  switch (brand) {
    case 'visa':
      return <SiVisa className="shrink-0 text-[#0000ff]" />
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

const HiddenCardDigits = ({ brand }: { brand?: string }) => {
  switch (brand) {
    case 'visa':
    case 'mastercard':
    case 'discover':
    case 'jcb':
    case 'diners':
    case 'diners_club':
      // Format: **** **** ****
      return <span className="text-neutral-500">**** **** **** </span>
    case 'amex':
    case 'american_express':
      // Format: **** ****** *
      return <span className="text-neutral-500">**** ****** *</span>
    default:
      // Generic format: **** **** ****
      return <span className="text-neutral-500">**** **** **** </span>
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
      toast.success('Deleted payment method')
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

const ResumeSubscription = ({
  subscriptionData,
}: {
  subscriptionData: StripeSubscriptionDetails
}) => {
  const { activeOrganisation } = useContext(organisationContext)

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

  const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY!)

  const paymentMethodExists = subscriptionData.paymentMethods!.length > 0

  const [resumeSubscription, { loading: resumeIsPending }] = useMutation(ResumeStripeSubscription)

  const handleResumeSubscription = async () => {
    if (subscriptionData?.cancelAtPeriodEnd) {
      await resumeSubscription({
        variables: {
          organisationId: activeOrganisation?.id,
          subscriptionId: subscriptionData.subscriptionId,
        },
        refetchQueries: [
          { query: GetSubscriptionDetails, variables: { organisationId: activeOrganisation?.id } },
          { query: GetOrganisations },
        ],
      })
      toast.success('Resumed subscription')
    }
  }

  if (paymentMethodExists)
    return (
      <Button
        variant="primary"
        onClick={handleResumeSubscription}
        isLoading={resumeIsPending}
        title="Resume subscription"
      >
        <FaPlay /> Resume
      </Button>
    )
  else
    return (
      <GenericDialog
        title="Resume subscription"
        buttonVariant="primary"
        buttonContent={
          <>
            <FaPlay /> Resume
          </>
        }
      >
        <div>
          <div className="py-4">Please add a payment method to resume your subscription.</div>
          <Elements stripe={stripePromise} options={elementsOptions}>
            <AddPaymentMethodForm onSuccess={handleResumeSubscription} />
          </Elements>
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

  const userCanDeleteBilling = activeOrganisation
    ? userHasPermission(activeOrganisation.role?.permissions, 'Billing', 'delete')
    : false

  const allowDelete =
    userCanDeleteBilling &&
    (subscriptionData?.paymentMethods!.length! > 1 ||
      subscriptionData?.cancelAtPeriodEnd ||
      activeOrganisation?.plan === ApiOrganisationPlanChoices.Fr)

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

  const PaymentMethodCard = ({ paymentMethod }: { paymentMethod: PaymentMethodDetails }) => {
    const { isDefault } = paymentMethod

    return (
      <div
        key={paymentMethod!.id}
        className={clsx(
          'p-4 rounded-lg  flex items-center justify-between shadow-sm group relative',
          isDefault
            ? 'bg-emerald-100 dark:bg-emerald-400/10 ring-1 ring-inset ring-emerald-400/20'
            : 'bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/20'
        )}
      >
        {/* Payment Info */}
        <div className="flex items-center gap-4">
          <div className="flex flex-col gap-2 items-start">
            <div className="text-lg font-medium flex items-center gap-6 text-zinc-900 dark:text-zinc-100">
              <div className="text-4xl">
                <BrandIcon brand={paymentMethod?.brand!} />
              </div>
              <span className="font-mono">
                <HiddenCardDigits brand={paymentMethod.brand!} />
                {paymentMethod?.last4}
              </span>
            </div>
            <div className="text-sm text-neutral-500">
              Expires {paymentMethod?.expMonth}/{paymentMethod?.expYear}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {paymentMethod?.isDefault && (
            <div className="px-2 py-1 text-2xs font-semibold text-emerald-700 bg-emerald-200 rounded-md dark:text-emerald-200 dark:bg-emerald-700 flex items-center gap-2 absolute top-0 right-0 origin-bottom-right">
              <FaCheckCircle /> Default
            </div>
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
          {allowDelete && (
            <div className="opacity-0 group-hover:opacity-100 transition ease">
              <DeletePaymentMethodDialog paymentMethodId={paymentMethod?.id!} />
            </div>
          )}
        </div>
      </div>
    )
  }

  if (
    activeOrganisation?.plan === ApiOrganisationPlanChoices.Fr &&
    subscriptionData?.paymentMethods?.length === 0
  )
    return <></>

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
        <div className="text-neutral-500 text-sm">
          Add or remove payment methods, and manage your default payment method
        </div>
        <div className="space-y-4 py-4">
          {subscriptionData?.paymentMethods?.map((paymentMethod, index) => (
            <PaymentMethodCard key={paymentMethod!.id} paymentMethod={paymentMethod!} />
          ))}
        </div>

        {activeOrganisation?.plan !== ApiOrganisationPlanChoices.Fr && (
          <div className="flex justify-end">
            <AddPaymentMethodDialog onSuccess={refetchSubscription} />
          </div>
        )}
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
      refetchQueries: [
        { query: GetSubscriptionDetails, variables: { organisationId: activeOrganisation?.id } },
        { query: GetOrganisations },
      ],
    }).then(() => {
      toast.success('Cancelled subscription')
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
            all current and future Phase Pro features at the end of the current billing cycle.
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

  const defaultPaymentMethod =
    subscriptionData?.paymentMethods!.length === 1
      ? subscriptionData?.paymentMethods[0]
      : subscriptionData?.paymentMethods!.find((paymentMethod) => paymentMethod?.isDefault)

  const topBorderColor = () => {
    const classMap: Record<string, string> = {
      free: 'border-t-neutral-500', // For free plan
      pro_active: 'border-t-emerald-500', // For active pro plan
      enterprise_active: 'border-t-emerald-500', // For active pro plan
      cancelled: 'border-t-amber-500', // For cancelled pro plan
    }

    if (activeOrganisation?.plan === ApiOrganisationPlanChoices.Fr) {
      return classMap.free
    } else if (activeOrganisation?.plan === ApiOrganisationPlanChoices.Pr) {
      if (subscriptionData?.cancelAtPeriodEnd) {
        return classMap.cancelled
      } else {
        return classMap.pro_active
      }
    } else if (activeOrganisation?.plan === ApiOrganisationPlanChoices.En) {
      if (subscriptionData?.cancelAtPeriodEnd) {
        return classMap.cancelled
      } else {
        return classMap.enterprise_active
      }
    }
    return '' // Default case if no condition matches
  }

  if (loading || !subscriptionData)
    return (
      <div className="flex items-center justify-center p-40 mx-auto">
        <Spinner size="md" />
      </div>
    )

  if (!userCanReadBilling) return <></>

  return (
    <div className="space-y-6">
      <div className="font-semibold text-xl">Current Subscription</div>
      <div
        className={clsx(
          'p-4 rounded-lg border-b border-x border-t-8 border-neutral-500/40  bg-zinc-100 dark:bg-zinc-800 flex items-center justify-between gap-4',
          topBorderColor()
        )}
      >
        <div className="flex flex-col gap-4">
          <div className="font-medium">
            {subscriptionData.planName}{' '}
            {activeOrganisation?.plan !== ApiOrganisationPlanChoices.Fr && (
              <span className="capitalize">
                ({subscriptionData.cancelAtPeriodEnd ? 'Cancelled' : subscriptionData.status})
              </span>
            )}
          </div>

          {activeOrganisation?.plan !== ApiOrganisationPlanChoices.Fr && (
            <div>
              <div className="text-neutral-500 text-sm">
                Current billing cycle:{' '}
                {new Date(subscriptionData.currentPeriodStart! * 1000).toDateString()}
                {' - '}
                {new Date(subscriptionData.currentPeriodEnd! * 1000).toDateString()}
              </div>

              <div className="text-neutral-500 text-sm flex items-center gap-1 font-semibold">
                {!subscriptionData.cancelAtPeriodEnd
                  ? `Next payment ${relativeTimeFromDates(new Date(subscriptionData.renewalDate! * 1000))} for $${(subscriptionData.nextPaymentAmount! / 100).toFixed(2)}`
                  : `Ends ${relativeTimeFromDates(new Date(subscriptionData.cancelAt! * 1000))}`}

                {!subscriptionData.cancelAtPeriodEnd && (
                  <div className="flex items-center gap-2">
                    {defaultPaymentMethod && ` on card ending in ${defaultPaymentMethod.last4}`}
                    {defaultPaymentMethod && <BrandIcon brand={defaultPaymentMethod.brand!} />}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end h-full gap-4">
          {subscriptionData.cancelAtPeriodEnd && (
            <Alert variant="warning" size="sm" icon={true}>
              Your subscription will end{' '}
              {relativeTimeFromDates(new Date(subscriptionData.cancelAt! * 1000))}{' '}
            </Alert>
          )}

          {userCanUpdateBilling && (
            <div className="flex flex-col items-end gap-4">
              <div className="flex items-center gap-2">
                {/* {activeOrganisation?.plan === ApiOrganisationPlanChoices.Pr && <UpsellDialog />} */}
                {activeOrganisation?.plan !== ApiOrganisationPlanChoices.Fr && (
                  <div className="flex items-center justify-end gap-4">
                    {!subscriptionData.cancelAtPeriodEnd && <ModifySubscriptionDialog />}
                    {!subscriptionData.cancelAtPeriodEnd ? (
                      <CancelSubscriptionDialog
                        subscriptionId={subscriptionData?.subscriptionId!}
                      />
                    ) : (
                      <ResumeSubscription subscriptionData={subscriptionData} />
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <StripeCustomerPortalLink />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
