'use client'

import { EnvironmentType, SecretFolderType, SecretInput, SecretType } from '@/apollo/graphql'
import { KeyringContext } from '@/contexts/keyringContext'
import { GetSecrets } from '@/graphql/queries/secrets/getSecrets.gql'
import { GetFolders } from '@/graphql/queries/secrets/getFolders.gql'
import { BulkProcessSecrets } from '@/graphql/mutations/environments/bulkProcessSecrets.gql'
import { DeleteFolder } from '@/graphql/mutations/environments/deleteFolder.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { CreateNewSecretFolder } from '@/graphql/mutations/environments/createFolder.gql'
import { LogSecretReads } from '@/graphql/mutations/environments/readSecret.gql'

import { useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/common/Button'
import {
  FaCheckCircle,
  FaChevronDown,
  FaDownload,
  FaExchangeAlt,
  FaFolderPlus,
  FaHome,
  FaPlus,
  FaSearch,
  FaTimes,
  FaTimesCircle,
  FaUndo,
  FaEye,
  FaEyeSlash,
  FaMagic,
} from 'react-icons/fa'
import SecretRow from '@/components/environments/secrets/SecretRow'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { Dialog, Menu, Transition } from '@headlessui/react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Alert } from '@/components/common/Alert'
import { EnvSyncStatus } from '@/components/syncing/EnvSyncStatus'
import { Input } from '@/components/common/Input'
import { SplitButton } from '@/components/common/SplitButton'
import { SecretFolderRow } from '@/components/environments/folders/SecretFolderRow'
import { MdKeyboardReturn, MdSearchOff } from 'react-icons/md'
import {
  arraysEqual,
  encryptAsymmetric,
  digest,
  getUserKxPublicKey,
  getUserKxPrivateKey,
  decryptAsymmetric,
  envKeyring,
  EnvKeyring,
} from '@/utils/crypto'
import { EmptyState } from '@/components/common/EmptyState'

export default function Environment({
  params,
}: {
  params: { team: string; app: string; environment: string; path?: string[] }
}) {
  const { keyring } = useContext(KeyringContext)

  const searchParams = useSearchParams()

  const secretToHighlight = searchParams?.get('secret')
  const highlightedRef = useRef<HTMLDivElement>(null)

  const [envKeys, setEnvKeys] = useState<EnvKeyring | null>(null)
  const [serverSecrets, setServerSecrets] = useState<SecretType[]>([])
  const [clientSecrets, setClientSecrets] = useState<SecretType[]>([])
  const [secretsToDelete, setSecretsToDelete] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isLoading, setIsloading] = useState(false)
  const [folderMenuIsOpen, setFolderMenuIsOpen] = useState<boolean>(false)
  const [globallyRevealed, setGloballyRevealed] = useState<boolean>(false)

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [readSecrets] = useMutation(LogSecretReads)

  const secretPath = params.path ? `/${params.path.join('/')}` : '/'

  const logGlobalReveals = async () => {
    await readSecrets({ variables: { ids: serverSecrets.map((secret) => secret.id) } })
  }

  const toggleGlobalReveal = () => {
    if (!globallyRevealed) {
      setGloballyRevealed(true)
      logGlobalReveals()
    } else {
      setGloballyRevealed(false)
    }
  }

  useEffect(() => {
    // 2. Scroll into view when secretToHighlight changes
    if (highlightedRef.current && serverSecrets.length > 0) {
      highlightedRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
    }
  }, [secretToHighlight, serverSecrets])

  const unsavedChanges =
    serverSecrets.length !== clientSecrets.length ||
    secretsToDelete.length > 0 ||
    serverSecrets.some((secret, index) => {
      const updatedSecret = clientSecrets[index]

      // Compare secret properties (comment, key, tags, value)
      return (
        secret.comment !== updatedSecret.comment ||
        secret.key !== updatedSecret.key ||
        !arraysEqual(secret.tags, updatedSecret.tags) ||
        secret.value !== updatedSecret.value
      )
    })

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId: params.app,
    },
  })

  const { data, loading } = useQuery(GetSecrets, {
    variables: {
      appId: params.app,
      envId: params.environment,
      path: secretPath,
    },
    pollInterval: unsavedChanges ? 0 : 5000,
  })

  const folders: SecretFolderType[] = data?.folders ?? []

  const savingAndFetching = isLoading || loading

  const [bulkProcessSecrets] = useMutation(BulkProcessSecrets)

  const [createFolder] = useMutation(CreateNewSecretFolder)
  const [deleteFolder] = useMutation(DeleteFolder)

  const envPath = (env: EnvironmentType) => {
    return `/${params.team}/apps/${params.app}/environments/${env.id}`
  }

  const environment = data?.appEnvironments[0] as EnvironmentType

  const envLinks =
    appEnvsData?.appEnvironments
      .filter((env: EnvironmentType) => env.name !== environment?.name)
      .map((env: EnvironmentType) => {
        return {
          label: env.name,
          href: envPath(env),
        }
      }) ?? []

  const handleAddSecret = (start: boolean = true) => {
    const newSecret = {
      id: `new-${crypto.randomUUID()}`,
      updatedAt: null,
      version: 1,
      key: '',
      value: '',
      tags: [],
      comment: '',
      path: '/',
      environment,
    } as SecretType
    start
      ? setClientSecrets([newSecret, ...clientSecrets])
      : setClientSecrets([...clientSecrets, newSecret])
  }

  const handleBulkUpdateSecrets = async () => {
    const secretsToCreate: SecretInput[] = []
    const secretsToUpdate: SecretInput[] = []

    await Promise.all(
      clientSecrets.map(async (clientSecret, index) => {
        const { id, key, value, comment, tags } = clientSecret
        const isNewSecret = id.split('-')[0] === 'new'
        const serverSecret = serverSecrets.find((secret) => secret.id === id)

        const isModified =
          !isNewSecret &&
          serverSecret &&
          (serverSecret.comment !== clientSecret.comment ||
            serverSecret.key !== clientSecret.key ||
            !arraysEqual(serverSecret.tags, clientSecret.tags) ||
            serverSecret.value !== clientSecret.value)

        // Only process if the secret is new or has been modified
        if (isNewSecret || isModified) {
          const encryptedKey = await encryptAsymmetric(key, environment.identityKey)
          const encryptedValue = await encryptAsymmetric(value, environment.identityKey)
          const keyDigest = await digest(key, envKeys!.salt)
          const encryptedComment = await encryptAsymmetric(comment, environment.identityKey)
          const tagIds = tags.map((tag) => tag.id)

          const secretInput: SecretInput = {
            envId: params.environment,
            path: secretPath,
            key: encryptedKey,
            keyDigest,
            value: encryptedValue,
            comment: encryptedComment,
            tags: tagIds,
          }

          if (isNewSecret) {
            secretsToCreate.push(secretInput)
          } else {
            secretsToUpdate.push({ ...secretInput, id })
          }
        }
      })
    )

    // Only call the mutation if there are changes
    if (secretsToCreate.length > 0 || secretsToUpdate.length > 0 || secretsToDelete.length > 0) {
      const { data, errors } = await bulkProcessSecrets({
        variables: {
          secretsToCreate,
          secretsToUpdate,
          secretsToDelete,
        },
        refetchQueries: [
          {
            query: GetSecrets,
            variables: {
              appId: params.app,
              envId: params.environment,
              path: secretPath,
            },
          },
        ],
      })

      if (!errors) setSecretsToDelete([])
    }
  }

  const stageSecretForDelete = async (id: string) => {
    if (id.split('-')[0] !== 'new') {
      if (secretsToDelete.includes(id))
        setSecretsToDelete(secretsToDelete.filter((secretId) => secretId !== id))
      else {
        const secretToDelete = clientSecrets.find((secret) => secret.id === id)
        if (secretToDelete) setSecretsToDelete([...secretsToDelete, ...[secretToDelete.id]])
      }
    } else {
      setClientSecrets(clientSecrets.filter((secret) => secret.id !== id))
    }
  }

  const handleDeleteFolder = async (id: string) => {
    await deleteFolder({
      variables: {
        folderId: id,
      },
      refetchQueries: [
        {
          query: GetFolders,
          variables: {
            envId: params.environment,
            path: secretPath,
          },
        },
      ],
    })
    toast.success('Folder deleted.')
  }

  useEffect(() => {
    const initEnvKeys = async () => {
      const wrappedSeed = data.environmentKeys[0].wrappedSeed

      const userKxKeys = {
        publicKey: await getUserKxPublicKey(keyring!.publicKey),
        privateKey: await getUserKxPrivateKey(keyring!.privateKey),
      }
      const seed = await decryptAsymmetric(wrappedSeed, userKxKeys.privateKey, userKxKeys.publicKey)

      const salt = await decryptAsymmetric(
        data.environmentKeys[0].wrappedSalt,
        userKxKeys.privateKey,
        userKxKeys.publicKey
      )
      const { publicKey, privateKey } = await envKeyring(seed)

      setEnvKeys({
        publicKey,
        privateKey,
        salt,
      })
    }

    if (data && keyring) initEnvKeys()
  }, [data, keyring])

  useEffect(() => {
    if (data && envKeys) {
      const decryptSecrets = async () => {
        const decryptedSecrets = await Promise.all(
          data.secrets.map(async (secret: SecretType) => {
            const decryptedSecret = structuredClone(secret)

            decryptedSecret.key = await decryptAsymmetric(
              secret.key,
              envKeys?.privateKey,
              envKeys?.publicKey
            )

            decryptedSecret.value = await decryptAsymmetric(
              secret.value,
              envKeys.privateKey,
              envKeys.publicKey
            )

            if (decryptedSecret.comment !== '')
              decryptedSecret.comment = await decryptAsymmetric(
                secret.comment,
                envKeys.privateKey,
                envKeys.publicKey
              )

            // Decrypt history for each secret
            if (secret.history && secret.history.length > 0) {
              const decryptedHistory = await Promise.all(
                secret.history.map(async (event) => {
                  const decryptedEvent = structuredClone(event)

                  // Decrypt event fields
                  decryptedEvent!.key = await decryptAsymmetric(
                    event!.key,
                    envKeys.privateKey,
                    envKeys.publicKey
                  )

                  decryptedEvent!.value = await decryptAsymmetric(
                    event!.value,
                    envKeys.privateKey,
                    envKeys.publicKey
                  )

                  if (decryptedEvent!.comment !== '') {
                    decryptedEvent!.comment = await decryptAsymmetric(
                      event!.comment,
                      envKeys.privateKey,
                      envKeys.publicKey
                    )
                  }

                  return decryptedEvent
                })
              )

              decryptedSecret.history = decryptedHistory
            }

            if (secret.override?.value) {
              decryptedSecret.override!.value = await decryptAsymmetric(
                secret.override?.value,
                envKeys.privateKey,
                envKeys.publicKey
              )
            }

            return decryptedSecret
          })
        )
        return decryptedSecrets
      }

      decryptSecrets().then((decryptedSecrets) => {
        setServerSecrets(decryptedSecrets)
        setClientSecrets(decryptedSecrets)
      })
    }
  }, [envKeys, data])

  const handleUpdateSecretProperty = (id: string, property: string, value: any) => {
    const updatedSecretList = clientSecrets.map((secret) => {
      if (secret.id === id) {
        return { ...secret, [property]: value }
      }
      return secret
    })

    setClientSecrets(updatedSecretList)
  }

  const getUpdatedSecrets = () => {
    const changedElements = []

    for (let i = 0; i < clientSecrets.length; i++) {
      const updatedSecret = clientSecrets[i]
      const originalSecret = serverSecrets.find((secret) => secret.id === updatedSecret.id)

      // this is a newly created secret that doesn't exist on the server yet
      if (!originalSecret) {
        changedElements.push(updatedSecret)
      } else if (
        originalSecret.comment !== updatedSecret.comment ||
        originalSecret.key !== updatedSecret.key ||
        !arraysEqual(originalSecret.tags, updatedSecret.tags) ||
        originalSecret.value !== updatedSecret.value
      ) {
        changedElements.push(updatedSecret)
      }
    }

    return changedElements
  }

  const duplicateKeysExist = () => {
    const keySet = new Set<string>()

    for (const secret of clientSecrets) {
      if (keySet.has(secret.key)) {
        return true // Duplicate key found
      }
      keySet.add(secret.key)
    }

    return false // No duplicate keys found
  }

  const handleSaveChanges = async () => {
    setIsloading(true)
    const changedSecrets = getUpdatedSecrets()
    if (changedSecrets.some((secret) => secret.key.length === 0)) {
      toast.error('Secret keys cannot be empty!')
      setIsloading(false)
      return false
    }

    if (duplicateKeysExist()) {
      toast.error('Secret keys cannot be repeated!')
      setIsloading(false)
      return false
    }

    await handleBulkUpdateSecrets()

    setTimeout(() => setIsloading(false), 500)

    toast.success('Changes successfully deployed.')
  }

  const handleDiscardChanges = () => {
    setClientSecrets(serverSecrets)
    setSecretsToDelete([])
  }

  const secretNames = serverSecrets.map((secret) => {
    const { id, key } = secret
    return {
      id,
      key,
    }
  })

  const filteredFolders =
    searchQuery === ''
      ? folders
      : folders.filter((folder) => {
          const searchRegex = new RegExp(searchQuery, 'i')
          return searchRegex.test(folder.name)
        })

  const filteredSecrets =
    searchQuery === ''
      ? clientSecrets
      : clientSecrets.filter((secret) => {
          const searchRegex = new RegExp(searchQuery, 'i')
          return searchRegex.test(secret.key)
        })

  const cannonicalSecret = (id: string) => serverSecrets.find((secret) => secret.id === id)

  const downloadEnvFile = () => {
    const envContent = serverSecrets
      .map((secret) => {
        const comment = secret.comment ? `#${secret.comment}\n` : ''
        return `${comment}${secret.key}=${secret.value}`
      })
      .join('\n')

    const blob = new Blob([envContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url

    // Check if secretPath is root or not and form the filename accordingly
    if (secretPath === '/') {
      a.download = `${environment.app.name}.${environment.name.toLowerCase()}.env`
    } else {
      // Replace all slashes with dots
      const formattedSecretPath = secretPath.toLowerCase().replace(/\//g, '.')
      a.download = `${environment.app.name}.${environment.name.toLowerCase()}${formattedSecretPath}.env`
    }

    document.body.appendChild(a)
    a.click()

    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const NewFolderMenu = () => {
    const [name, setName] = useState<string>('')

    // Regular expression to match only alphanumeric characters
    const regex = /^[a-zA-Z0-9]*$/

    const closeModal = () => {
      setFolderMenuIsOpen(false)
    }

    const openModal = () => {
      setFolderMenuIsOpen(true)
    }

    const handleClose = () => {
      setName('')
      closeModal()
    }

    const handleUpdateName = (newName: string) => {
      // Regular expression to match only alphanumeric characters
      const regex = /^[a-zA-Z0-9]*$/

      // Check if the new value matches the regular expression
      if (regex.test(newName) || newName === '') {
        // Update the state if the value is alphanumeric or empty (to allow clearing the input)
        setName(newName)
      }
    }

    const handleCreateFolder = async (e: { preventDefault: () => void }) => {
      e.preventDefault()

      const { data } = await createFolder({
        variables: {
          envId: params.environment,
          name,
          path: secretPath,
        },
        refetchQueries: [
          {
            query: GetFolders,
            variables: {
              envId: params.environment,
              path: secretPath,
            },
          },
        ],
      })
      if (data) {
        toast.success('Created new Folder', { autoClose: 2000 })
        handleClose()
      }
    }
    return (
      <>
        <Transition appear show={folderMenuIsOpen} as={Fragment}>
          <Dialog as="div" className="relative z-10" onClose={handleClose}>
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
                    <Dialog.Title as="div" className="flex w-full justify-between items-start">
                      <div>
                        <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                          Create a Folder
                        </h3>
                        <p className="text-neutral-500">
                          A new folder will be created at{' '}
                          <code className="border border-neutral-500/20 rounded-full px-1 py-0.5 font-semibold">
                            {secretPath === '/' ? '' : secretPath}/
                            <span className="text-emerald-500">{name}</span>
                          </code>
                        </p>
                      </div>

                      <Button variant="text" onClick={handleClose}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <div className="space-y-2 py-4">
                      <form
                        className="flex items-end justify-between gap-4"
                        onSubmit={handleCreateFolder}
                      >
                        <Input
                          value={name}
                          setValue={handleUpdateName}
                          label="Folder name"
                          required
                          maxLength={32}
                        />

                        <Button type="submit" variant="primary" disabled={name.length === 0}>
                          Create
                        </Button>
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

  const FolderBreadcrumbLinks = (props: { path?: string[] }) => {
    const { path } = props

    // Assuming params are accessible or passed to this component
    const basePath = `/${params.team}/apps/${params.app}/environments/${params.environment}`

    if (!path || path.length === 0) {
      // Return a link to the base path if path is empty or undefined
      return (
        <div className="flex flex-wrap">
          <Link href={basePath} className="p-2 flex items-center gap-2 font-light">
            <FaHome className="group-hover:text-white" />
            <span className="text-xl text-neutral-500 ">~/</span>
          </Link>
        </div>
      )
    }

    return (
      <div className="flex flex-wrap items-center">
        {/* Link to the base path */}
        <Link
          href={basePath}
          className="p-2 flex items-center gap-2 font-light text-neutral-500 group"
        >
          <FaHome className="group-hover:text-white" />
          <span className="text-xl group-hover:text-white">~/</span>
        </Link>
        {/* Map over path segments */}
        {path.map((segment, index) => {
          // Construct the href for each segment
          const href = `${basePath}/${path.slice(0, index + 1).join('/')}`

          return (
            <div
              key={index} // Using index as key; consider a more stable key if possible
              className={clsx(
                'flex items-center gap-1',
                index === path.length - 1 ? 'font-semibold' : 'font-light'
              )}
            >
              <Link href={href}>
                <span className="px-1 py-0.5 text-black dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-md">
                  {segment}
                </span>
              </Link>
              {index < path.length - 1 && <span className="text-neutral-500 p-1">/</span>}
            </div>
          )
        })}
        {
          <div className="px-4">
            <Link
              href={`${basePath}/${path.slice(0, path.length - 1).join('/')}`}
              title="Go up one level"
            >
              <Button variant="secondary">
                <MdKeyboardReturn className="shrink-0" />
                <span className="ml-2">Go Back</span>
              </Button>
            </Link>
          </div>
        }
      </div>
    )
  }

  const NewSecretMenu = () => (
    <SplitButton
      variant="primary"
      onClick={() => handleAddSecret(true)}
      menuContent={
        <div className="w-max">
          <Button variant="secondary" onClick={() => setFolderMenuIsOpen(true)}>
            <div className="flex items-center gap-2">
              <FaFolderPlus /> New Folder
            </div>
          </Button>
        </div>
      }
    >
      <FaPlus /> New Secret
    </SplitButton>
  )

  return (
    <div className="h-full max-h-screen overflow-y-auto w-full text-black dark:text-white">
      {keyring !== null && !loading && (
        <div className="flex flex-col py-4 gap-4">
          <div className="flex items-center gap-8">
            {envLinks.length > 1 ? (
              <Menu as="div" className="relative group">
                {({ open }) => (
                  <>
                    <Menu.Button as={Fragment}>
                      <div className="cursor-pointer flex items-center gap-2">
                        <h3 className="font-semibold text-xl">{environment.name}</h3>
                        <FaChevronDown
                          className={clsx(
                            'transition transform ease',
                            open
                              ? 'rotate-180 text-black dark:text-white'
                              : 'rotate-0 text-neutral-500 group-hover:text-black group-hover:dark:text-white'
                          )}
                        />
                      </div>
                    </Menu.Button>
                    <Transition
                      enter="transition duration-100 ease-out"
                      enterFrom="transform scale-95 opacity-0"
                      enterTo="transform scale-100 opacity-100"
                      leave="transition duration-75 ease-out"
                      leaveFrom="transform scale-100 opacity-100"
                      leaveTo="transform scale-95 opacity-0"
                      as="div"
                      className="absolute z-20 left-0 origin-bottom-left mt-2"
                    >
                      <Menu.Items as={Fragment}>
                        <div className="flex flex-col w-min divide-y divide-neutral-500/40 rounded-md bg-neutral-200 dark:bg-neutral-800 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
                          {envLinks.map((link: { label: string; href: string }) => (
                            <Menu.Item key={link.href} as={Fragment}>
                              {({ active }) => (
                                <Link
                                  href={link.href}
                                  className={clsx(
                                    'text-black dark:text-white px-4 py-2 flex items-center justify-between gap-4 rounded-md',
                                    active && 'bg-zinc-200 dark:bg-zinc-700'
                                  )}
                                >
                                  <div className="text-lg">{link.label}</div>
                                  <FaExchangeAlt className="text-neutral-500" />
                                </Link>
                              )}
                            </Menu.Item>
                          ))}
                        </div>
                      </Menu.Items>
                    </Transition>
                  </>
                )}
              </Menu>
            ) : (
              <h3 className="font-semibold text-2xl">{environment.name}</h3>
            )}
            <div className="flex items-center gap-2">
              <FolderBreadcrumbLinks path={params.path} />
            </div>
            {unsavedChanges && (
              <Alert variant="warning" icon={true} size="sm">
                You have undeployed changes to this environment.
              </Alert>
            )}
          </div>

          <div className="flex items-center w-full justify-between border-b border-zinc-300 dark:border-zinc-700 pb-4">
            <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2">
              <div className="">
                <FaSearch className="text-neutral-500" />
              </div>
              <input
                placeholder="Search"
                className="custom bg-zinc-100 dark:bg-zinc-800"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <FaTimesCircle
                className={clsx(
                  'cursor-pointer text-neutral-500 transition-opacity ease',
                  searchQuery ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                )}
                role="button"
                onClick={() => setSearchQuery('')}
              />
            </div>
            <div className="flex gap-2 items-center">
              {unsavedChanges && (
                <Button variant="outline" onClick={handleDiscardChanges} title="Discard changes">
                  <span className="px-2 py-1">
                    <FaUndo className="text-lg" />
                  </span>
                  <span>Discard changes</span>
                </Button>
              )}

              {data.envSyncs && (
                <div>
                  <EnvSyncStatus syncs={data.envSyncs} team={params.team} app={params.app} />
                </div>
              )}

              <Button
                variant={unsavedChanges ? 'warning' : 'primary'}
                disabled={!unsavedChanges || savingAndFetching}
                isLoading={savingAndFetching}
                onClick={handleSaveChanges}
              >
                <div className="flex items-center gap-2">
                  {!unsavedChanges && <FaCheckCircle className="text-emerald-500" />}
                  <span className="text-lg">{unsavedChanges ? 'Deploy' : 'Deployed'}</span>
                </div>
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-0 divide-y divide-neutral-500/20 bg-zinc-100 dark:bg-zinc-800 rounded-md shadow-md">
            {(clientSecrets.length > 0 || folders.length > 0) && (
              <div className="flex items-center w-full sticky top-0 z-10 bg-zinc-200/70 dark:bg-zinc-900/70 backdrop-blur-md">
                <div className="px-9 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider w-1/3">
                  key
                </div>
                <div className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider w-2/3 flex items-center justify-between">
                  value
                  <div className="flex items-center gap-4">
                    <Button variant="outline" onClick={toggleGlobalReveal}>
                      <div className="flex items-center gap-2">
                        {globallyRevealed ? <FaEyeSlash /> : <FaEye />}{' '}
                        {globallyRevealed ? 'Mask all' : 'Reveal all'}
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={downloadEnvFile}
                      title="Download as .env file"
                    >
                      <div className="flex items-center gap-2">
                        <FaDownload /> Export as .env
                      </div>
                    </Button>
                    <NewSecretMenu />
                  </div>
                </div>
              </div>
            )}

            <NewFolderMenu />

            {organisation &&
              filteredFolders.map((folder: SecretFolderType) => (
                <SecretFolderRow
                  key={folder.id}
                  folder={folder}
                  handleDelete={handleDeleteFolder}
                />
              ))}

            {organisation &&
              filteredSecrets.map((secret, index: number) => (
                <div
                  ref={secretToHighlight === secret.id ? highlightedRef : null}
                  className={clsx(
                    'flex items-center gap-2 py-1 px-3 rounded-md',
                    secretToHighlight === secret.id &&
                      'ring-1 ring-inset ring-emerald-100 dark:ring-emerald-900 bg-emerald-400/10'
                  )}
                  key={secret.id}
                >
                  <span className="text-neutral-500 font-mono w-5">{index + 1}</span>
                  <SecretRow
                    orgId={organisation.id}
                    secret={secret as SecretType}
                    environment={environment}
                    cannonicalSecret={cannonicalSecret(secret.id)}
                    secretNames={secretNames}
                    handlePropertyChange={handleUpdateSecretProperty}
                    handleDelete={stageSecretForDelete}
                    globallyRevealed={globallyRevealed}
                    stagedForDelete={secretsToDelete.includes(secret.id)}
                  />
                </div>
              ))}

            {filteredSecrets.length === 0 && filteredFolders.length === 0 && (
              <EmptyState
                title={searchQuery ? `No results for "${searchQuery}"` : 'No secrets here'}
                subtitle="Add secrets or folders here to get started"
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    {searchQuery ? <MdSearchOff /> : <FaMagic />}
                  </div>
                }
              >
                <NewSecretMenu />
              </EmptyState>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
