'use client'

import { Button } from '@/components/common/Button'
import { KeyringContext } from '@/contexts/keyringContext'

import {
  compareExpiryOptions,
  ExpiryOptionT,
  humanReadableExpiry,
  tokenExpiryOptions,
} from '@/utils/tokens'
import { useMutation } from '@apollo/client'
import { RadioGroup, Tab } from '@headlessui/react'
import clsx from 'clsx'
import { useContext, useState, Fragment, useRef } from 'react'
import { FaPlus, FaCircle, FaCheckCircle, FaExternalLinkSquareAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { CreateNewUserToken } from '@/graphql/mutations/users/createUserToken.gql'
import { GetUserTokens } from '@/graphql/queries/users/getUserTokens.gql'
import { Alert } from '@/components/common/Alert'
import CopyButton from '@/components/common/CopyButton'
import { CliCommand } from '@/components/dashboard/CliCommand'
import Link from 'next/link'
import { getApiHost } from '@/utils/appConfig'
import { getUserKxPublicKey, getUserKxPrivateKey, generateUserToken } from '@/utils/crypto'
import GenericDialog from '@/components/common/GenericDialog'

export const CreateUserTokenDialog = (props: { organisationId: string }) => {
  const { organisationId } = props

  const { keyring } = useContext(KeyringContext)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [name, setName] = useState<string>('')
  const [expiry, setExpiry] = useState<ExpiryOptionT>(tokenExpiryOptions[0])

  const [cliUserToken, setCliUserToken] = useState<string>('')
  const [apiUserToken, setApiUserToken] = useState<string>('')

  const [createUserToken] = useMutation(CreateNewUserToken)

  const reset = () => {
    setName('')
    setCliUserToken('')
  }

  const handleCreateNewUserToken = async (event: { preventDefault: () => void }) => {
    event.preventDefault()

    if (name.length === 0) {
      toast.error('You must enter a name for the token')
      return false
    }

    if (keyring) {
      const userKxKeys = {
        publicKey: await getUserKxPublicKey(keyring.publicKey),
        privateKey: await getUserKxPrivateKey(keyring.privateKey),
      }

      const { pssUser, mutationPayload } = await generateUserToken(
        organisationId,
        userKxKeys,
        name,
        expiry.getExpiry()
      )

      await createUserToken({
        variables: mutationPayload,
        refetchQueries: [
          {
            query: GetUserTokens,
            variables: {
              organisationId,
            },
          },
        ],
      })

      setCliUserToken(pssUser)
      setApiUserToken(`User ${mutationPayload.token}`)
    } else {
      console.log('keyring unavailable')
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Create a new User token"
      buttonVariant="primary"
      buttonContent={
        <>
          <FaPlus /> Create token
        </>
      }
      onClose={reset}
    >
      {cliUserToken ? (
        <div className="space-y-6 pt-4">
          <div className="flex items-center justify-between py-2">
            <div className="space-y-1">
              <div className="font-semibold text-black dark:text-white text-xl">{name}</div>
              <div className="text-neutral-500 text-sm">{humanReadableExpiry(expiry)}</div>
              <div className="text-neutral-500 text-sm">
                This token has access to all apps and environments accessible by you.
              </div>
            </div>
          </div>

          <Alert variant="warning" size="sm">
            Copy this token. You won&apos;t see it again!
          </Alert>

          <Tab.Group>
            <Tab.List className="flex gap-2 w-full border-b border-neutral-500/20">
              <Tab as={Fragment}>
                {({ selected }) => (
                  <div
                    className={clsx(
                      'p-2 text-xs font-medium border-b focus:outline-none text-black dark:text-white',
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
                      'p-2 text-xs font-medium border-b focus:outline-none text-black dark:text-white',
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
                        user token
                      </span>
                      <div className="flex gap-4 items-center">
                        {cliUserToken && (
                          <div className="">
                            <CopyButton value={cliUserToken} />
                          </div>
                        )}
                      </div>
                    </div>
                    <code className="text-xs break-all text-emerald-500 ph-no-capture">
                      {cliUserToken}
                    </code>
                  </div>
                </div>
              </Tab.Panel>
              <Tab.Panel>
                <div className="space-y-6">
                  <Alert variant="info" size="sm">
                    <div>
                      You will need to enable server-side encryption (SSE) for any Apps that you
                      want to manage secrets with via the Public API.
                      <Link
                        href="https://docs.phase.dev/console/apps#settings"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <div className="flex items-center gap-1 underline">
                          Docs <FaExternalLinkSquareAlt />
                        </div>
                      </Link>
                    </div>
                  </Alert>

                  <div className="bg-zinc-300/50 dark:bg-zinc-800/50 shadow-inner p-3 rounded-lg group relative">
                    <div className="w-full flex items-center justify-between pb-4">
                      <span className="uppercase text-xs tracking-widest text-gray-500">
                        API token
                      </span>
                      <div className="flex gap-4 items-center">
                        {apiUserToken && (
                          <div className="">
                            <CopyButton value={apiUserToken} />
                          </div>
                        )}
                      </div>
                    </div>
                    <code className="text-xs break-all text-emerald-500 ph-no-capture">
                      {apiUserToken}
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
                      command={`--request GET --url '${getApiHost()}/v1/secrets/?app_id=\${appId}&env=development' --header 'Authorization: Bearer ${apiUserToken}'`}
                    />
                  </div>
                </div>
              </Tab.Panel>
            </Tab.Panels>
          </Tab.Group>
        </div>
      ) : (
        <form className="space-y-6 pt-4" onSubmit={handleCreateNewUserToken}>
          <div className="w-full">
            <label className="block text-neutral-500 text-xs mb-2" htmlFor="name">
              Token name
            </label>
            <input required id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <RadioGroup value={expiry} by={compareExpiryOptions} onChange={setExpiry}>
              <RadioGroup.Label as={Fragment}>
                <label className="block text-neutral-500 text-xs mb-2">Expiry</label>
              </RadioGroup.Label>
              <div className="flex flex-wrap items-center gap-2">
                {tokenExpiryOptions.map((option) => (
                  <RadioGroup.Option key={option.name} value={option} as={Fragment}>
                    {({ checked }) => (
                      <div>
                        <Button type="button" variant={checked ? 'primary' : 'secondary'}>
                          {checked ? <FaCheckCircle className="text-emerald-500" /> : <FaCircle />}
                          {option.name}
                        </Button>
                      </div>
                    )}
                  </RadioGroup.Option>
                ))}
              </div>
            </RadioGroup>
            <span className="text-xs text-neutral-500">{humanReadableExpiry(expiry)}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Button
              variant="secondary"
              type="button"
              onClick={() => dialogRef.current?.closeModal()}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Create
            </Button>
          </div>
        </form>
      )}
    </GenericDialog>
  )
}
