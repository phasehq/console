import { FaCog, FaEdit, FaTimes, FaTrash, FaUserCog } from 'react-icons/fa'
import GenericDialog from '../common/GenericDialog'
import {
  ApiOrganisationPlanChoices,
  EnvironmentType,
  OrganisationMemberType,
} from '@/apollo/graphql'
import { Input } from '../common/Input'
import { Fragment, useContext, useState } from 'react'
import { Button } from '../common/Button'
import { Alert } from '../common/Alert'
import { RenameEnv } from '@/graphql/mutations/environments/renameEnvironment.gql'
import { DeleteEnv } from '@/graphql/mutations/environments/deleteEnvironment.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { useMutation } from '@apollo/client'
import { Dialog, Transition } from '@headlessui/react'
import { toast } from 'react-toastify'
import { Avatar } from '../common/Avatar'
import Link from 'next/link'
import { organisationContext } from '@/contexts/organisationContext'
import { isCloudHosted } from '@/utils/appConfig'
import { UpgradeRequestForm } from '../forms/UpgradeRequestForm'
import { UpsellDialog } from '../settings/organisation/UpsellDialog'
import { userHasPermission } from '@/utils/access/permissions'
import { sanitizeInput } from '@/utils/environment'

const RenameEnvironment = (props: { environment: EnvironmentType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanUpdateEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'update',
    true
  )

  const allowRename =
    organisation?.plan !== ApiOrganisationPlanChoices.Fr && userCanUpdateEnvironments

  const [name, setName] = useState(props.environment?.name || '')

  const [renameEnvironment] = useMutation(RenameEnv)

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const { data } = await renameEnvironment({
      variables: { environmentId: props.environment?.id, name },
      refetchQueries: [
        { query: GetAppEnvironments, variables: { appId: props.environment.app.id } },
      ],
    })

    if (!data) {
      return
    }
    toast.success('Environment renamed!')
  }

  return (
    <form className="space-y-4 py-4" onSubmit={handleSubmit}>
      <div>
        <h4 className="font-medium text-zinc-900 dark:text-zinc-100">Rename Environment</h4>
        <p className="text-neutral-500">Update the name of this Environment</p>
      </div>
      <Alert variant="info" size="sm">
        {allowRename
          ? 'Changing the name of this Environment will affect how you construct references to secrets.'
          : organisation?.plan === ApiOrganisationPlanChoices.Fr
            ? 'Upgrade to Pro to rename Environments'
            : "You don't have the permissions required to rename this Environment"}
      </Alert>
      <Input
        value={sanitizeInput(name)}
        setValue={setName}
        label="Environment name"
        required
        disabled={!allowRename}
      />
      {allowRename && (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={name === props.environment.name}>
            <FaEdit /> Rename
          </Button>
        </div>
      )}
    </form>
  )
}

const DeleteEnvironment = (props: { environment: EnvironmentType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanDeleteEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'delete',
    true
  )

  const planDisplay = {
    planName: 'Free',
    dialogTitle: 'Upgrade to Pro',
    description: `The Free plan does not have access to custom environments. To delete, rename or create Environments, please upgrade to Pro.`,
  }

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [name, setName] = useState('')

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const allowedByPlan = organisation?.plan !== ApiOrganisationPlanChoices.Fr

  const [deleteEnvironment, { loading }] = useMutation(DeleteEnv)

  const handleDelete = async () => {
    await deleteEnvironment({
      variables: {
        environmentId: props.environment?.id,
      },
      refetchQueries: [
        { query: GetAppEnvironments, variables: { appId: props.environment.app.id } },
      ],
    })
    toast.success('Environment deleted!')
    closeModal()
  }

  if (!allowedByPlan)
    return (
      <div className="flex justify-end pt-4">
        <UpsellDialog
          title="Upgrade to Pro to customize environments"
          buttonLabel={
            <>
              <FaTrash /> Delete
            </>
          }
          buttonVariant="danger"
        />
      </div>
    )

  if (!userCanDeleteEnvironments) return <></>

  return (
    <div className="space-y-4 pt-4">
      <div>
        <h4 className="font-medium text-zinc-900 dark:text-zinc-100">Delete Environment</h4>
        <p className="text-neutral-500">
          Permanently delete this Environment and all associated Secrets and Integrations.
        </p>
      </div>

      <div className="flex justify-end">
        <Button variant="danger" onClick={openModal}>
          <FaTrash /> Delete
        </Button>
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
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Delete {props.environment.name}
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6 py-4">
                    <p className="text-neutral-500">
                      Are you sure you want to delete this environment?
                    </p>
                    <Alert variant="danger" size="sm">
                      Deleting this Environment will permanently delete all Secrets and Integrations
                      associated with it. This action cannot be undone!
                    </Alert>
                    <div>
                      <p className="text-zinc-900 dark:text-zinc-100">
                        Type{' '}
                        <span className="font-semibold pointer-events-none text-red-500">
                          {props.environment.name}
                        </span>{' '}
                        to confirm.
                      </p>
                      <Input value={name} setValue={setName} label="Environment name" required />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Button variant="secondary" type="button" onClick={closeModal}>
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        onClick={handleDelete}
                        isLoading={loading}
                        disabled={name !== props.environment?.name}
                      >
                        <FaTrash /> Delete
                      </Button>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  )
}

const EnvironmentMembers = (props: { environment: EnvironmentType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  return (
    <div className="space-y-4 py-4">
      <div>
        <h4 className="font-medium text-zinc-900 dark:text-zinc-100">Environment Members</h4>
        <p className="text-neutral-500">
          The following users have access to Secrets in this Environment
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {props.environment.members?.map((member) =>
          member ? (
            <div key={member.email} title={member.fullName || member.email || ''}>
              <Avatar member={member} size="lg" />
            </div>
          ) : (
            <></>
          )
        )}
      </div>

      {organisation && (
        <div className="flex justify-end">
          <Link href={`/${organisation.name}/apps/${props.environment.app.id}/access/members`}>
            <Button variant="primary">
              <FaUserCog /> Manage access
            </Button>
          </Link>
        </div>
      )}
    </div>
  )
}

export const ManageEnvironmentDialog = (props: { environment: EnvironmentType }) => {
  return (
    <GenericDialog
      title={`Manage ${props.environment.name}`}
      onClose={() => {}}
      buttonVariant={'secondary'}
      buttonContent={
        <div className="py-1">
          <FaCog />
        </div>
      }
    >
      <div className="space-y-4 divide-y divide-neutral-500/40">
        <RenameEnvironment environment={props.environment} />
        <EnvironmentMembers environment={props.environment} />
        <DeleteEnvironment environment={props.environment} />
      </div>
    </GenericDialog>
  )
}
