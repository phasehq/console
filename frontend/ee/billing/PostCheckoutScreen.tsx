import { useQuery, gql } from '@apollo/client'
import { GetCheckoutDetails } from '@/graphql/queries/billing/getCheckoutDetails.gql'
import { Button } from '@/components/common/Button'
import { Dialog, Transition } from '@headlessui/react'
import { useState, Fragment } from 'react'
import { FaCheckCircle, FaTimes, FaTimesCircle } from 'react-icons/fa'
import { useRouter } from 'next/navigation'

export const PostCheckoutScreen = ({ stripeSessionId }: { stripeSessionId: string }) => {
  const { loading, error, data } = useQuery(GetCheckoutDetails, {
    variables: { stripeSessionId },
  })

  const [isOpen, setIsOpen] = useState<boolean>(true)
  const router = useRouter()

  const closeModal = () => {
    setIsOpen(false)

    // Get the router instance

    // Create a new URLSearchParams object based on the current search params
    const params = new URLSearchParams(window.location.search)

    // Remove the stripe_session_id parameter
    params.delete('stripe_session_id')

    // Update the URL without refreshing the page
    const newUrl = `${window.location.pathname}?${params.toString()}`
    router.replace(newUrl)
  }

  if (loading) return <p>Loading...</p>

  const {
    paymentStatus,
    customerEmail,
    billingStartDate,
    billingEndDate,
    subscriptionId,
    planName,
  } = data?.stripeCheckoutDetails

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={closeModal}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25 backdrop-blur-md" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl transform rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                <Dialog.Title as="div" className="flex w-full justify-between">
                  <h3 className="text-lg font-medium leading-6 text-zinc-800 dark:text-zinc-200">
                    Payment {paymentStatus === 'paid' ? 'Success' : 'Failed'}
                  </h3>
                  <Button variant="text" onClick={closeModal}>
                    <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                  </Button>
                </Dialog.Title>
                <div className="text-zinc-900 dark:text-zinc-100 text-center space-y-4">
                  <div className="flex items-center justify-center">
                    {paymentStatus === 'paid' ? (
                      <FaCheckCircle className="text-emerald-500 text-4xl" />
                    ) : (
                      <FaTimesCircle className="text-red-500 text-4xl" />
                    )}
                  </div>

                  <p className="text-lg font-semibold">
                    Your subscription of {planName} is now active!
                  </p>
                  <div></div>

                  <p className="text-neutral-500">
                    Renewal date: {new Date(billingEndDate * 1000).toLocaleDateString()}
                  </p>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
