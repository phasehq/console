import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { BulkAddMembersToApp } from '@/graphql/mutations/apps/bulkAddAppMembers.gql'
import { GetAppServiceAccounts } from '@/graphql/queries/apps/getAppServiceAccounts.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { EnvironmentType, ServiceAccountType, MemberType, TeamType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { Listbox, Menu, Transition } from '@headlessui/react'
import {
  FaArrowRight,
  FaBan,
  FaCheck,
  FaCheckCircle,
  FaChevronDown,
  FaCircle,
  FaPlus,
  FaSearch,
  FaTimesCircle,
  FaTrashAlt,
} from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { KeyringContext } from '@/contexts/keyringContext'
import { useAppPermissions } from '@/hooks/useAppPermissions'
import { Alert } from '@/components/common/Alert'
import Link from 'next/link'
import { unwrapEnvSecretsForUser, wrapEnvSecretsForAccount } from '@/utils/crypto'
import { useSearchParams, useParams } from 'next/navigation'
import GenericDialog from '@/components/common/GenericDialog'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { MdSearchOff } from 'react-icons/md'
import { Avatar } from '@/components/common/Avatar'
import { RoleLabel } from '@/components/users/RoleLabel'
import { TeamLabel } from '@/components/teams/TeamLabel'

type AccountWithEnvScope = ServiceAccountType & {
  scope: Partial<EnvironmentType>[]
}

export const AddAccountDialog = ({ appId }: { appId: string }) => {
  const searchParams = useSearchParams()
  const routeParams = useParams<{ team: string }>()
  const preselectedAccountId = searchParams?.get('new') ?? null

  const { keyring } = useContext(KeyringContext)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [isLoading, setIsLoading] = useState(false)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  // Permissions
  const { hasPermission } = useAppPermissions(appId)

  const userCanReadAppSA = hasPermission('ServiceAccounts', 'read', true)
  const userCanReadEnvironments = hasPermission('Environments', 'read', true)
  const userCanReadTeams = hasPermission('Teams', 'read')

  // AppServiceAccounts:create + ServiceAccounts: read
  const userCanAddAppSA =
    hasPermission('ServiceAccounts', 'create', true) && hasPermission('ServiceAccounts', 'read')

  const { data: serviceAccountsData } = useQuery(GetServiceAccounts, {
    variables: {
      orgId: organisation?.id,
    },
    skip: !organisation || !userCanAddAppSA,
  })

  const { data: teamsData } = useQuery(GetTeams, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !userCanReadTeams || !userCanAddAppSA,
  })

  // Map service account ID → teams that already grant access to this app
  const accountTeamsMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>()
    if (!teamsData?.teams) return map
    for (const team of teamsData.teams as TeamType[]) {
      const hasApp = team.apps?.some((a) => a!.id === appId)
      if (!hasApp) continue
      for (const m of team.members || []) {
        if (!m.serviceAccount) continue
        const list = map.get(m.serviceAccount.id) || []
        list.push({ id: team.id, name: team.name })
        map.set(m.serviceAccount.id, list)
      }
    }
    return map
  }, [teamsData, appId])

  const { data, loading } = useQuery(GetAppServiceAccounts, {
    variables: { appId: appId },
    skip: !userCanReadAppSA,
  })

  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)

  const [bulkAddMembers] = useMutation(BulkAddMembersToApp)

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId: appId,
    },
    skip: !userCanReadEnvironments,
  })

  const envOptions: Partial<EnvironmentType>[] =
    appEnvsData?.appEnvironments.map((env: EnvironmentType) => {
      const { id, name } = env

      return {
        id,
        name,
      }
    }) ?? []

  const [selectedAccounts, setSelectedAccounts] = useState<AccountWithEnvScope[]>([])

  const accountOptions =
    serviceAccountsData?.serviceAccounts
      // Team-owned SAs can only be granted app access via their owning team
      .filter((account: ServiceAccountType) => !account.team)
      .filter(
        (account: ServiceAccountType) =>
          !data?.appServiceAccounts
            .map((account: ServiceAccountType) => account.id)
            .includes(account.id)
      )
      .map((account: ServiceAccountType) => ({
        ...account,
        scope: [],
      }))
      .filter(
        (acc: AccountWithEnvScope) => !selectedAccounts.map((sacc) => sacc.id).includes(acc.id)
      ) ?? []

  const accountWithoutScope = selectedAccounts.some((account) => account.scope.length === 0)

  const reset = () => {
    setSelectedAccounts([])
  }
  const openModal = () => dialogRef.current?.openModal()
  const closeModal = () => dialogRef.current?.closeModal()

  const handleClose = () => {
    closeModal()
    reset()
  }

  useEffect(() => {
    if (preselectedAccountId && serviceAccountsData?.serviceAccounts) {
      // Check if service account is already added to the app
      const isAlreadyAdded = data?.appServiceAccounts?.some(
        (account: ServiceAccountType) => account.id === preselectedAccountId
      )

      if (isAlreadyAdded) {
        // Don't open dialog if already added
        return
      }

      const preselectedAccount: ServiceAccountType = serviceAccountsData.serviceAccounts.find(
        (account: ServiceAccountType) => account.id === preselectedAccountId
      )
      if (preselectedAccount) {
        setSelectedAccounts([
          {
            ...preselectedAccount,
            scope: [],
          },
        ])
        openModal()
      }
    }
  }, [preselectedAccountId, serviceAccountsData, data?.appServiceAccounts])

  const handleAddMembers = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (accountWithoutScope) {
      toast.error('Please select an Environment scope for all accounts')
      return false
    }

    setIsLoading(true)

    const appEnvironments = appEnvsData.appEnvironments as EnvironmentType[]

    const envKeyInputs: {
      envId: string
      userId: string
      identityKey: string
      wrappedSeed: string
      wrappedSalt: string
    }[] = []

    for (const env of appEnvironments) {
      for (const account of selectedAccounts) {
        const selectedEnvIds = account.scope.map((env) => env.id!) ?? []
        if (!selectedEnvIds.includes(env.id)) continue

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

        const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForAccount({ seed, salt }, account)

        envKeyInputs.push({
          envId: env.id,
          userId: account.id,
          identityKey,
          wrappedSeed,
          wrappedSalt,
        })
      }
    }

    await bulkAddMembers({
      variables: {
        members: selectedAccounts.map((account) => ({
          memberId: account.id,
          memberType: MemberType.Service,

          envKeys: envKeyInputs.filter((k) => k.userId === account.id),
        })),
        appId,
      },
      refetchQueries: [
        {
          query: GetAppServiceAccounts,
          variables: { appId: appId },
        },
        ...selectedAccounts.map((a) => ({
          query: GetAppEnvironments,
          variables: { appId: appId, memberId: a.id, memberType: MemberType.Service },
        })),
      ],
    })

    toast.success('Added accounts to App', { autoClose: 2000 })
    setIsLoading(false)
    handleClose()
  }

  const SelectAccountMenu = () => {
    const [query, setQuery] = useState('')

    const buttonRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
      if (buttonRef.current && selectedAccounts.length === 0) buttonRef.current.click()
    }, [buttonRef])

    const filteredAccounts =
      query === ''
        ? accountOptions
        : accountOptions.filter((account: AccountWithEnvScope) => {
            return account.name.toLowerCase().includes(query.toLowerCase())
          })

    return (
      <Menu as="div" className="relative inline-block text-left group w-96">
        {({ open }) => (
          <>
            <Menu.Button as={Fragment}>
              <Button variant={open ? 'secondary' : 'ghost'} ref={buttonRef}>
                <FaPlus className="mr-1" />
                {selectedAccounts.length ? 'Add another account' : 'Select a Service Account'}
              </Button>
            </Menu.Button>

            <Transition
              as={Fragment}
              enter="transition duration-100 ease-out"
              enterFrom="transform scale-95 opacity-0"
              enterTo="transform scale-100 opacity-100"
              leave="transition duration-75 ease-out"
              leaveFrom="transform scale-100 opacity-100"
              leaveTo="transform scale-95 opacity-0"
            >
              <Menu.Items className="absolute z-10 left-0 origin-top-right mt-2 divide-y divide-neutral-500/40 p-px rounded-md shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
                <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2 w-full text-sm">
                  <FaSearch className="text-neutral-500" />

                  <input
                    placeholder="Search Service Accounts"
                    className="custom bg-zinc-100 dark:bg-zinc-800"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <FaTimesCircle
                    className={clsx(
                      'cursor-pointer text-neutral-500 transition-opacity ease absolute right-2',
                      query ? 'opacity-100' : 'opacity-0'
                    )}
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setQuery('')
                    }}
                  />
                </div>

                <div className="max-h-96 overflow-y-auto overflow-x-hidden divide-y divide-neutral-500/20 bg-neutral-200/40 dark:bg-neutral-800/40 backdrop-blur rounded-b-md w-full max-w-screen-2xl pr-4">
                  {loading ? (
                    <div className="p-4">
                      <Spinner size="sm" />
                    </div>
                  ) : filteredAccounts.length > 0 ? (
                    filteredAccounts.map((account: AccountWithEnvScope) => (
                      <Menu.Item key={account.id}>
                        {({ active }) => (
                          <div
                            className={clsx(
                              'flex items-center justify-between gap-2 p-2 text-sm cursor-pointer transition ease w-full min-w-96',
                              active ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                            )}
                            onClick={() => setSelectedAccounts([...selectedAccounts, account])}
                          >
                            <div className="flex items-center gap-2">
                              <Avatar serviceAccount={account} />
                              <div className="flex flex-col gap-1">
                                <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                                  {account.name}
                                </div>
                                <div className="text-neutral-500 text-2xs leading-4 font-mono">
                                  {account.id}
                                </div>
                                {accountTeamsMap.get(account.id) && (
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {accountTeamsMap.get(account.id)!.map((t) => (
                                      <TeamLabel
                                        key={t.id}
                                        teamId={t.id}
                                        teamName={t.name}
                                        orgSlug={routeParams?.team ?? ''}
                                        variant="info"
                                        icon={FaCheck}
                                        title={`Already has access to this app via ${t.name}`}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="max-w-28 shrink-0">
                              <RoleLabel role={account.role!} />
                            </div>
                          </div>
                        )}
                      </Menu.Item>
                    ))
                  ) : query ? (
                    <div className="p-4 w-full max-w-screen-2xl">
                      <EmptyState
                        title={`No results for "${query}"`}
                        subtitle="Try adjusting your search term"
                        graphic={
                          <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                            <MdSearchOff />
                          </div>
                        }
                      >
                        <></>
                      </EmptyState>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-neutral-500 text-sm w-64">
                      All service accounts are already added to this app
                    </div>
                  )}
                </div>
              </Menu.Items>
            </Transition>
          </>
        )}
      </Menu>
    )
  }

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        title="Add Service Accounts"
        size="lg"
        buttonContent={
          <>
            <FaPlus /> Add accounts
          </>
        }
      >
        {accountOptions.length === 0 && selectedAccounts.length === 0 ? (
          <div className="py-4">
            <Alert variant="info" icon={true}>
              <div className="flex flex-col gap-2">
                <p>
                  {serviceAccountsData?.serviceAccounts?.length === 0
                    ? 'No service accounts exist in this organisation. You can create service accounts from the organisation access page.'
                    : 'All organisation service accounts are added to this App. You can create more service accounts from the organisation access page.'}
                </p>
                <Link href={`/${organisation?.name}/access/service-accounts`}>
                  <Button variant="secondary">
                    Go to service accounts <FaArrowRight />
                  </Button>
                </Link>
              </div>
            </Alert>
          </div>
        ) : (
          <form className="space-y-6" onSubmit={handleAddMembers}>
            <p className="text-neutral-500 text-sm">
              Select Service Accounts to add to this App, and choose the Environments that they will
              be able to access.
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 justify-between">
                <div className="w-1/2 text-2xs font-medium text-gray-500 uppercase tracking-wider">
                  Account
                </div>
                <div className="w-1/2 text-2xs font-medium text-gray-500 uppercase tracking-wider">
                  Environment scope <span className="text-red-500">*</span>
                </div>
                <div className="w-9"></div>
              </div>
              {selectedAccounts.map((account, index) => (
                <div key={account.id} className="space-y-1 flex items-center justify-between gap-2">
                  <div
                    className={clsx('flex items-center justify-between gap-2 p-1 text-sm w-1/2')}
                  >
                    <div className="flex items-center gap-2">
                      <Avatar serviceAccount={account} />
                      <div>
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {account.name}
                        </div>
                        <div className="text-neutral-500 text-2xs leading-4 font-mono">
                          {account.id}
                        </div>
                      </div>
                    </div>
                    <RoleLabel role={account.role!} />
                  </div>
                  <div className="w-1/2">
                    {userCanReadEnvironments ? (
                      <Listbox
                        multiple
                        by="id"
                        value={account.scope ?? []}
                        onChange={(newScopes) =>
                          setSelectedAccounts((prev) =>
                            prev.map((m) => (m.id === account.id ? { ...m, scope: newScopes } : m))
                          )
                        }
                      >
                        {({ open }) => (
                          <div className="relative">
                            <Listbox.Button
                              className={clsx(
                                'p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40  cursor-pointer min-h-10 text-sm text-left w-full',
                                open ? 'rounded-t-md' : 'rounded-md',
                                account.scope?.length
                                  ? 'text-zinc-900 dark:text-zinc-100'
                                  : 'text-zinc-500'
                              )}
                            >
                              {account.scope?.length
                                ? envOptions
                                    .filter((env) =>
                                      account.scope
                                        .map((selectedEnv) => selectedEnv.id)
                                        .includes(env.id!)
                                    )
                                    .map((env) => env.name)
                                    .join(' + ')
                                : 'Select environment scope'}
                              <FaChevronDown
                                className={clsx(
                                  'transform transition ease text-neutral-500',
                                  open ? '-rotate-180' : 'rotate-0'
                                )}
                              />
                            </Listbox.Button>
                            <Transition
                              as={Fragment}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                            >
                              <Listbox.Options className="bg-neutral-200 dark:bg-neutral-800 p-2 rounded-b-md ring-1 ring-inset ring-neutral-500/40 shadow-2xl absolute -my-px z-10 w-full divide-y divide-neutral-500/20">
                                {envOptions.map((env) => (
                                  <Listbox.Option key={`${account.id}-${env.id}`} value={env}>
                                    {({ active, selected }) => (
                                      <div
                                        className={clsx(
                                          'flex items-center gap-2 p-1 cursor-pointer text-sm rounded-md transition ease text-zinc-900 dark:text-zinc-100',
                                          active ? ' bg-neutral-100 dark:bg-neutral-700' : ''
                                        )}
                                      >
                                        {selected ? (
                                          <FaCheckCircle className="text-emerald-500" />
                                        ) : (
                                          <FaCircle className="text-neutral-500" />
                                        )}
                                        <span
                                          className={clsx(
                                            'block truncate',
                                            selected ? 'font-medium' : 'font-normal'
                                          )}
                                        >
                                          {env.name}
                                        </span>
                                      </div>
                                    )}
                                  </Listbox.Option>
                                ))}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        )}
                      </Listbox>
                    ) : (
                      <div className="flex items-center text-neutral-500 gap-2 text-sm">
                        <FaBan /> Access restricted
                      </div>
                    )}
                  </div>

                  <div className="">
                    <Button
                      variant="danger"
                      title="Remove this account"
                      onClick={() =>
                        setSelectedAccounts(selectedAccounts.filter((acc) => acc.id !== account.id))
                      }
                    >
                      <div className="py-1">
                        <FaTrashAlt className="shrink-0" />
                      </div>
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {selectedAccounts.some((a) => accountTeamsMap.has(a.id)) && (
              <Alert variant="warning" icon={true} size="sm">
                <div className="text-sm">
                  One or more selected service accounts already have access to this app via a team.
                  Adding them directly will grant them individual access on top of their team-based
                  access.
                </div>
              </Alert>
            )}

            <div className="flex w-full">
              <SelectAccountMenu />
            </div>

            <div className="flex items-center justify-between gap-4">
              <Button variant="secondary" type="button" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={!selectedAccounts.length}
                isLoading={isLoading}
              >
                <FaPlus />
                Add{' '}
                {selectedAccounts.length > 0
                  ? ` ${selectedAccounts.length} ${selectedAccounts.length === 1 ? 'account' : 'accounts'} `
                  : ''}
              </Button>
            </div>
          </form>
        )}
      </GenericDialog>
    </>
  )
}
