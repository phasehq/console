import { ServiceAccountType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import {
  compareExpiryOptions,
  ExpiryOptionT,
  humanReadableExpiry,
  tokenExpiryOptions,
} from '@/utils/tokens'
import { forwardRef, Fragment, useContext, useImperativeHandle, useRef, useState } from 'react'
import { FaCheckCircle, FaCircle, FaExternalLinkSquareAlt, FaPlus } from 'react-icons/fa'
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { CreateSAToken } from '@/graphql/mutations/service-accounts/createServiceAccountToken.gql'
import { organisationContext } from '@/contexts/organisationContext'
import {
  getUserKxPublicKey,
  getUserKxPrivateKey,
  decryptAsymmetric,
  OrganisationKeyring,
} from '@/utils/crypto'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { KeyringContext } from '@/contexts/keyringContext'
import { generateSAToken } from '@/utils/crypto/service-accounts'
import { Alert } from '@/components/common/Alert'
import CopyButton from '@/components/common/CopyButton'
import { CliCommand } from '@/components/dashboard/CliCommand'
import { getApiHost } from '@/utils/appConfig'
import { Tab, RadioGroup } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { userHasPermission } from '@/utils/access/permissions'

const CreateServiceAccountTokenDialog = forwardRef(
  (
    {
      serviceAccount,
    }: {
      serviceAccount: ServiceAccountType
    },
    ref
  ) => {
    const { activeOrganisation: organisation } = useContext(organisationContext)
    const { keyring } = useContext(KeyringContext)

    const userCanCreateTokens = organisation
      ? userHasPermission(organisation.role?.permissions, 'ServiceAccountTokens', 'create')
      : false

    const serviceAccountHandler = serviceAccount.handlers?.find(
      (handler) => handler?.user.self === true
    )

    const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

    const [name, setName] = useState<string>('')
    const [expiry, setExpiry] = useState<ExpiryOptionT>(tokenExpiryOptions[0])

    const [cliSAToken, setCliSAToken] = useState<string>('')
    const [apiSAToken, setApiSAToken] = useState<string>('')
    const [createPending, setCreatePending] = useState(false)

    const [createToken] = useMutation(CreateSAToken)

    const reset = () => {
      setName('')
      setExpiry(tokenExpiryOptions[0])
      setCliSAToken('')
      setApiSAToken('')
    }

    const closeModal = () => dialogRef.current?.closeModal()

    const openModal = () => dialogRef.current?.openModal()

    useImperativeHandle(ref, () => ({
      closeModal,
      openModal,
    }))

    const handleCreateNewSAToken = async (event: { preventDefault: () => void }) => {
      return new Promise<boolean>(async (resolve, reject) => {
        event.preventDefault()

        if (name.length === 0) {
          toast.error('You must enter a name for the token')
          reject()
        }

        if (serviceAccountHandler && keyring) {
          setCreatePending(true)
          const wrappedKeyring = serviceAccountHandler.wrappedKeyring

          const userKxKeys = {
            publicKey: await getUserKxPublicKey(keyring.publicKey),
            privateKey: await getUserKxPrivateKey(keyring.privateKey),
          }

          const serviceAccountKeyringString = await decryptAsymmetric(
            wrappedKeyring,
            userKxKeys.privateKey,
            userKxKeys.publicKey
          )

          const serviceAccountKeys = JSON.parse(serviceAccountKeyringString) as OrganisationKeyring

          const saKxKeys = {
            publicKey: await getUserKxPublicKey(serviceAccountKeys.publicKey),
            privateKey: await getUserKxPrivateKey(serviceAccountKeys.privateKey),
          }

          const { pssService, mutationPayload } = await generateSAToken(
            serviceAccount.id,
            saKxKeys,
            name,
            expiry.getExpiry()
          )

          await createToken({
            variables: mutationPayload,
            refetchQueries: [
              {
                query: GetServiceAccounts,
                variables: {
                  orgId: organisation!.id,
                },
              },
            ],
          })

          setCliSAToken(pssService)
          setApiSAToken(`ServiceAccount ${mutationPayload.token}`)
          setCreatePending(false)
          toast.success('Created new service account token!')
          resolve(true)
        } else {
          console.log('keyring unavailable')
          reject()
        }
      })
    }

    if (!userCanCreateTokens) return <></>

    return (
      <GenericDialog
        title={`Create token for ${serviceAccount.name}`}
        ref={dialogRef}
        onClose={reset}
      >
        <div className="space-y-4 divide-y divide-neutral-500/40">
          <div className="text-neutral-500 py-4">Create a new token for this service account</div>

          {cliSAToken ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between py-2">
                <div className="space-y-1">
                  <div className="font-semibold text-black dark:text-white text-2xl">{name}</div>
                  <div className="text-neutral-500 text-sm">{humanReadableExpiry(expiry)}</div>
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
                            Service token
                          </span>
                          <div className="flex gap-4 items-center">
                            {cliSAToken && (
                              <div className="">
                                <CopyButton value={cliSAToken} />
                              </div>
                            )}
                          </div>
                        </div>
                        <code className="text-xs break-all text-emerald-500 ph-no-capture">
                          {cliSAToken}
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
                            {apiSAToken && (
                              <div className="">
                                <CopyButton value={apiSAToken} />
                              </div>
                            )}
                          </div>
                        </div>
                        <code className="text-xs break-all text-emerald-500 ph-no-capture">
                          {apiSAToken}
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
                          command={`--request GET --url '${getApiHost()}/v1/secrets/?app_id=\${appId}&env=development' --header 'Authorization: Bearer ${apiSAToken}'`}
                        />
                      </div>
                    </div>
                  </Tab.Panel>
                </Tab.Panels>
              </Tab.Group>
            </div>
          ) : (
            <form className="space-y-6 py-4" onSubmit={handleCreateNewSAToken}>
              <div className="space-y-2 w-full">
                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="name">
                  Token name
                </label>
                <input required id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div>
                <RadioGroup value={expiry} by={compareExpiryOptions} onChange={setExpiry}>
                  <RadioGroup.Label as={Fragment}>
                    <label className="block text-gray-700 text-sm font-bold mb-2">Expiry</label>
                  </RadioGroup.Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {tokenExpiryOptions.map((option) => (
                      <RadioGroup.Option key={option.name} value={option} as={Fragment}>
                        {({ checked }) => (
                          <div>
                            <Button type="button" variant={checked ? 'primary' : 'secondary'}>
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
                <span className="text-sm text-neutral-500">{humanReadableExpiry(expiry)}</span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <Button variant="secondary" type="button" onClick={closeModal}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" isLoading={createPending}>
                  Create
                </Button>
              </div>
            </form>
          )}
        </div>
      </GenericDialog>
    )
  }
)

CreateServiceAccountTokenDialog.displayName = 'CreateServiceAccountTokenDialog'

export default CreateServiceAccountTokenDialog
