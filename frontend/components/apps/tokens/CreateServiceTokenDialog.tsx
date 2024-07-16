'use client'

import { EnvironmentType } from '@/apollo/graphql'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'
import { CliCommand } from '@/components/dashboard/CliCommand'
import { KeyringContext } from '@/contexts/keyringContext'
import { useQuery, useLazyQuery, useMutation } from '@apollo/client'
import { Dialog, Tab, Listbox, RadioGroup, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { useContext, useState, Fragment } from 'react'
import { FaPlus, FaTimes, FaChevronDown, FaCircle, FaCheckCircle } from 'react-icons/fa'
import { GetServiceTokens } from '@/graphql/queries/secrets/getServiceTokens.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { CreateNewServiceToken } from '@/graphql/mutations/environments/createServiceToken.gql'
import Link from 'next/link'
import { ExpiryOptionT, humanReadableExpiry, tokenExpiryOptions } from '@/utils/tokens'
import { getApiHost } from '@/utils/appConfig'
import { EnableSSEDialog } from '../EnableSSEDialog'
import {
  newEnvToken,
  newEnvWrapKey,
  newServiceTokenKeys,
  splitSecret,
  getWrappedKeyShare,
  unwrapEnvSecretsForUser,
  wrapEnvSecretsForServiceToken,
} from '@/utils/crypto'

const compareExpiryOptions = (a: ExpiryOptionT, b: ExpiryOptionT) => {
  return a.getExpiry() === b.getExpiry()
}

export const CreateServiceTokenDialog = (props: { organisationId: string; appId: string }) => {
  const { organisationId, appId } = props

  const { keyring } = useContext(KeyringContext)

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [name, setName] = useState<string>('')
  const [envScope, setEnvScope] = useState<Array<Record<string, string>>>([])
  const [expiry, setExpiry] = useState<ExpiryOptionT>(tokenExpiryOptions[0])
  const [showEnvHint, setShowEnvHint] = useState<boolean>(false)

  const [cliServiceToken, setCliServiceToken] = useState<string>('')
  const [apiServiceToken, setApiServiceToken] = useState<string>('')

  const { data } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })
  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)
  const [createServiceToken] = useMutation(CreateNewServiceToken)

  const reset = () => {
    setName('')
    setEnvScope([])
    setCliServiceToken('')
    setShowEnvHint(false)
  }

  const closeModal = () => {
    reset()
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const envOptions =
    data?.appEnvironments.map((env: EnvironmentType) => {
      const { id, name } = env

      return {
        id,
        name,
      }
    }) ?? []

  const handleCreateNewServiceToken = async (event: { preventDefault: () => void }) => {
    event.preventDefault()

    if (envScope.length === 0) {
      setShowEnvHint(true)
      return false
    }

    if (keyring) {
      const appEnvironments = data.appEnvironments as EnvironmentType[]

      const token = await newEnvToken()
      const wrapKey = await newEnvWrapKey()

      const tokenKeys = await newServiceTokenKeys()
      const keyShares = await splitSecret(tokenKeys.privateKey)
      const wrappedKeyShare = await getWrappedKeyShare(keyShares[1], wrapKey)

      const pssService = `pss_service:v1:${token}:${tokenKeys.publicKey}:${keyShares[0]}:${wrapKey}`

      const envKeyPromises = appEnvironments
        .filter((env) => envScope.map((selectedEnv) => selectedEnv.id).includes(env.id))
        .map(async (env: EnvironmentType) => {
          const { data } = await getEnvKey({
            variables: {
              envId: env.id,
              appId,
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

          const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForServiceToken(
            { seed, salt },
            tokenKeys.publicKey
          )

          return {
            envId: env.id,
            identityKey,
            wrappedSeed,
            wrappedSalt,
          }
        })

      const envKeyInputs = await Promise.all(envKeyPromises)

      await createServiceToken({
        variables: {
          appId,
          environmentKeys: envKeyInputs,
          identityKey: tokenKeys.publicKey,
          token,
          wrappedKeyShare,
          name,
          expiry: expiry.getExpiry(),
        },
        refetchQueries: [
          {
            query: GetServiceTokens,
            variables: {
              appId,
            },
          },
        ],
      })

      setCliServiceToken(pssService)
      setApiServiceToken(`Service ${token}`)
    }
  }

  return (
    <>
      <div className="flex items-center">
        <Button variant="primary" onClick={openModal} title="Create Service Token">
          <div className="flex items-center gap-1">
            <FaPlus /> Create Service Token
          </div>
        </Button>
      </div>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={() => {}}>
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
                      New Service token
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  {cliServiceToken ? (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between py-2">
                        <div className="space-y-1">
                          <div className="font-semibold text-black dark:text-white text-2xl">
                            {name}
                          </div>
                          <div className="text-neutral-500 text-sm">
                            {humanReadableExpiry(expiry)}
                          </div>
                          <div className="text-neutral-500 text-sm">
                            This token has access to the following environments:
                          </div>
                          <ul className="text-neutral-500 text-sm list-inside list-disc">
                            {envScope.map((env) => (
                              <li className="font-semibold" key={env.id}>
                                {env.name}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      <Alert variant="warning" size="sm">
                        Copy this token. You won&apos;t see it again!
                      </Alert>
                      <Tab.Group>
                        <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20">
                          <Tab as={Fragment}>
                            {({ selected }) => (
                              <div
                                className={clsx(
                                  'p-3 font-medium border-b focus:outline-none text-black dark:text-white',
                                  selected
                                    ? 'border-emerald-500 font-semibold text-emerald-500'
                                    : ' border-transparent cursor-pointer'
                                )}
                              >
                                CLI / SDK / Kubernetes
                              </div>
                            )}
                          </Tab>
                          <Tab as={Fragment}>
                            {({ selected }) => (
                              <div
                                className={clsx(
                                  'p-3 font-medium border-b focus:outline-none text-black dark:text-white',
                                  selected
                                    ? 'border-emerald-500 font-semibold'
                                    : ' border-transparent cursor-pointer'
                                )}
                              >
                                API
                              </div>
                            )}
                          </Tab>
                        </Tab.List>
                        <Tab.Panels>
                          <Tab.Panel>
                            <div className="py-4">
                              <div className="bg-zinc-300/50 dark:bg-zinc-800/50 shadow-inner p-3 rounded-lg group relative">
                                <div className="w-full flex items-center justify-between pb-4">
                                  <span className="uppercase text-xs tracking-widest text-gray-500">
                                    service token
                                  </span>
                                  <div className="flex gap-4 items-center">
                                    {cliServiceToken && (
                                      <div className="">
                                        <CopyButton value={cliServiceToken} />
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <code className="text-xs break-all text-emerald-500 ph-no-capture">
                                  {cliServiceToken}
                                </code>
                              </div>
                            </div>
                          </Tab.Panel>
                          <Tab.Panel>
                            {data.sseEnabled ? (
                              <div className="space-y-6">
                                <div className="bg-zinc-300/50 dark:bg-zinc-800/50 shadow-inner p-3 rounded-lg group relative">
                                  <div className="w-full flex items-center justify-between pb-4">
                                    <span className="uppercase text-xs tracking-widest text-gray-500">
                                      API token
                                    </span>
                                    <div className="flex gap-4 items-center">
                                      {apiServiceToken && (
                                        <div className="">
                                          <CopyButton value={apiServiceToken} />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <code className="text-xs break-all text-emerald-500 ph-no-capture">
                                    {apiServiceToken}
                                  </code>
                                </div>

                                <div className="bg-zinc-300/50 dark:bg-zinc-800/50 shadow-inner p-3 rounded-lg group relative">
                                  <div className="w-full flex items-center justify-between pb-4">
                                    <span className="uppercase text-xs tracking-widest text-gray-500">
                                      app id
                                    </span>
                                    <div className="flex gap-4 items-center">
                                      {apiServiceToken && (
                                        <div className="">
                                          <CopyButton value={appId} />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <code className="text-xs break-all text-neutral-500 ph-no-capture">
                                    {appId}
                                  </code>
                                </div>

                                <div className="pt-4 border-t border-neutral-500/20 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <div className="text-neutral-500 text-sm">
                                      Example with <code>curl</code>
                                    </div>
                                    <Link
                                      href="https://docs.phase.dev/public-api"
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <Button variant="secondary">View Docs</Button>
                                    </Link>
                                  </div>
                                  <CliCommand
                                    prefix="curl"
                                    command={`--request GET --url '${getApiHost()}/v1/secrets/?app_id=${appId}&env=development' --header 'Authorization: Bearer ${apiServiceToken}'`}
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-2 p-8 bg-zinc-200 dark:bg-zinc-800 rounded-lg">
                                <div className="text-center">
                                  <div className="text-lg font-semibold text-black dark:text-white">
                                    Server-side encryption (SSE)
                                  </div>
                                  <div className="text-neutral-500 text-base">
                                    SSE is not enabled for this app. SSE is required to use this
                                    token with the REST API.
                                  </div>
                                </div>

                                <div className="flex justify-center">
                                  <EnableSSEDialog appId={appId} />
                                </div>
                              </div>
                            )}
                          </Tab.Panel>
                        </Tab.Panels>
                      </Tab.Group>
                    </div>
                  ) : (
                    <form className="space-y-6 p-4" onSubmit={handleCreateNewServiceToken}>
                      <div className="space-y-1 w-full">
                        <label
                          className="block text-gray-700 text-sm font-bold mb-2"
                          htmlFor="name"
                        >
                          Token name
                        </label>
                        <input
                          id="name"
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </div>

                      <div className="space-y-1 w-full relative">
                        {envScope.length === 0 && showEnvHint && (
                          <span className="absolute right-2 inset-y-0 text-red-500 text-xs">
                            Select an environment scope
                          </span>
                        )}
                        <Listbox
                          value={envScope}
                          by="id"
                          onChange={setEnvScope}
                          multiple
                          name="environments"
                          horizontal
                        >
                          {({ open }) => (
                            <>
                              <Listbox.Label as={Fragment}>
                                <label
                                  className="block text-gray-700 text-sm font-bold mb-2"
                                  htmlFor="name"
                                >
                                  Environment scope
                                </label>
                              </Listbox.Label>
                              <Listbox.Button as={Fragment} aria-required>
                                <div className="p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 rounded-md border border-neutral-500/40 cursor-pointer h-10">
                                  <span className="text-black dark:text-white">
                                    {envScope
                                      .map((env: Partial<EnvironmentType>) => env.name)
                                      .join(' + ')}
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
                                  <div className="bg-zinc-100 dark:bg-zinc-800 p-2 flex flex-wrap gap-2 rounded-md border border-neutral-500/40 shadow-2xl absolute z-10 w-full">
                                    {envOptions.map((env: Partial<EnvironmentType>) => (
                                      <Listbox.Option key={env.id} value={env} as={Fragment}>
                                        {({ selected }) => (
                                          <div>
                                            <Button
                                              type="button"
                                              variant={selected ? 'primary' : 'secondary'}
                                            >
                                              {selected ? (
                                                <FaCheckCircle className="text-emerald-500" />
                                              ) : (
                                                <FaCircle className="text-neutral-500" />
                                              )}
                                              {env.name}
                                            </Button>
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

                      <div>
                        <RadioGroup value={expiry} by={compareExpiryOptions} onChange={setExpiry}>
                          <RadioGroup.Label as={Fragment}>
                            <label className="block text-gray-700 text-sm font-bold mb-2">
                              Expiry
                            </label>
                          </RadioGroup.Label>
                          <div className="flex flex-wrap items-center gap-2">
                            {tokenExpiryOptions.map((option) => (
                              <RadioGroup.Option key={option.name} value={option} as={Fragment}>
                                {({ checked }) => (
                                  <div>
                                    <Button
                                      type="button"
                                      variant={checked ? 'primary' : 'secondary'}
                                    >
                                      {checked ? (
                                        <FaCheckCircle className="text-emerald-500" />
                                      ) : (
                                        <FaCircle />
                                      )}
                                      {option.name}
                                    </Button>
                                  </div>
                                )}
                              </RadioGroup.Option>
                            ))}
                          </div>
                        </RadioGroup>
                        <span className="text-sm text-neutral-500">
                          {humanReadableExpiry(expiry)}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 justify-between">
                        <Button variant="secondary" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button variant="primary" type="submit">
                          Create
                        </Button>
                      </div>
                    </form>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
