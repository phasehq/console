import UpdateEnvScope from '@/graphql/mutations/apps/updateEnvScope.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { OrganisationMemberType, EnvironmentType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { Dialog, Listbox, Transition } from '@headlessui/react'
import {
  FaCheckCircle,
  FaCheckSquare,
  FaChevronDown,
  FaCircle,
  FaCog,
  FaSquare,
  FaTimes,
} from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { useSession } from 'next-auth/react'
import { KeyringContext } from '@/contexts/keyringContext'
import { userHasGlobalAccess, userHasPermission } from '@/utils/access/permissions'
import { Alert } from '@/components/common/Alert'
import Link from 'next/link'
import { unwrapEnvSecretsForUser, wrapEnvSecretsForAccount } from '@/utils/crypto'
import GenericDialog from '@/components/common/GenericDialog'

export const ManageUserAccessDialog = ({
  member,
  appId,
}: {
  member: OrganisationMemberType
  appId: string
}) => {
  const { keyring } = useContext(KeyringContext)
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { data: session } = useSession()

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  // Permissions
  // AppMembers:update + Environments:read
  const userCanUpdateMemberAccess = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'update', true) &&
      userHasPermission(organisation?.role?.permissions, 'Environments', 'read', true)
    : false

  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)
  const [updateScope] = useMutation(UpdateEnvScope)

  // Get environments that the active user has access to
  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId: appId,
    },
  })

  // Get the environemnts that the member has access to
  const { data: userEnvScopeData } = useQuery(GetAppEnvironments, {
    variables: {
      appId: appId,
      memberId: member.id,
    },
  })

  const envScope: Array<Record<string, string>> = useMemo(() => {
    return (
      userEnvScopeData?.appEnvironments.map((env: EnvironmentType) => ({
        id: env.id,
        name: env.name,
      })) ?? []
    )
  }, [userEnvScopeData])

  const envOptions =
    appEnvsData?.appEnvironments.map((env: EnvironmentType) => {
      const { id, name } = env

      return {
        id,
        name,
      }
    }) ?? []

  const [scope, setScope] = useState<Array<Record<string, string>>>([])
  const [showEnvHint, setShowEnvHint] = useState<boolean>(false)

  const memberHasGlobalAccess = (user: OrganisationMemberType) =>
    userHasGlobalAccess(user.role?.permissions)

  const closeModal = () => dialogRef.current?.closeModal()

  useEffect(() => {
    setScope(envScope)
  }, [envScope])

  const handleUpdateScope = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (scope.length === 0) {
      setShowEnvHint(true)
      return false
    }

    const appEnvironments = appEnvsData.appEnvironments as EnvironmentType[]

    const envKeyPromises = appEnvironments
      .filter((env) => scope.map((selectedEnv) => selectedEnv.id).includes(env.id))
      .map(async (env: EnvironmentType) => {
        const { data } = await getEnvKey({
          variables: {
            envId: env.id,
            appId: appId,
          },
        })

        const {
          wrappedSeed: userWrappedSeed,
          wrappedSalt: userWrappedSalt,
          identityKey,
        } = data.environmentKeys[0]

        const { seed, salt } = await unwrapEnvSecretsForUser(
          userWrappedSeed,
          userWrappedSalt,
          keyring!
        )

        const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForAccount({ seed, salt }, member!)

        return {
          envId: env.id,
          userId: member!.id,
          identityKey,
          wrappedSeed,
          wrappedSalt,
        }
      })

    const envKeyInputs = await Promise.all(envKeyPromises)

    await updateScope({
      variables: { memberId: member!.id, appId: appId, envKeys: envKeyInputs },
      refetchQueries: [
        {
          query: GetAppEnvironments,
          variables: {
            appId: appId,
            memberId: member.id,
          },
        },
      ],
    })

    toast.success('Updated user access', { autoClose: 2000 })
  }

  const allowUpdateScope =
    member.email !== session?.user?.email &&
    member.role!.name!.toLowerCase() !== 'owner' &&
    userCanUpdateMemberAccess

  return (
    <div className="flex items-center gap-4">
      <span className="text-zinc-900 dark:text-zinc-100 text-sm font-medium">
        {envScope.map((env) => env.name).join(' + ')}
      </span>
      <div className="opacity-0 group-hover:opacity-100 transition ease flex items-center gap-2">
        <GenericDialog
          ref={dialogRef}
          title={`Manage access for ${member.fullName || member.email}`}
          buttonVariant="secondary"
          buttonContent={
            allowUpdateScope && (
              <>
                <FaCog /> Manage
              </>
            )
          }
        >
          <form className="space-y-6 py-4" onSubmit={handleUpdateScope}>
            {memberHasGlobalAccess(member) && (
              <Alert variant="info" icon={true} size="sm">
                <p>
                  This user&apos;s role grants them access to all environments in this App. To
                  restrict their access, change their role from the{' '}
                  <Link
                    className="font-semibold hover:underline"
                    href={`/${organisation?.name}/access/members`}
                  >
                    organisation members
                  </Link>{' '}
                  page.
                </p>
              </Alert>
            )}
            <div className="space-y-1 w-full relative">
              {scope.length === 0 && showEnvHint && (
                <span className="absolute right-2 inset-y-0 text-red-500 text-xs">
                  Select an environment scope
                </span>
              )}
              <Listbox
                value={scope}
                by="id"
                onChange={setScope}
                multiple
                name="environments"
                disabled={memberHasGlobalAccess(member)}
              >
                {({ open }) => (
                  <>
                    <Listbox.Label as={Fragment}>
                      <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="name">
                        Environment scope
                      </label>
                    </Listbox.Label>
                    <Listbox.Button as={Fragment} aria-required>
                      <div
                        className={clsx(
                          'p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 border border-neutral-500/40 rounded-md h-10',
                          memberHasGlobalAccess(member) ? 'cursor-not-allowed' : 'cursor-pointer'
                        )}
                      >
                        <span className="text-zinc-900 dark:text-zinc-100 text-sm">
                          {scope.map((env: Partial<EnvironmentType>) => env.name).join(' + ')}
                        </span>
                        <FaChevronDown
                          className={clsx(
                            'transition-transform ease duration-300 text-neutral-500',
                            open ? 'rotate-180' : 'rotate-0'
                          )}
                        />
                      </div>
                    </Listbox.Button>
                    <Transition
                      enter="transition duration-100 ease-out"
                      enterFrom="transform scale-95 opacity-0"
                      enterTo="transform scale-100 opacity-100"
                      leave="transition duration-75 ease-out"
                      leaveFrom="transform scale-100 opacity-100"
                      leaveTo="transform scale-95 opacity-0"
                    >
                      <Listbox.Options>
                        <div className="bg-neutral-200 dark:bg-neutral-800 p-2 rounded-md border border-neutral-500/40 shadow-2xl absolute z-10 w-full divide-y divide-neutral-500/20">
                          {envOptions.map((env: Partial<EnvironmentType>) => (
                            <Listbox.Option key={env.id} value={env} as={Fragment}>
                              {({ active, selected }) => (
                                <div
                                  className={clsx(
                                    'flex items-center gap-2 p-1 cursor-pointer text-sm rounded-sm transition ease',
                                    active
                                      ? 'text-zinc-900 dark:text-zinc-100 bg-neutral-100 dark:bg-neutral-700'
                                      : '',
                                    selected && 'text-zinc-900 dark:text-zinc-100'
                                  )}
                                >
                                  {selected ? (
                                    <FaCheckCircle className="text-emerald-500" />
                                  ) : (
                                    <FaCircle />
                                  )}
                                  <div>{env.name}</div>
                                </div>
                              )}
                            </Listbox.Option>
                          ))}
                        </div>
                      </Listbox.Options>
                    </Transition>
                  </>
                )}
              </Listbox>
            </div>
            <div className="flex items-center gap-4 justify-between">
              <Button variant="secondary" type="button" onClick={closeModal}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={memberHasGlobalAccess(member)}>
                Save
              </Button>
            </div>
          </form>
        </GenericDialog>
      </div>
    </div>
  )
}
