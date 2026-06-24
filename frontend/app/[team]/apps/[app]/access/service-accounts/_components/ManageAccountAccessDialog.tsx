'use client'

import UpdateEnvScope from '@/graphql/mutations/apps/updateEnvScope.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { GetMemberEnvKeyGrants } from '@/graphql/queries/access/getMemberEnvKeyGrants.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  EnvironmentType,
  ServiceAccountType,
  MemberType,
  ApiEnvironmentKeyGrantGrantTypeChoices,
} from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { Listbox, Transition } from '@headlessui/react'
import { FaCheckCircle, FaChevronDown, FaCircle, FaCog } from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { KeyringContext } from '@/contexts/keyringContext'
import { userHasGlobalAccess } from '@/utils/access/permissions'
import { useAppPermissions } from '@/hooks/useAppPermissions'
import { Alert } from '@/components/common/Alert'
import Link from 'next/link'
import { arraysEqual, unwrapEnvSecretsForUser, wrapEnvSecretsForAccount } from '@/utils/crypto'
import GenericDialog from '@/components/common/GenericDialog'
import { sortEnvs } from '@/utils/secrets'
import { useSearchParams } from 'next/navigation'

export const ManageAccountAccessDialog = ({
  account,
  appId,
  teams,
}: {
  account: ServiceAccountType
  appId: string
  teams?: { id: string; name: string }[]
}) => {
  const { keyring } = useContext(KeyringContext)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const searchParams = useSearchParams()
  const preselectedAccountId = searchParams?.get('manageAccount') ?? null

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  // Permissions
  const { hasPermission } = useAppPermissions(appId)

  // AppServiceAccounts:update + Environments:read
  const userCanUpdateSAAccess =
    hasPermission('ServiceAccounts', 'update', true) && hasPermission('Environments', 'read', true)

  const [updateScope] = useMutation(UpdateEnvScope)

  // Get environments that the active user has access to
  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId: appId,
    },
    fetchPolicy: 'cache-and-network',
  })

  // Get the environemnts that the account has access to
  const { data: accountEnvScopeData } = useQuery(GetAppEnvironments, {
    variables: {
      appId: appId,
      memberId: account.id,
      memberType: MemberType.Service,
    },
    fetchPolicy: 'cache-and-network',
  })

  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)

  // Per-env grants so we can colour env names by source.
  const { data: grantsData } = useQuery(GetMemberEnvKeyGrants, {
    variables: { appId, memberId: account.id, memberType: MemberType.Service },
  })

  // env_id -> { individual, team } presence flags. Envs the account
  // has no grant on are absent — don't conflate "no entry" with "team
  // only", or unsaved selections render as if team-granted.
  const envGrantSources = useMemo(() => {
    const map: Record<string, { individual: boolean; team: boolean }> = {}
    for (const ek of grantsData?.environmentKeys ?? []) {
      const envId = ek?.environment?.id
      if (!envId) continue
      const grants = ek.grants ?? []
      map[envId] = {
        individual: grants.some(
          (g: any) => g?.grantType === ApiEnvironmentKeyGrantGrantTypeChoices.Individual
        ),
        team: grants.some(
          (g: any) => g?.grantType === ApiEnvironmentKeyGrantGrantTypeChoices.Team
        ),
      }
    }
    return map
  }, [grantsData])

  const envScope: Array<Record<string, string>> = useMemo(() => {
    return (
      accountEnvScopeData?.appEnvironments.map((env: EnvironmentType) => ({
        id: env.id,
        name: env.name,
        index: env.index,
      })) ?? []
    )
  }, [accountEnvScopeData])

  const envOptions =
    appEnvsData?.appEnvironments.map((env: EnvironmentType) => {
      const { id, name, index } = env

      return {
        id,
        name,
        index,
      }
    }) ?? []

  const [scope, setScope] = useState<Array<Partial<EnvironmentType>>>([])
  const [showEnvHint, setShowEnvHint] = useState<boolean>(false)

  const scopeUpdated = !arraysEqual(
    scope.map((env) => env.id),
    envScope.map((env) => env.id)
  )

  const memberHasGlobalAccess = (account: ServiceAccountType) =>
    userHasGlobalAccess(account.role?.permissions)

  useEffect(() => {
    setScope(sortEnvs(envScope))
  }, [envScope])

  useEffect(() => {
    if (preselectedAccountId && preselectedAccountId === account.id) {
      dialogRef.current?.openModal()
    }
  }, [account.id, preselectedAccountId])

  const handleClose = () => {
    setScope(sortEnvs(envScope))
    dialogRef.current?.closeModal()
  }

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

        const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForAccount(
          { seed, salt },
          account!
        )

        return {
          envId: env.id,
          userId: account!.id,
          identityKey,
          wrappedSeed,
          wrappedSalt,
        }
      })

    const envKeyInputs = await Promise.all(envKeyPromises)

    await updateScope({
      variables: {
        memberId: account!.id,
        memberType: MemberType.Service,
        appId: appId,
        envKeys: envKeyInputs,
      },
      refetchQueries: [
        {
          query: GetAppEnvironments,
          variables: {
            appId: appId,
            memberId: account.id,
            memberType: MemberType.Service,
          },
        },
      ],
    })
    dialogRef.current?.closeModal()
    toast.success('Updated account access', { autoClose: 2000 })
  }

  const allowUpdateScope = userCanUpdateSAAccess

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-2xs font-medium">
          {envScope.map((env, i) => {
            // Blue (matches the team chip) for envs accessed via team
            // only; default zinc for direct individual access.
            const sources = env.id ? envGrantSources[env.id] : undefined
            const teamOnly = !!sources?.team && !sources?.individual
            return (
              <Fragment key={env.id ?? env.name}>
                <span
                  className={clsx(
                    teamOnly
                      ? 'text-neutral-500'
                      : 'text-zinc-900 dark:text-zinc-100'
                  )}
                  title={
                    teamOnly
                      ? `${env.name} — access via team`
                      : `${env.name} — direct access`
                  }
                >
                  {env.name}
                </span>
                {i < envScope.length - 1 && (
                  <span className="text-neutral-500"> + </span>
                )}
              </Fragment>
            )
          })}
        </span>

        <div className="opacity-0 group-hover:opacity-100 transition ease flex items-center gap-2">
          <GenericDialog
            ref={dialogRef}
            title={`Manage access for ${account.name}`}
            buttonVariant="secondary"
            buttonContent={
              allowUpdateScope && (
                <>
                  <FaCog /> Manage
                </>
              )
            }
          >
            <form className="space-y-6 pt-4" onSubmit={handleUpdateScope}>
              {memberHasGlobalAccess(account) && (
                <Alert variant="info" icon={true} size="sm">
                  <p>
                    This account&apos;s role grants it access to all environments in this App. To
                    restrict their access, change their role from the{' '}
                    <Link
                      className="font-semibold hover:underline"
                      href={`/${organisation?.name}/access/service-accounts`}
                    >
                      Service Accounts
                    </Link>{' '}
                    page.
                  </p>
                </Alert>
              )}
              {teams && teams.length > 0 && (
                <Alert variant="info" icon={true} size="sm">
                  <p>
                    This account also has access to this app via the{' '}
                    {teams.map((t) => (
                      <strong key={t.id}>{t.name}</strong>
                    )).reduce<React.ReactNode[]>((acc, el, i) => {
                      if (i === 0) return [el]
                      if (i === teams.length - 1) return [...acc, ' and ', el]
                      return [...acc, ', ', el]
                    }, [])}{' '}
                    {teams.length === 1 ? 'team' : 'teams'}.
                  </p>
                </Alert>
              )}

              <div className="divide-y divide-neutral-500/20">
                <div className="w-full relative pb-4">
                  {scope.length === 0 && showEnvHint && (
                    <span className="absolute right-2 inset-y-0 text-red-500 text-xs">
                      Select an environment scope
                    </span>
                  )}
                  <Listbox
                    value={scope}
                    by="id"
                    onChange={(value) => setScope(sortEnvs(value))}
                    multiple
                    name="environments"
                    disabled={memberHasGlobalAccess(account)}
                  >
                    {({ open }) => (
                      <>
                        <Listbox.Label as={Fragment}>
                          <label
                            className="block text-2xs font-medium text-gray-500 uppercase tracking-wider mb-2"
                            htmlFor="name"
                          >
                            Environment scope <span className="text-red-500">*</span>
                          </label>
                        </Listbox.Label>
                        <Listbox.Button as={Fragment} aria-required>
                          <div
                            className={clsx(
                              'p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 h-10',
                              memberHasGlobalAccess(account)
                                ? 'cursor-not-allowed'
                                : 'cursor-pointer',
                              open ? 'rounded-t-md' : 'rounded-md'
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
                            <div className="bg-neutral-200 dark:bg-neutral-800 p-2 rounded-b-md border border-neutral-500/40 shadow-2xl absolute z-10 -my-px w-full divide-y divide-neutral-500/20">
                              {envOptions.map((env: Partial<EnvironmentType>) => {
                                // Team-granted envs persist even after a
                                // "save" with them deselected — disable so
                                // the UI doesn't suggest otherwise.
                                const sources = env.id
                                  ? envGrantSources[env.id]
                                  : undefined
                                const teamOnly = !!sources?.team && !sources?.individual
                                const inScope = scope.some((s) => s.id === env.id)
                                const lockedByTeam = teamOnly && inScope
                                return (
                                  <Listbox.Option
                                    key={env.id}
                                    value={env}
                                    disabled={lockedByTeam}
                                    as={Fragment}
                                  >
                                    {({ active, selected }) => (
                                      <div
                                        className={clsx(
                                          'flex items-center gap-2 p-1 text-sm rounded-sm transition ease',
                                          lockedByTeam
                                            ? 'cursor-not-allowed'
                                            : 'cursor-pointer',
                                          active && !lockedByTeam
                                            ? 'text-zinc-900 dark:text-zinc-100 bg-neutral-100 dark:bg-neutral-700'
                                            : 'text-zinc-700 dark:text-zinc-300',
                                          selected && 'text-zinc-900 dark:text-zinc-100'
                                        )}
                                        title={
                                          lockedByTeam
                                            ? `${env.name} — granted via team. Remove the account from the team to revoke this access.`
                                            : undefined
                                        }
                                      >
                                        {selected ? (
                                          <FaCheckCircle
                                            className={clsx(
                                              lockedByTeam
                                                ? 'text-neutral-500'
                                                : 'text-emerald-500'
                                            )}
                                          />
                                        ) : (
                                          <FaCircle className="text-neutral-500" />
                                        )}
                                        <div
                                          className={clsx(
                                            lockedByTeam &&
                                              'text-neutral-500'
                                          )}
                                        >
                                          {env.name}
                                        </div>
                                      </div>
                                    )}
                                  </Listbox.Option>
                                )
                              })}
                            </div>
                          </Listbox.Options>
                        </Transition>
                      </>
                    )}
                  </Listbox>
                </div>

                <div className="flex items-end gap-4 justify-between py-2">
                  <div>
                    <label className="block text-2xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                      Account Tokens
                    </label>
                    <div className="text-zinc-900 dark:text-zinc-100 font-medium">
                      {account.tokens?.length! > 0 ? account.tokens?.length! : 'No'} active tokens
                    </div>
                  </div>
                  <Link href={`/${organisation?.name}/access/service-accounts/${account.id}`}>
                    <Button variant="outline" title="Manage this service account, or get a token">
                      <FaCog /> Manage Tokens
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <Button variant="secondary" type="button" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={memberHasGlobalAccess(account) || !scopeUpdated}
                >
                  Save
                </Button>
              </div>
            </form>
          </GenericDialog>
        </div>
      </div>
    </>
  )
}
