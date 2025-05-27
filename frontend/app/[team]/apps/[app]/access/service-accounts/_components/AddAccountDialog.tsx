import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { BulkAddMembersToApp } from '@/graphql/mutations/apps/bulkAddAppMembers.gql'
import { GetAppServiceAccounts } from '@/graphql/queries/apps/getAppServiceAccounts.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { useLazyQuery, useMutation, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useRef, useState } from 'react'
import { EnvironmentType, ServiceAccountType, MemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { Combobox, Listbox, Transition } from '@headlessui/react'
import {
  FaArrowRight,
  FaAsterisk,
  FaCheckCircle,
  FaChevronDown,
  FaCircle,
  FaPlus,
  FaRobot,
} from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { KeyringContext } from '@/contexts/keyringContext'
import { userHasPermission } from '@/utils/access/permissions'
import { Alert } from '@/components/common/Alert'
import Link from 'next/link'
import { unwrapEnvSecretsForUser, wrapEnvSecretsForAccount } from '@/utils/crypto'
import { useSearchParams } from 'next/navigation'
import GenericDialog from '@/components/common/GenericDialog'

export const AddAccountDialog = ({ appId }: { appId: string }) => {
  const searchParams = useSearchParams()
  const preselectedAccountId = searchParams?.get('new') ?? null

  const { keyring } = useContext(KeyringContext)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const comboboxButtonRef = useRef<HTMLButtonElement | null>(null)

  // Permissions
  const userCanReadAppSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read', true)
    : false
  const userCanReadEnvironments = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Environments', 'read', true)
    : false

  // AppServiceAccounts:create + ServiceAccounts: read
  const userCanAddAppSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'create', true) &&
      userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read')
    : false

  const { data: serviceAccountsData } = useQuery(GetServiceAccounts, {
    variables: {
      orgId: organisation?.id,
    },
    skip: !organisation || !userCanAddAppSA,
  })

  const { data, loading } = useQuery(GetAppServiceAccounts, {
    variables: { appId: appId },
    skip: !userCanReadAppSA,
  })

  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)

  const accountOptions =
    serviceAccountsData?.serviceAccounts.filter(
      (account: ServiceAccountType) =>
        !data?.appServiceAccounts
          .map((account: ServiceAccountType) => account.id)
          .includes(account.id)
    ) ?? []

  const [bulkAddMembers] = useMutation(BulkAddMembersToApp)

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId: appId,
    },
    skip: !userCanReadEnvironments,
  })

  const envOptions =
    appEnvsData?.appEnvironments.map((env: EnvironmentType) => {
      const { id, name } = env

      return {
        id,
        name,
      }
    }) ?? []

  const [selectedAccounts, setSelectedAccounts] = useState<ServiceAccountType[]>([])
  const [query, setQuery] = useState('')
  const [envScope, setEnvScope] = useState<Array<Record<string, string>>>([])
  const [showEnvHint, setShowEnvHint] = useState<boolean>(false)

  const filteredAccounts =
    query === ''
      ? accountOptions
      : accountOptions.filter((account: ServiceAccountType) => {
          return account.name.toLowerCase().includes(query.toLowerCase())
        })

  const openModal = () => dialogRef.current?.openModal()
  const closeModal = () => dialogRef.current?.closeModal()

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

      const preselectedAccount = serviceAccountsData.serviceAccounts.find(
        (account: ServiceAccountType) => account.id === preselectedAccountId
      )
      if (preselectedAccount) {
        setSelectedAccounts(preselectedAccount)
        openModal()
      }
    }
  }, [preselectedAccountId, serviceAccountsData, data?.appServiceAccounts])

  const handleAddMembers = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (envScope.length === 0) {
      setShowEnvHint(true)
      return false
    }

    if (preselectedAccountId) {
      const url = new URL(window.location.href)
      url.searchParams.delete('new')
      window.history.replaceState({}, '', url.toString())
    }

    const appEnvironments = appEnvsData.appEnvironments as EnvironmentType[]

    const envKeyInputs: {
      envId: string
      userId: string
      identityKey: string
      wrappedSeed: string
      wrappedSalt: string
    }[] = []

    for (const env of appEnvironments) {
      if (!envScope.map((e) => e.id).includes(env.id)) continue

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

      for (const account of selectedAccounts) {
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
      ],
    })

    toast.success('Added accounts to App', { autoClose: 2000 })
    closeModal()
  }

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        title="Add a Service Account"
        buttonContent={
          <>
            <FaPlus /> Add account
          </>
        }
      >
        {accountOptions.length === 0 ? (
          <div className="py-4">
            <Alert variant="info" icon={true}>
              <div className="flex flex-col gap-2">
                <p>
                  All organisation service accounts are added to this App. You can create more
                  service accounts from the organisation access page.
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
              Select a service account to add to this App, and choose the Environments that it will
              be able to access.
            </p>
            <div className="relative">
              <Combobox
                value={selectedAccounts}
                onChange={(accounts) => setSelectedAccounts(accounts)}
                multiple
              >
                {({ open }) => (
                  <>
                    <div className="space-y-1">
                      <Combobox.Label as={Fragment}>
                        <label className="block text-neutral-500 text-sm" htmlFor="user">
                          Member
                        </label>
                      </Combobox.Label>
                      <div className="w-full relative flex items-center text-sm">
                        <Combobox.Input
                          id="user"
                          className="w-full"
                          onChange={(event) => setQuery(event.target.value)}
                          onClick={() => (!open ? comboboxButtonRef.current?.click() : {})}
                          onFocus={() => (!open ? comboboxButtonRef.current?.click() : {})}
                          required
                          placeholder="Select an account"
                          displayValue={(accounts: ServiceAccountType[]) =>
                            accounts.map((account) => account.name).join(', ')
                          }
                        />
                        <div className="absolute inset-y-0 right-2 flex items-center">
                          <Combobox.Button ref={comboboxButtonRef}>
                            <FaChevronDown
                              className={clsx(
                                'text-neutral-500 transform transition ease cursor-pointer',
                                open ? 'rotate-180' : 'rotate-0'
                              )}
                            />
                          </Combobox.Button>
                        </div>
                      </div>
                    </div>

                    <Combobox.Options as={Fragment}>
                      <div className="bg-neutral-200 dark:bg-neutral-800 p-1 rounded-b-md shadow-xl z-10 divide-y divide-neutral-500/20 absolute w-full max-h-96 overflow-y-auto ring-1 ring-inset ring-neutral-500/40">
                        {filteredAccounts.map((account: ServiceAccountType) => (
                          <Combobox.Option as={Fragment} key={account.id} value={account}>
                            {({ active, selected }) => (
                              <div
                                className={clsx(
                                  'flex items-center justify-between cursor-pointer transition ease',
                                  active
                                    ? 'text-zinc-900 dark:text-zinc-100 bg-neutral-100 dark:bg-neutral-700'
                                    : 'text-zinc-700 dark:text-zinc-300'
                                )}
                              >
                                <div className={clsx('flex items-center gap-2 p-1 text-sm')}>
                                  <div className="rounded-full flex items-center bg-neutral-500/20 justify-center size-12">
                                    <FaRobot className="shrink-0 text-zinc-900 dark:text-zinc-100 grow" />
                                  </div>
                                  <div>
                                    <div className="font-semibold">{account.name}</div>
                                    {account.id}
                                  </div>
                                </div>
                                <div className="px-2">
                                  {selected && <FaCheckCircle className="text-emerald-500" />}
                                </div>
                              </div>
                            )}
                          </Combobox.Option>
                        ))}
                      </div>
                    </Combobox.Options>
                  </>
                )}
              </Combobox>
            </div>

            {userCanReadEnvironments ? (
              <div className="space-y-1 w-full relative">
                <Listbox
                  by="id"
                  value={envScope}
                  onChange={setEnvScope}
                  multiple
                  name="environments"
                >
                  {({ open }) => (
                    <>
                      <Listbox.Label as={Fragment}>
                        <div className="flex items-center justify-between">
                          <label className="block text-neutral-500 text-sm" htmlFor="envs">
                            Environment scope
                          </label>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              type="button"
                              onClick={() => setEnvScope(envOptions)}
                              disabled={envScope.length === envOptions.length}
                            >
                              <div className="flex items-center gap-1 text-2xs">
                                <FaAsterisk /> Select all
                              </div>
                            </Button>
                            {envScope.length === 0 && showEnvHint && (
                              <span className="absolute right-2 inset-y-0 text-red-500 text-xs">
                                Select an environment scope
                              </span>
                            )}
                          </div>
                        </div>
                      </Listbox.Label>
                      <Listbox.Button as={Fragment} aria-required>
                        <div className="p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 border border-neutral-500/40 rounded-md cursor-pointer h-10">
                          <span className="text-zinc-900 dark:text-zinc-100 text-sm">
                            {envScope.map((env: Partial<EnvironmentType>) => env.name).join(' + ')}
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
                                        : 'text-zinc-700 dark:text-zinc-300',
                                      selected && 'text-zinc-900 dark:text-zinc-100'
                                    )}
                                  >
                                    {selected ? (
                                      <FaCheckCircle className="text-emerald-500" />
                                    ) : (
                                      <FaCircle className="text-neutral-500" />
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
            ) : (
              <Alert variant="danger" icon={true} size="sm">
                You don&apos;t have permission to read Environments. This permission is required to
                set an environment scope for members in this App.
              </Alert>
            )}

            <div className="flex items-center gap-4">
              <Button variant="secondary" type="button" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={envScope.length === 0 || selectedAccounts === null}
              >
                Add
              </Button>
            </div>
          </form>
        )}
      </GenericDialog>
    </>
  )
}
