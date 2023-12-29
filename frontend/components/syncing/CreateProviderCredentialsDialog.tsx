import { OrganisationMemberType, ProviderType } from '@/apollo/graphql'
import GetProviderList from '@/graphql/queries/syncing/getProviders.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import SaveNewProviderCreds from '@/graphql/mutations/syncing/saveNewProviderCreds.gql'
import { Dialog, Combobox, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { useState, Fragment, ChangeEvent, useEffect, useContext } from 'react'
import { FaChevronDown, FaPlus, FaTimes } from 'react-icons/fa'
import { Avatar } from '../common/Avatar'
import { Button } from '../common/Button'
import { useMutation, useQuery } from '@apollo/client'
import { Input } from '../common/Input'
import { encryptAsymmetric } from '@/utils/crypto'
import { organisationContext } from '@/contexts/organisationContext'
import { toast } from 'react-toastify'
import { encryptProviderCredentials } from '@/utils/syncing/general'

interface CredentialState {
  [key: string]: string
}

export const CreateProviderCredentialsDialog = (props: {
  buttonVariant?: 'primary' | 'secondary'
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [provider, setProvider] = useState<ProviderType | null>(null)
  const [name, setName] = useState<string>('')
  const [credentials, setCredentials] = useState<CredentialState>({})

  const [query, setQuery] = useState('')

  const { data: providersData } = useQuery(GetProviderList)
  const [saveNewCreds] = useMutation(SaveNewProviderCreds)

  const providers: ProviderType[] = providersData?.providers ?? []

  const filteredProviders =
    query === '' ? providers : providers.filter((provider) => provider.name!.includes(query))

  const handleProviderChange = (provider: ProviderType) => {
    if (provider) {
      setProvider(provider)
      const initialCredentials: CredentialState = {}
      provider.expectedCredentials!.forEach((cred) => {
        initialCredentials[cred] = '' // Initialize each credential with an empty string
      })
      setCredentials(initialCredentials)

      if (name.length === 0) setName(`${provider.name} credentials`)
    }
  }

  const handleCredentialChange = (key: string, value: string) => {
    setCredentials({ ...credentials, [key]: value })
  }

  const reset = () => {
    setName('')
    handleProviderChange(providers[0])
  }

  const closeModal = () => {
    reset()
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  useEffect(() => {
    if (providersData?.providers && providersData.providers.length > 0) {
      handleProviderChange(providersData.providers[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providersData])

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
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Create new integration credentials
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6 p-4">
                    <p className="text-neutral-500">
                      Add a new set of credentials for third party integrations.
                    </p>
                    <form className="space-y-6 p-4" onSubmit={handleSubmit}>
                      <Combobox value={provider} onChange={handleProviderChange}>
                        {({ open }) => (
                          <>
                            <div className="space-y-1">
                              <Combobox.Label as={Fragment}>
                                <label
                                  className="block text-gray-700 text-sm font-bold"
                                  htmlFor="name"
                                >
                                  Provider
                                </label>
                              </Combobox.Label>
                              <div className="w-full relative flex items-center">
                                <Combobox.Input
                                  className="w-full"
                                  onChange={(event) => setQuery(event.target.value)}
                                  required
                                  displayValue={(provider: ProviderType) => provider?.name}
                                />
                                <div className="absolute inset-y-0 right-2 flex items-center">
                                  <Combobox.Button>
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
                            <Transition
                              enter="transition duration-100 ease-out"
                              enterFrom="transform scale-95 opacity-0"
                              enterTo="transform scale-100 opacity-100"
                              leave="transition duration-75 ease-out"
                              leaveFrom="transform scale-100 opacity-100"
                              leaveTo="transform scale-95 opacity-0"
                            >
                              <Combobox.Options as={Fragment}>
                                <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl z-20">
                                  {filteredProviders.map((provider) => (
                                    <Combobox.Option key={provider.id} value={provider}>
                                      {({ active, selected }) => (
                                        <div
                                          className={clsx(
                                            'flex items-center gap-2 p-2 cursor-pointer',
                                            active && 'font-semibold'
                                          )}
                                        >
                                          <span className="text-black dark:text-white">
                                            {provider.name}
                                          </span>
                                        </div>
                                      )}
                                    </Combobox.Option>
                                  ))}
                                </div>
                              </Combobox.Options>
                            </Transition>
                          </>
                        )}
                      </Combobox>

                      {provider?.expectedCredentials.map((credential) => (
                        <Input
                          key={credential}
                          value={credentials[credential]}
                          setValue={(value) => handleCredentialChange(credential, value)}
                          label={credential.toUpperCase()}
                          required
                          secret={true}
                        />
                      ))}

                      <Input
                        required
                        value={name}
                        setValue={(value) => setName(value)}
                        label="Name"
                      />

                      <div className="flex justify-end">
                        <Button variant="primary" type="submit">
                          Save
                        </Button>
                      </div>
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
