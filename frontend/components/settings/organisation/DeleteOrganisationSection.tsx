'use client'

import { useContext, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaTrash } from 'react-icons/fa'
import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { DeleteOrganisationOp } from '@/graphql/mutations/organisation/deleteOrganisation.gql'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { isCloudHosted } from '@/utils/appConfig'

// Mirrors GRACE_PERIOD in backend/api/utils/organisation_deletion.py
const GRACE_PERIOD_DAYS = 7

const DELETED_DATA = [
  'All apps, environments, secrets and secret history',
  'Members, invites, teams, roles and network access policies',
  'Service accounts and all access tokens',
  'Integrations: syncs stop and saved third-party credentials are deleted. Secrets already synced to other services stay there.',
  'Dynamic secrets: active leases are revoked at the provider',
  'Rotating secrets: active credentials are revoked at the provider',
  'Log streams, SSO and SCIM configuration',
  'Audit logs and secret access logs',
]

export const DeleteOrganisationSection = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const router = useRouter()
  const [typedName, setTypedName] = useState('')

  const [deleteOrganisation, { loading }] = useMutation(DeleteOrganisationOp)

  if (!organisation) return null

  const nameMatches = typedName === organisation.name
  const hasPaidCloudPlan = isCloudHosted() && organisation.plan !== ApiOrganisationPlanChoices.Fr

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (!nameMatches) return

    try {
      await deleteOrganisation({ variables: { organisationId: organisation.id } })
    } catch {
      return // the global error link shows the error toast
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
          onClose={() => setTypedName('')}
        >
          <form onSubmit={handleSubmit} className="space-y-6 pt-4">
            <Alert variant="danger" icon={true}>
              <p>
                <span className="font-semibold">{organisation.name}</span> will be locked
                immediately and permanently deleted after {GRACE_PERIOD_DAYS} days.
              </p>
            </Alert>

            <div className="space-y-2 text-sm">
              <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">What happens now</h4>
              <ul className="list-disc space-y-1 pl-5 text-neutral-500">
                <li>
                  Nobody can open the organisation. Access tokens, service accounts, SCIM and
                  external identities stop working, so apps and CI pipelines can&apos;t fetch
                  secrets.
                </li>
                <li>
                  You can restore it from the organisation list within {GRACE_PERIOD_DAYS} days.
                </li>
                {hasPaidCloudPlan && (
                  <li>
                    Your subscription is set to cancel at the end of the current billing period.
                    Restoring the organisation resumes it.
                  </li>
                )}
              </ul>
            </div>

            <div className="space-y-2 text-sm">
              <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">
                What is permanently deleted after {GRACE_PERIOD_DAYS} days
              </h4>
              <ul className="list-disc space-y-1 pl-5 text-neutral-500">
                {DELETED_DATA.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

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
                disabled={!nameMatches}
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
