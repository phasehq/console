import { OrganisationMemberType, ProviderType } from '@/apollo/graphql'
import GetProviderList from '@/graphql/queries/syncing/getProviders.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import SaveNewProviderCreds from '@/graphql/mutations/syncing/saveNewProviderCreds.gql'
import { Dialog, Combobox, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { useState, Fragment, ChangeEvent, useEffect, useContext } from 'react'
import { FaArrowRight, FaChevronDown, FaPlus, FaQuestionCircle, FaTimes } from 'react-icons/fa'
import { Avatar } from '../common/Avatar'
import { Button } from '../common/Button'
import { useMutation, useQuery } from '@apollo/client'
import { Input } from '../common/Input'
import { encryptAsymmetric } from '@/utils/crypto'
import { organisationContext } from '@/contexts/organisationContext'
import { toast } from 'react-toastify'
import { encryptProviderCredentials } from '@/utils/syncing/general'
import { Card } from '../common/Card'
import { ProviderIcon } from './ProviderIcon'
import { AWSRegionPicker } from './AWS/AWSRegionPicker'
import { awsRegions } from '@/utils/syncing/aws'
import Link from 'next/link'
import { SetupGhAuth } from './GitHub/SetupGhAuth'

interface CredentialState {
  [key: string]: string
}

const ProviderCard = (props: { provider: ProviderType }) => {
  const { provider } = props

  return (
    <Card>
      <div className="flex flex-auto gap-4 cursor-pointer">
        <div className="text-4xl">
          <ProviderIcon providerId={provider.id} />
        </div>
        <div className="flex flex-col gap-6 text-left">
          <div>
            <div className="text-black dark:text-white text-lg font-semibold">{provider.name}</div>
            <div className="text-neutral-500 text-sm">
              Set up authentication credentials to sync with {provider.name}.
            </div>
          </div>
          <div className="text-emerald-500">
            <Button variant="link">
              Create <FaArrowRight />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}

export const CreateProviderCredentialsDialog = (props: {
  buttonVariant?: 'primary' | 'secondary'
  defaultOpen?: boolean
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [isOpen, setIsOpen] = useState<boolean>(props.defaultOpen || false)
  const [provider, setProvider] = useState<ProviderType | null>(null)
  const [name, setName] = useState<string>('')
  const [credentials, setCredentials] = useState<CredentialState>({})

  const { data: providersData } = useQuery(GetProviderList)
  const [saveNewCreds] = useMutation(SaveNewProviderCreds)

  const providers: ProviderType[] = providersData?.providers ?? []

  useEffect(() => {
    const handleProviderChange = (provider: ProviderType) => {
      setProvider(provider)
      const initialCredentials: CredentialState = {}
      provider.expectedCredentials!.forEach((cred) => {
        initialCredentials[cred] = '' // Initialize each credential with an empty string
      })
      if (provider.optionalCredentials) {
        provider.optionalCredentials!.forEach((cred) => {
          initialCredentials[cred] = ''
        })
      }
      if (provider.id === 'aws') initialCredentials['region'] = awsRegions[0].region
      setCredentials(initialCredentials)

      if (name.length === 0) setName(`${provider.name} credentials`)
    }
    if (provider) handleProviderChange(provider)
  }, [provider])

  const handleCredentialChange = (key: string, value: string) => {
    setCredentials({ ...credentials, [key]: value })
  }

  const reset = () => {
    setProvider(null)
    setName('')
  }

  const closeModal = () => {
    reset()
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  useEffect(() => {
    if (props.defaultOpen) openModal()
  }, [props.defaultOpen])

  const docsLink = (provider: ProviderType) => {
    if (provider.id === 'cloudflare')
      return 'https://docs.phase.dev/integrations/platforms/cloudflare-pages'
    else if (provider.id === 'aws')
      return 'https://docs.phase.dev/integrations/platforms/aws-secrets-manager'
    else if (provider.id === 'hashicorp_vault')
      return 'https://docs.phase.dev/integrations/platforms/hashicorp-vault'
    else return 'https://docs.phase.dev/integrations'
  }

  const handleClickBack = () => {
    setProvider(null)
    setName('')
  }

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (provider === null) {
      return false
    }

    const encryptedCredentials = JSON.stringify(
      await encryptProviderCredentials(provider, credentials, providersData.serverPublicKey)
    )

    await saveNewCreds({
      variables: {
        orgId: organisation!.id,
        provider: provider?.id,
        name,
        credentials: encryptedCredentials,
      },
      refetchQueries: [
        {
          query: GetSavedCredentials,
          variables: {
            orgId: organisation!.id,
          },
        },
      ],
    })

    toast.success(`Saved ${name}`)
    closeModal()
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <Button
          type="button"
          variant={props.buttonVariant || 'primary'}
          onClick={openModal}
          title="Store a new credential"
        >
          <FaPlus /> Add credentials
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
                <Dialog.Panel className="w-full max-w-3xl transform rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Create new {provider && <span>{provider.name}</span>} service credentials
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6">
                    <p className="text-neutral-500">
                      Add a new set of credentials for third party integrations.
                    </p>
                    <form className="space-y-6 p-4" onSubmit={handleSubmit}>
                      {provider && (
                        <div className="border-b border-neutral-500/20 pb-4 flex items-center justify-between">
                          <div className="flex items-center gap-2 text-lg">
                            <ProviderIcon providerId={provider.id} />
                            <span className="font-semibold text-black dark:text-white">
                              {provider.name}
                            </span>
                          </div>
                          <Link href={docsLink(provider)} target="_blank">
                            <Button type="button" variant="secondary">
                              <FaQuestionCircle className="my-1 shrink-0" />
                              Help
                            </Button>
                          </Link>
                        </div>
                      )}

                      {provider === null && (
                        <div className="grid grid-cols-2 gap-4">
                          {providers.map((provider) => (
                            <button
                              key={provider.id}
                              type="button"
                              onClick={() => setProvider(provider)}
                            >
                              <ProviderCard provider={provider} />
                            </button>
                          ))}
                        </div>
                      )}

                      {provider?.authScheme === 'token' &&
                        provider?.expectedCredentials
                          .filter((credential) => credential !== 'region')
                          .map((credential) => (
                            <Input
                              key={credential}
                              value={credentials[credential]}
                              setValue={(value) => handleCredentialChange(credential, value)}
                              label={credential.replace(/_/g, ' ').toUpperCase()}
                              required
                              secret={true}
                            />
                          ))}

                      {provider?.authScheme === 'token' &&
                        provider?.optionalCredentials
                          .filter((credential) => credential !== 'region')
                          .map((credential) => (
                            <Input
                              key={credential}
                              value={credentials[credential]}
                              setValue={(value) => handleCredentialChange(credential, value)}
                              label={`${credential.replace(/_/g, ' ').toUpperCase()} (Optional)`}
                              secret={true}
                            />
                          ))}

                      {provider?.id === 'aws' && (
                        <AWSRegionPicker
                          onChange={(region) => handleCredentialChange('region', region)}
                        />
                      )}

                      {provider?.id === 'github' && <SetupGhAuth />}

                      {provider && provider?.authScheme === 'token' && (
                        <Input
                          required
                          value={name}
                          setValue={(value) => setName(value)}
                          label="Name"
                        />
                      )}

                      {provider && (
                        <div className="flex justify-between">
                          <Button variant="secondary" type="button" onClick={handleClickBack}>
                            Back
                          </Button>

                          <Button variant="primary" type="submit">
                            Save
                          </Button>
                        </div>
                      )}
                    </form>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
