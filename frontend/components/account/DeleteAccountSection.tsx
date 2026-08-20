'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { Dialog, Transition } from '@headlessui/react'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaTimes, FaTrash } from 'react-icons/fa'
import { GetAccountDeletionReadiness } from '@/graphql/queries/account/getAccountDeletionReadiness.gql'
import { DeleteAccountOp } from '@/graphql/mutations/account/deleteAccount.gql'
import { AccountDeletionItemType, AccountDeletionReadinessType } from '@/apollo/graphql'
import { useUser } from '@/contexts/userContext'
import { handleSignout } from '@/apollo/client'
import { Button } from '../common/Button'
import { Alert } from '../common/Alert'
import Spinner from '../common/Spinner'

const REAUTH_URL = '/login?callbackUrl=%2Faccount&reauth=1'

const BlockerItem = ({ item }: { item: AccountDeletionItemType }) => (
  <Alert variant="danger" size="sm" icon>
    <div className="flex items-center justify-between gap-4 w-full">
      <p className="text-sm">
        {item.kind === 'sole_owner' ? (
          <>
            You are the owner of{' '}
            <span className="font-medium">{item.organisationName}</span>. You must transfer
            ownership to another user before your account can be deleted.
          </>
        ) : (
          <>
            Your account in <span className="font-medium">{item.organisationName}</span> is
            managed by its identity provider. Contact your administrator to be deprovisioned.
          </>
        )}
      </p>
      {item.kind === 'sole_owner' && item.organisationName && (
        <Link href={`/${item.organisationName}/settings?tab=organisation`} className="shrink-0">
          <Button variant="outline">
            <span className="text-xs">Transfer ownership</span>
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
  const [deleteAccount, { loading: deleting }] = useMutation(DeleteAccountOp)

  const [isOpen, setIsOpen] = useState(false)
  const [typedEmail, setTypedEmail] = useState('')

  const readiness: AccountDeletionReadinessType | undefined = data?.accountDeletionReadiness
  const blockers = (readiness?.blockers ?? []) as AccountDeletionItemType[]
  const warnings = (readiness?.warnings ?? []) as AccountDeletionItemType[]

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
      if (message.includes('reauth_required')) {
        window.location.href = REAUTH_URL
        return
      }
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
        <h2 className="text-base sm:text-lg font-semibold text-red-500">Danger zone</h2>
        <p className="text-sm text-neutral-500">
          Permanently delete your account and all associated data.
        </p>
      </div>

      {blockers.map((item, index) => (
        <BlockerItem key={index} item={item} />
      ))}

      {warnings.map((item, index) => (
        <Alert key={index} variant="warning" size="sm" icon>
          {item.detail}
        </Alert>
      ))}

      <div className="flex items-center justify-between gap-4 rounded-md ring-1 ring-inset ring-red-500/40 p-4">
        <div>
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Delete account
          </div>
          <div className="text-sm text-neutral-500">
            Your organisation memberships, tokens and keys will be permanently deleted. This
            cannot be undone.
          </div>
        </div>
        {readiness?.canDelete && readiness?.requiresReauth ? (
          // Re-auth is only worth prompting once deletion is actually
          // possible — while blockers exist, show the (disabled) action.
          <Link href={REAUTH_URL}>
            <Button variant="outline">Sign in again to continue</Button>
          </Link>
        ) : (
          <Button
            variant="danger"
            icon={FaTrash}
            onClick={() => setIsOpen(true)}
            disabled={!readiness?.canDelete}
            title={
              readiness?.canDelete
                ? undefined
                : 'Resolve the requirements above before deleting your account'
            }
          >
            Delete account
          </Button>
        )}
      </div>

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
                            Your account, organisation memberships, personal tokens and
                            encryption keys will be permanently deleted. You will not be able
                            to recover any of this data.
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
