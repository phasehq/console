'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { Dialog, Transition } from '@headlessui/react'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaArrowRight, FaTimes, FaTrash } from 'react-icons/fa'
import { GetAccountDeletionReadiness } from '@/graphql/queries/account/getAccountDeletionReadiness.gql'
import { DeleteAccountOp } from '@/graphql/mutations/account/deleteAccount.gql'
import { AccountDeletionItemType, AccountDeletionReadinessType } from '@/apollo/graphql'
import { useUser } from '@/contexts/userContext'
import { handleSignout } from '@/apollo/client'
import { buildReauthUrl, isReauthError, requestReauthPrompt } from '@/utils/accountErrors'
import { useReauthRestore, useReauthStateSync, useSessionFresh } from './useReauthState'
import { Button } from '../common/Button'
import { Alert } from '../common/Alert'
import Spinner from '../common/Spinner'

const BlockerItem = ({ item }: { item: AccountDeletionItemType }) => (
  <Alert variant="danger" size="md">
    <div className="flex items-center justify-between gap-4 w-full">
      <p className="text-xs">
        {item.kind === 'sole_owner' ? (
          <>
            You are the owner of <span className="font-medium">{item.organisationName}</span>. You
            must transfer ownership to another user before your account can be deleted.
          </>
        ) : (
          <>
            Your account in <span className="font-medium">{item.organisationName}</span> is managed
            by its identity provider. Contact your administrator to be deprovisioned.
          </>
        )}
      </p>
      {item.kind === 'sole_owner' && item.organisationName && (
        <Link href={`/${item.organisationName}/settings?tab=organisation`} className="shrink-0">
          <Button variant="outline" icon={FaArrowRight} iconPosition="right">
            Manage ownership
          </Button>
        </Link>
      )}
    </div>
  </Alert>
)

export default function DeleteAccountSection() {
  const { user } = useUser()
  const { data, loading, refetch } = useQuery(GetAccountDeletionReadiness, {
    fetchPolicy: 'network-only',
  })
  // The submit handler owns the error toast — suppress the global one.
  const [deleteAccount, { loading: deleting }] = useMutation(DeleteAccountOp, {
    context: { suppressGlobalErrorToast: true },
  })

  const [isOpen, setIsOpen] = useState(false)
  const [typedEmail, setTypedEmail] = useState('')

  const readiness: AccountDeletionReadinessType | undefined = data?.accountDeletionReadiness
  const blockers = (readiness?.blockers ?? []) as AccountDeletionItemType[]

  // If the fresh-session gate interrupts the delete, reopen the confirm
  // dialog after the re-login. The typed confirmation email is deliberate
  // friction — never captured or restored.
  useReauthStateSync(isOpen, () => ({ action: 'delete' }))

  useReauthRestore(
    'delete',
    () => {
      if (readiness?.canDelete && !readiness?.requiresReauth) setIsOpen(true)
    },
    !loading
  )

  const { isFresh } = useSessionFresh()

  // Deletion is reauth-gated. Ask first instead of interrupting at submit —
  // isFresh() is a click-time check, so a session that went stale while this
  // page sat open still gets the prompt (the requiresReauth flag from the
  // readiness query is only a load-time snapshot). The restore param reopens
  // the confirm dialog after the re-login.
  const handleDeleteClick = () => {
    if (!isFresh() && requestReauthPrompt(buildReauthUrl('/account?action=delete'))) return
    setIsOpen(true)
  }

  const closeModal = () => {
    setTypedEmail('')
    setIsOpen(false)
  }

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (typedEmail !== user?.email) {
      toast.error('The typed email address is incorrect!')
      return
    }
    try {
      await deleteAccount()
      toast.success('Your account has been permanently deleted.')
      handleSignout()
    } catch (error: any) {
      const message: string = error?.message || ''
      // The errorLink redirects on the reauth gate; nothing to do here.
      if (isReauthError(message)) return
      // Blockers may have appeared since the readiness fetch
      await refetch()
      toast.error(
        message.includes('sole_owner') || message.includes('scim_managed')
          ? 'Your account cannot be deleted yet — see the requirements above.'
          : 'Failed to delete your account. Please try again.',
        { autoClose: 8000 }
      )
      closeModal()
    }
  }

  if (loading)
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
    )

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base sm:text-lg font-semibold text-red-500">Delete account</h2>
        <p className="text-sm text-neutral-500">
          Permanently delete your account and all associated data.
        </p>
      </div>

      {blockers.map((item, index) => (
        <BlockerItem key={index} item={item} />
      ))}

      {/* A blocker makes deletion impossible, so show only the warning above
          rather than a dead disabled card. */}
      {readiness?.canDelete && (
        <div className="flex items-center justify-between gap-4 rounded-md ring-1 ring-inset ring-red-500/40 p-4">
          <div className="text-sm text-neutral-500">
            Your organisation memberships, tokens and keys will be permanently deleted. This cannot
            be undone.
          </div>
          <Button
            variant="danger"
            icon={FaTrash}
            onClick={handleDeleteClick}
            classString="shrink-0"
          >
            Delete account
          </Button>
        </div>
      )}

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
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white">
                      Delete account
                    </h3>
                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <form onSubmit={handleSubmit}>
                    <div className="mt-2 space-y-6">
                      <Alert variant="danger" icon={true}>
                        <div className="space-y-1">
                          <p className="font-bold">Warning: This is permanent!</p>
                          <p>
                            Your account, organisation memberships, personal tokens and encryption
                            keys will be permanently deleted. You will not be able to recover any of
                            this data.
                          </p>
                        </div>
                      </Alert>

                      <div className="flex flex-col justify-center max-w-md mx-auto">
                        <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                          Please enter your email address{' '}
                          <span className="text-gray-900 dark:text-white font-mono font-medium ph-no-capture">
                            {user?.email}
                          </span>{' '}
                          to confirm:
                        </div>
                        <input
                          id="confirm-email"
                          className="text-lg ph-no-capture"
                          required
                          value={typedEmail}
                          onChange={(e) => setTypedEmail(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="mt-8 flex items-center w-full justify-between">
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={closeModal}
                        disabled={deleting}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" variant="danger" isLoading={deleting}>
                        Delete my account
                      </Button>
                    </div>
                  </form>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </section>
  )
}
