import { FaClock, FaCog, FaEdit, FaTimes, FaTrash, FaUserCog } from 'react-icons/fa'
import GenericDialog from '../common/GenericDialog'
import { EnvironmentType, OrganisationMemberType } from '@/apollo/graphql'
import { Input } from '../common/Input'
import { Fragment, useContext, useId, useState } from 'react'
import { Button } from '../common/Button'
import { Alert } from '../common/Alert'
import { Checkbox } from '../common/Checkbox'
import { RenameEnv } from '@/graphql/mutations/environments/renameEnvironment.gql'
import { DeleteEnv } from '@/graphql/mutations/environments/deleteEnvironment.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetDeletedEnvironments } from '@/graphql/queries/secrets/getDeletedEnvironments.gql'
import { DELETION_GRACE_PERIOD } from '@/constants'
import { scheduledDeletionDate } from '@/utils/organisation'
import { useMutation, useQuery } from '@apollo/client'
import { Dialog, Transition } from '@headlessui/react'
import { toast } from 'react-toastify'
import { Avatar } from '../common/Avatar'
import Link from 'next/link'
import { organisationContext } from '@/contexts/organisationContext'
import { isCloudHosted } from '@/utils/appConfig'
import { UpgradeRequestForm } from '../forms/UpgradeRequestForm'
import { useAppPermissions } from '@/hooks/useAppPermissions'
import { defaultEnvColor, sanitizeInput } from '@/utils/environment'
import { ColorPicker } from '../common/ColorPicker'
import { ToggleSwitch } from '../common/ToggleSwitch'

const RenameEnvironment = (props: { environment: EnvironmentType }) => {
  // Team-aware, as the grid's own checks are: access through a team can carry its own role in this app
  const { hasPermission } = useAppPermissions(props.environment.app.id)
  const userCanUpdateEnvironments = hasPermission('Environments', 'update', true)

  const allowRename = userCanUpdateEnvironments

  const nameId = useId()
  const primaryId = useId()
  const [name, setName] = useState(props.environment?.name || '')
  // '' = auto: the server stores null and clients derive a color from the name
  const [color, setColor] = useState(props.environment?.color || '')
  const wasPrimary = Boolean(props.environment.isPrimary)
  const [isPrimary, setIsPrimary] = useState(wasPrimary)

  // The App's current primary environment, which this one would take over from
  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: { appId: props.environment.app.id },
  })
  const currentPrimary = ((appEnvsData?.appEnvironments ?? []) as EnvironmentType[]).find(
    (env) => env.isPrimary && env.id !== props.environment.id
  )

  const [renameEnvironment] = useMutation(RenameEnv)

  const unchanged =
    name === props.environment.name &&
    (color || '') === (props.environment.color || '') &&
    isPrimary === wasPrimary

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const { data } = await renameEnvironment({
      variables: {
        environmentId: props.environment?.id,
        name,
        color: color || null,
        // Unchanged is left out, so the server doesn't touch the designation
        isPrimary: isPrimary === wasPrimary ? null : isPrimary,
      },
      refetchQueries: [
        { query: GetAppEnvironments, variables: { appId: props.environment.app.id } },
        // The secrets grid's marker for values repeating the primary environment's, when it's mounted
        'GetAppSecrets',
      ],
    })

    if (!data) {
      return
    }
    toast.success('Environment updated!')
  }

  return (
    <form className="space-y-4 py-4" onSubmit={handleSubmit}>
      <div>
        <h4 className="font-medium text-zinc-900 dark:text-zinc-100">Environment settings</h4>
        <p className="text-neutral-500 text-sm">
          Update the name and color of this Environment, and whether it is the App&apos;s primary
          one
        </p>
      </div>
      <Alert variant="info" size="sm">
        {allowRename
          ? 'Changing the name of this Environment will affect how you construct references to secrets.'
          : "You don't have the permissions required to rename this Environment"}
      </Alert>

      <div className="space-y-2">
        <label htmlFor={nameId} className="block text-xs text-neutral-500">
          Environment name<span className="ml-1 text-red-500">*</span>
        </label>
        {/* The label is outside the row and the swatch has no line height, so it centres on the field */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Input
              id={nameId}
              value={sanitizeInput(name)}
              setValue={setName}
              required
              maxLength={32}
              disabled={!allowRename}
            />
          </div>
          <div className="leading-[0]" title="Environment color">
            <ColorPicker
              color={
                color || defaultEnvColor({ ...props.environment, name: name || props.environment.name })
              }
              setColor={setColor}
              disabled={!userCanUpdateEnvironments}
            />
          </div>
        </div>
        {allowRename && (
          <p className="text-xs text-neutral-500">
            Use up to 32 characters. Only letters, numbers, hyphens, and underscores are allowed.
          </p>
        )}
      </div>

      <div className="flex items-start justify-between gap-4 rounded-md p-3 ring-1 ring-inset ring-neutral-500/20">
        <div className="space-y-1">
          <label
            htmlFor={primaryId}
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            Primary environment
          </label>
          <p className="text-xs text-neutral-500">
            The App&apos;s main environment, like a repository&apos;s main branch. Secret values
            that other Environments share with it are marked in the editor.
            {isPrimary && !wasPrimary && currentPrimary
              ? ` This takes over from ${currentPrimary.name}.`
              : ''}
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          <ToggleSwitch
            id={primaryId}
            value={isPrimary}
            onToggle={() => setIsPrimary((on) => !on)}
            disabled={!userCanUpdateEnvironments}
          />
        </div>
      </div>

      {userCanUpdateEnvironments && (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={unchanged}>
            <FaEdit /> Save
          </Button>
        </div>
      )}
    </form>
  )
}

export const DeleteEnvironment = (props: { environment: EnvironmentType }) => {
  const { hasPermission } = useAppPermissions(props.environment.app.id)
  const userCanDeleteEnvironments = hasPermission('Environments', 'delete', true)

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [name, setName] = useState('')
  const [immediately, setImmediately] = useState<boolean>(false)
  const [scheduledFor, setScheduledFor] = useState<string>('')

  const closeModal = () => {
    setIsOpen(false)
    setImmediately(false)
    // The typed confirmation must not carry over to the next time it opens.
    setName('')
  }

  const openModal = () => {
    setScheduledFor(scheduledDeletionDate())
    setIsOpen(true)
  }

  const [deleteEnvironment, { loading }] = useMutation(DeleteEnv)

  const handleDelete = async () => {
    await deleteEnvironment({
      variables: {
        environmentId: props.environment?.id,
        immediately,
      },
      refetchQueries: [
        { query: GetAppEnvironments, variables: { appId: props.environment.app.id } },
        { query: GetDeletedEnvironments, variables: { appId: props.environment.app.id } },
        // The secrets grid's columns, when it's mounted
        'GetAppSecrets',
      ],
    })
    toast.success(
      immediately ? 'Environment is being deleted' : 'Environment scheduled for deletion'
    )
    closeModal()
  }

  if (!userCanDeleteEnvironments) return <></>

  return (
    <div className="space-y-4 pt-4">
      <div>
        <h4 className="font-medium text-zinc-900 dark:text-zinc-100">Delete Environment</h4>
        <p className="text-neutral-500 text-sm">
          Delete this Environment, and all associated Secrets and Integrations. It is kept for{' '}
          {DELETION_GRACE_PERIOD} and can be restored, unless you choose to delete it immediately.
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
                      {immediately ? (
                        <div className="space-y-1">
                          <p className="font-bold">This Environment will be deleted immediately</p>
                          <p>
                            All Secrets and Integrations associated with it are permanently deleted.
                            This cannot be undone.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="font-bold">
                            This Environment will be deleted in {DELETION_GRACE_PERIOD}, on{' '}
                            {scheduledFor}
                          </p>
                          <p>
                            It becomes unavailable straight away, along with all Secrets and
                            Integrations associated with it. You can restore it until then. Its name
                            cannot be reused until it has been deleted.
                          </p>
                        </div>
                      )}
                    </Alert>
                    <Checkbox
                      checked={immediately}
                      onChange={setImmediately}
                      label="Delete immediately. The Environment cannot be restored."
                    />
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
                        icon={immediately ? FaTrash : FaClock}
                        onClick={handleDelete}
                        isLoading={loading}
                        disabled={name !== props.environment?.name}
                      >
                        {immediately ? 'Delete now' : 'Schedule for deletion'}
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

  // Read again on opening: the grid's column keeps the environment as it first loaded
  const { data } = useQuery(GetAppEnvironments, {
    variables: { appId: props.environment.app.id },
    fetchPolicy: 'cache-and-network',
  })
  const current = (data?.appEnvironments as EnvironmentType[] | undefined)?.find(
    (env) => env.id === props.environment.id
  )
  const members = (current ?? props.environment).members

  return (
    <div className="space-y-4 py-4">
      <div>
        <h4 className="font-medium text-zinc-900 dark:text-zinc-100">Environment Members</h4>
        <p className="text-neutral-500 text-sm">
          The following users have access to Secrets in this Environment
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {/* The list has an empty entry for each service account's key */}
        {members?.map(
          (member) =>
            member && (
              <div key={member.email} title={member.fullName || member.email || ''}>
                <Avatar member={member} size="md" />
              </div>
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

export const ManageEnvironmentDialog = (props: {
  environment: EnvironmentType
  buttonVariant?: 'secondary' | 'ghost'
}) => {
  return (
    <GenericDialog
      title={`Manage ${props.environment.name}`}
      onClose={() => {}}
      buttonVariant={props.buttonVariant ?? 'secondary'}
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
