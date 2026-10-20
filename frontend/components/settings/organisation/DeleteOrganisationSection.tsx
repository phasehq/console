'use client'

import { useContext, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApolloError, useLazyQuery, useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaTrash } from 'react-icons/fa'
import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { DeleteOrganisationOp } from '@/graphql/mutations/organisation/deleteOrganisation.gql'
import { GetOrganisationPendingInvoices } from '@/graphql/queries/organisation/getOrganisationPendingInvoices.gql'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { isCloudHosted } from '@/utils/appConfig'

// Mirrors GRACE_PERIOD in backend/api/utils/organisation_deletion.py
const GRACE_PERIOD_DAYS = 7

// Plans with a paid Stripe subscription on Phase Cloud.
const PAID_PLAN_NAMES: Partial<Record<ApiOrganisationPlanChoices, string>> = {
  [ApiOrganisationPlanChoices.Pr]: 'Phase Pro',
  [ApiOrganisationPlanChoices.En]: 'Phase Enterprise',
}

export const DeleteOrganisationSection = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const router = useRouter()
  const [typedName, setTypedName] = useState('')

  const [deleteOrganisation, { loading }] = useMutation(DeleteOrganisationOp)
  // Phase Cloud: unpaid invoices block deletion. The server checks again on submit.
  const [checkInvoices, { data: invoicesData }] = useLazyQuery(GetOrganisationPendingInvoices, {
    fetchPolicy: 'network-only',
    context: { suppressGlobalErrorToast: true },
  })
  const [refusedForInvoices, setRefusedForInvoices] = useState(false)

  if (!organisation) return null

  const nameMatches = typedName === organisation.name
  const paidPlanName = isCloudHosted() ? PAID_PLAN_NAMES[organisation.plan] : undefined
  const pendingInvoices =
    refusedForInvoices || invoicesData?.organisationHasPendingInvoices === true

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (!nameMatches) return

    try {
      await deleteOrganisation({ variables: { organisationId: organisation.id } })
    } catch (error) {
      // The global error link shows the error toast.
      const code = (error as ApolloError).graphQLErrors?.[0]?.extensions?.code
      if (code === 'PENDING_INVOICES') setRefusedForInvoices(true)
      return
    }

    toast.success(`${organisation.name} is scheduled for deletion`)
    dialogRef.current?.closeModal()
    router.push('/')
  }

  return (
    <div className="p-4 py-6 rounded-lg ring-1 ring-inset ring-red-500/40 bg-red-500/5">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Delete Organisation</h3>
          <p className="text-sm text-neutral-500">
            Lock this organisation now and permanently delete it, with all of its data, after{' '}
            {GRACE_PERIOD_DAYS} days.
          </p>
        </div>
        <GenericDialog
          title="Delete organisation"
          ref={dialogRef}
          buttonVariant="danger"
          buttonContent="Delete Organisation"
          buttonProps={{ icon: FaTrash }}
          onOpen={() => {
            if (isCloudHosted()) checkInvoices({ variables: { organisationId: organisation.id } })
          }}
          onClose={() => {
            setTypedName('')
            setRefusedForInvoices(false)
          }}
        >
          <form onSubmit={handleSubmit} className="space-y-6 pt-4">
            <Alert variant="danger" icon={true}>
              <p>
                Are you sure you want to permanently delete{' '}
                <span className="font-semibold">{organisation.name}</span>?
              </p>
            </Alert>
            {pendingInvoices && (
              <Alert variant="warning" icon={true}>
                <p>
                  You have pending invoices. Please pay them before this organisation can be
                  deleted.
                </p>
              </Alert>
            )}

            <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
              <li>
                Access to your organisation from all clients, including the Console, CLI, API and
                SDKs, will be blocked immediately. Secret syncs and secret rotations will stop, and
                secrets and all other platform assets will be locked and can no longer be accessed
                or modified.
              </li>
              <li>
                In {GRACE_PERIOD_DAYS} days, the organisation and all associated data will be
                permanently deleted. Until then, you can restore it from the organisation list.
              </li>
              {paidPlanName && (
                <li>
                  Your {paidPlanName} subscription won&apos;t renew, and will be cancelled when the
                  organisation is deleted.
                </li>
              )}
            </ul>

            <div className="space-y-2">
              <label htmlFor="confirm-organisation-name" className="block text-sm text-neutral-500">
                Type{' '}
                <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                  {organisation.name}
                </span>{' '}
                to confirm:
              </label>
              <input
                id="confirm-organisation-name"
                className="w-full ph-no-capture"
                autoComplete="off"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="secondary"
                onClick={() => dialogRef.current?.closeModal()}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="danger"
                icon={FaTrash}
                isLoading={loading}
                disabled={!nameMatches || pendingInvoices}
              >
                Delete organisation
              </Button>
            </div>
          </form>
        </GenericDialog>
      </div>
    </div>
  )
}
