import { ApiOrganisationPlanChoices, OrganisationMemberType, RoleType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Fragment, useContext, useEffect, useRef, useState } from 'react'
import { FaChevronDown, FaLock, FaPlus, FaUsersCog } from 'react-icons/fa'
import { userCanGrantRoleFromAny } from '@/utils/access/permissions'
import { isHandledGraphQLError } from '@/utils/errors'
import { AssignableRoleOption } from '@/components/access/AssignableRoleOption'
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { GetServiceAccountHandlers } from '@/graphql/queries/service-accounts/getServiceAccountHandlers.gql'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { GetServerKey } from '@/graphql/queries/syncing/getServerKey.gql'
import { CreateServiceAccountOp } from '@/graphql/mutations/service-accounts/createServiceAccount.gql'
import { GetOrganisationPlan } from '@/graphql/queries/organisation/getOrganisationPlan.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { useMutation, useQuery } from '@apollo/client'
import {
  organisationSeed,
  organisationKeyring,
  getUserKxPublicKey,
  encryptAsymmetric,
} from '@/utils/crypto'
import { Input } from '@/components/common/Input'
import { RoleLabel } from '@/components/users/RoleLabel'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'
import { isCloudHosted } from '@/utils/appConfig'
import { UpsellDialog } from '@/components/settings/organisation/UpsellDialog'

const bip39 = require('bip39')

export const CreateServiceAccountDialog = ({
  teamId,
  teamName,
  teamRole,
  teamMemberRole,
}: {
  teamId?: string
  teamName?: string
  teamRole?: RoleType | null
  teamMemberRole?: RoleType | null
} = {}) => {
  const isTeamContext = !!teamId
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: roleData, loading: roleDataPending } = useQuery(GetRoles, {
    variables: { orgId: organisation?.id },
    skip: !organisation,
  })

  const { data: serviceAccountHandlerData } = useQuery(GetServiceAccountHandlers, {
    variables: { orgId: organisation?.id },
    skip: !organisation,
  })

  const { data } = useQuery(GetOrganisationPlan, {
    variables: { organisationId: organisation?.id },
    fetchPolicy: 'cache-and-network',
    skip: !organisation,
  })

  const [createServiceAccount] = useMutation(CreateServiceAccountOp)

  const { data: serverKeyData } = useQuery(GetServerKey)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [name, setName] = useState('')
  const [role, setRole] = useState<RoleType | null>(null)
  const [thirdParty, setThirdParty] = useState(false)
  const [createPending, setCreatePending] = useState(false)

  const reset = () => {
    setName('')
    setThirdParty(false)
  }

  const upsell =
    isCloudHosted() &&
    organisation?.plan === ApiOrganisationPlanChoices.Fr &&
    data?.organisationPlan.seatsUsed.total === data?.organisationPlan.maxUsers

  const roleOptions =
    roleData?.roles.filter(
      (option: RoleType) => option.name !== 'Owner' && option.name !== 'Admin'
    ) || []

  // Grant ceiling: union of the viewer's org role and, in team context,
  // the team's member role override — mirrors the backend rule
  const actorPolicyJsons = [
    organisation?.role?.permissions ?? '',
    ...(isTeamContext && teamMemberRole?.permissions ? [teamMemberRole.permissions] : []),
  ]

  const roleIsAssignable = (option: RoleType) =>
    userCanGrantRoleFromAny(actorPolicyJsons, option.permissions ?? '')

  // The team-fixed role is not selectable, so submit must be gated instead
  const teamRoleAssignable = teamRole ? roleIsAssignable(teamRole) : true

  useEffect(() => {
    if (isTeamContext && teamRole) {
      setRole(teamRole)
    } else if (roleData?.roles) {
      const defaultRole = roleData?.roles.find(
        (role: RoleType) => role.name?.toLowerCase() === 'service'
      )
      if (defaultRole && roleIsAssignable(defaultRole)) setRole(defaultRole)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    roleData,
    isTeamContext,
    teamRole,
    organisation?.role?.permissions,
    teamMemberRole?.permissions,
  ])

  const handleCreateServiceAccount = (e: { preventDefault: () => void }) => {
    return new Promise<boolean>((resolve) => {
      e.preventDefault()

      if (!role) {
        toast.error('Please select a role for the service account')
        resolve(false)
        return
      }

      setCreatePending(true)
      setTimeout(async () => {
        try {
          // Compute new keys for service account
          const mnemonic = bip39.generateMnemonic(256)
          const accountSeed = await organisationSeed(mnemonic, organisation!.id)
          const keyring = await organisationKeyring(accountSeed)

          // Wrap keys for server if required.
          // Team-owned SAs always enable SSK so all team members can generate tokens server-side.
          let serverKeys = undefined
          if (thirdParty || isTeamContext) {
            const serverKey = serverKeyData.serverPublicKey

            const serverEncryptedKeyring = await encryptAsymmetric(
              JSON.stringify(keyring),
              serverKey
            )

            const serverEncryptedMnemonic = await encryptAsymmetric(mnemonic, serverKey)

            serverKeys = {
              serverEncryptedKeyring,
              serverEncryptedMnemonic,
            }
          }

          // Wrap keys for service account handlers
          const handlers: OrganisationMemberType[] =
            serviceAccountHandlerData.serviceAccountHandlers

          const handlerWrappingPromises = handlers.map(async (handler) => {
            const kxKey = await getUserKxPublicKey(handler.identityKey!)
            const wrappedKeyring = await encryptAsymmetric(JSON.stringify(keyring), kxKey)
            const wrappedRecovery = await encryptAsymmetric(mnemonic, kxKey)
            return {
              memberId: handler.id,
              wrappedKeyring,
              wrappedRecovery,
            }
          })

          const handlerKeys = await Promise.all(handlerWrappingPromises)

          await createServiceAccount({
            variables: {
              name,
              orgId: organisation!.id,
              roleId: role.id,
              identityKey: keyring.publicKey,
              serverWrappedKeyring: serverKeys?.serverEncryptedKeyring || null,
              serverWrappedRecovery: serverKeys?.serverEncryptedMnemonic || null,
              handlers: handlerKeys,
              teamId: teamId || null,
            },
            refetchQueries: [
              {
                query: GetServiceAccounts,
                variables: { orgId: organisation!.id },
              },
              ...(teamId
                ? [
                    {
                      query: GetTeams,
                      variables: { organisationId: organisation!.id, teamId },
                    },
                  ]
                : []),
            ],
            awaitRefetchQueries: true,
          })

          reset()

          if (dialogRef.current) dialogRef.current.closeModal()

          toast.success('Created new service account!')

          resolve(true)
        } catch (error) {
          // The global errorLink surfaces the server error (e.g. grant-ceiling violations)
          if (!isHandledGraphQLError(error)) toast.error('Something went wrong')
          resolve(false)
        } finally {
          setCreatePending(false)
        }
      }, 500)
    })
  }

  const buttonLabel = isTeamContext ? 'Create Team Service Account' : 'Create Service Account'
  const dialogTitle = isTeamContext
    ? 'Create a Team Service Account'
    : 'Create a new Service Account'

  if (upsell)
    return (
      <UpsellDialog
        buttonLabel={
          <>
            <FaPlus /> {buttonLabel}
          </>
        }
      />
    )

  return (
    <GenericDialog
      title={dialogTitle}
      buttonContent={
        <>
          {isTeamContext ? <FaUsersCog /> : <FaPlus />} {buttonLabel}
        </>
      }
      buttonVariant="primary"
      size="md"
      ref={dialogRef}
    >
      <form onSubmit={handleCreateServiceAccount} className="pt-4">
        <div className="space-y-6">
          {isTeamContext && (
            <Alert variant="info" icon size="sm">
              <span className="text-xs">
                This service account will be owned by <strong>{teamName}</strong> and only visible
                to team members.
              </span>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-6">
            <Input value={name} setValue={setName} label="Account name" required maxLength={32} />
            <div className="space-y-1 w-full">
              <label className="block text-neutral-500 text-sm mb-2" htmlFor="role">
                Role
              </label>
              {isTeamContext && teamRole ? (
                <div className="py-2 flex items-center gap-2 h-10">
                  <RoleLabel role={teamRole} />
                  <span className="text-2xs text-neutral-500">(set by team)</span>
                  {!teamRoleAssignable && (
                    <span className="flex items-center gap-1 text-2xs whitespace-nowrap text-neutral-500">
                      <FaLock /> Exceeds your permissions
                    </span>
                  )}
                </div>
              ) : (
                <Listbox value={role} onChange={setRole} name="role">
                  {({ open }) => (
                    <>
                      <Listbox.Button as={Fragment} aria-required>
                        <div
                          className={clsx(
                            'py-2 flex items-center gap-4 w-full rounded-md h-10 cursor-pointer'
                          )}
                        >
                          {role ? <RoleLabel role={role} /> : <>Select a role</>}
                          <FaChevronDown
                            className={clsx(
                              'transition-transform ease duration-300 text-neutral-500',
                              open ? 'rotate-180' : 'rotate-0'
                            )}
                          />
                        </div>
                      </Listbox.Button>
                      <Listbox.Options className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10 w-max min-w-[15rem] focus:outline-none">
                        {roleOptions.map((option: RoleType) => (
                          <AssignableRoleOption
                            key={option.name}
                            option={option}
                            assignable={roleIsAssignable(option)}
                          />
                        ))}
                      </Listbox.Options>
                    </>
                  )}
                </Listbox>
              )}
            </div>
          </div>
          {isTeamContext && teamRole && !teamRoleAssignable && (
            <Alert variant="warning" icon size="sm">
              <span className="text-xs">
                The team&apos;s service account role includes permissions you cannot grant, even
                with the team&apos;s member role. Ask an organisation admin to create this account,
                or change the team&apos;s service account role.
              </span>
            </Alert>
          )}
        </div>
        <div className="flex justify-end items-center gap-2 pt-6">
          <Button
            type="submit"
            variant="primary"
            isLoading={createPending}
            disabled={!role || !teamRoleAssignable}
          >
            {buttonLabel}
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}
