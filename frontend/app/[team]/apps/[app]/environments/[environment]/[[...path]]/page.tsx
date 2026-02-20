'use client'

import {
  ApiOrganisationPlanChoices,
  DynamicSecretType,
  EnvironmentType,
  SecretFolderType,
  SecretInput,
  SecretType,
} from '@/apollo/graphql'
import { KeyringContext } from '@/contexts/keyringContext'
import { GetSecrets } from '@/graphql/queries/secrets/getSecrets.gql'
import { GetFolders } from '@/graphql/queries/secrets/getFolders.gql'
import { BulkProcessSecrets } from '@/graphql/mutations/environments/bulkProcessSecrets.gql'
import { DeleteFolder } from '@/graphql/mutations/environments/deleteFolder.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { CreateNewSecretFolder } from '@/graphql/mutations/environments/createFolder.gql'
import { LogSecretReads } from '@/graphql/mutations/environments/readSecret.gql'
import { TbDownload } from 'react-icons/tb'
import { useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useRef, useState, useMemo, useCallback } from 'react'
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
  FaCloudUploadAlt,
  FaBan,
} from 'react-icons/fa'
import SecretRow from '@/components/environments/secrets/SecretRow'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { Dialog, Menu, Transition } from '@headlessui/react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { EnvSyncStatus } from '@/components/syncing/EnvSyncStatus'
import { Input } from '@/components/common/Input'
import { SplitButton } from '@/components/common/SplitButton'
import { SecretFolderRow } from '@/components/environments/folders/SecretFolderRow'
import { MdKeyboardReturn, MdPassword, MdSearchOff } from 'react-icons/md'
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
import { escapeRegExp } from 'lodash'
import { EmptyState } from '@/components/common/EmptyState'
import {
  duplicateKeysExist,
  exportToEnvFile,
  normalizeKey,
  processEnvFile,
  SortOption,
  sortSecrets,
} from '@/utils/secrets'
import SortMenu from '@/components/environments/secrets/SortMenu'

import { DeployPreview } from '@/components/environments/secrets/DeployPreview'
import { userHasPermission } from '@/utils/access/permissions'
import { EnvironmentPageSkeleton } from './_components/EnvironmentPageSkeleton'
import EnvFileDropZone from '@/components/environments/secrets/import/EnvFileDropZone'
import SingleEnvImportDialog from '@/components/environments/secrets/import/SingleEnvImportDialog'
import { useWarnIfUnsavedChanges } from '@/hooks/warnUnsavedChanges'
import { FaBolt } from 'react-icons/fa6'
import { CreateDynamicSecretDialog } from '@/ee/components/secrets/dynamic/CreateDynamicSecretDialog'
import { DynamicSecretRow } from '@/ee/components/secrets/dynamic/DynamicSecretRow'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'
import { UpsellDialog } from '@/components/settings/organisation/UpsellDialog'

export default function EnvironmentPath({
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

  const [dynamicSecrets, setDynamicSecrets] = useState<DynamicSecretType[]>([])

  const [secretsLoaded, setSecretsLoaded] = useState(false)
  const [decrypting, setDecrypting] = useState(false)

  const [secretsToDelete, setSecretsToDelete] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isLoading, setIsloading] = useState(false)
  const [folderMenuIsOpen, setFolderMenuIsOpen] = useState<boolean>(false)
  const [globallyRevealed, setGloballyRevealed] = useState<boolean>(false)

  const importDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const dynamicSecretDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const upsellDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  const [sort, setSort] = useState<SortOption>('-created')

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'read',
    true
  )
  const userCanReadSecrets = userHasPermission(
    organisation?.role?.permissions,
    'Secrets',
    'read',
    true
  )
  const userCanCreateSecrets = userHasPermission(
    organisation?.role?.permissions,
    'Secrets',
    'create',
    true
  )
  const userCanReadSyncs = userHasPermission(
    organisation?.role?.permissions,
    'Integrations',
    'read',
    true
  )

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
    setSecretsLoaded(false)
  }, [params.environment, params.app, params.team])

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

  const unsavedChanges = useMemo(() => {
    if (serverSecrets.length !== clientSecrets.length) return true
    if (secretsToDelete.length > 0) return true

    // Faster lookup than index-pairing
    const mapById = new Map(clientSecrets.map((s) => [s.id, s]))
    for (const secret of serverSecrets) {
      const updated = mapById.get(secret.id)
      if (!updated) return true
      if (
        secret.comment !== updated.comment ||
        secret.key !== updated.key ||
        !arraysEqual(secret.tags, updated.tags) ||
        secret.value !== updated.value
      ) {
        return true
      }
    }
    return false
  }, [serverSecrets, clientSecrets, secretsToDelete])

  useWarnIfUnsavedChanges(unsavedChanges)

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId: params.app,
    },
    skip: !userCanReadEnvironments,
  })

  const { data, loading } = useQuery(GetSecrets, {
    variables: {
      appId: params.app,
      envId: params.environment,
      path: secretPath,
    },
    skip: !userCanReadSecrets,
    pollInterval: unsavedChanges ? 0 : 5000,
  })

  const folders: SecretFolderType[] = useMemo(() => {
    return data?.folders ?? []
  }, [data?.folders])

  const savingAndFetching = isLoading || loading

  const [bulkProcessSecrets] = useMutation(BulkProcessSecrets)

  const [createFolder] = useMutation(CreateNewSecretFolder)
  const [deleteFolder] = useMutation(DeleteFolder)

  const envPath = (env: EnvironmentType) => {
    return `/${params.team}/apps/${params.app}/environments/${env.id}${secretPath}`
  }

  const environment = data?.appEnvironments[0] as EnvironmentType
  //const dynamicSecrets: DynamicSecretType[] = data?.dynamicSecrets ?? []

  const envLinks =
    appEnvsData?.appEnvironments
      .filter((env: EnvironmentType) => env.name !== environment?.name)
      .map((env: EnvironmentType) => {
        return {
          label: env.name,
          href: envPath(env),
        }
      }) ?? []

  const handleAddSecret = (start: boolean = true, key: string = '') => {
    const newSecret = {
      id: `new-${crypto.randomUUID()}`,
      updatedAt: null,
      version: 1,
      key: key,
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

  const handleCreateSecretFromSearch = () => {
    const normalizedKey = normalizeKey(searchQuery)
    if (!normalizedKey) return

    handleAddSecret(true, normalizedKey)
    setSearchQuery('')
  }

  /**
   * Bulk adds secrets to client state from an import
   *
   * If a secret key being imported already exists, we update the value and comment.
   * Otherwise, we process the import as normal, adding it as a new secret
   *
   * @param {SecretType[]} secrets - Secrets being imported into client state
   */
  const bulkAddSecrets = (secrets: SecretType[]) => {
    const existingSecrets = new Map(clientSecrets.map((secret) => [secret.key, secret]))
    const newSecretsToAdd = secrets.filter((secret) => !existingSecrets.has(secret.key))
    const secretsToUpdate = secrets.filter((secret) => existingSecrets.has(secret.key))

    secretsToUpdate.forEach((secret) => {
      setClientSecrets((prev) =>
        prev.map((s) =>
          s.key === secret.key ? { ...s, ...{ value: secret.value, comment: secret.comment } } : s
        )
      )
    })

    const secretsWithImportFlag = newSecretsToAdd.map((secret) => ({
      ...secret,
      isImported: true,
    }))

    setClientSecrets((prev) => [...prev, ...secretsWithImportFlag])
  }

  // Set the global reveal to true if there are no secrets
  // Newly created secrets are revealed by default, so this is a better default in this case
  useEffect(() => {
    if (serverSecrets.length === 0) setGloballyRevealed(true)
    else setGloballyRevealed(false)
  }, [serverSecrets])

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

  const stageSecretForDelete = useCallback((id: string) => {
    setClientSecrets((prev) => {
      if (id.startsWith('new-')) return prev.filter((s) => s.id !== id)
      return prev
    })
    setSecretsToDelete((prev) => {
      if (id.startsWith('new-')) return prev
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    })
  }, [])

  const handleDeleteFolder = useCallback(
    async (id: string) => {
      await deleteFolder({
        variables: { folderId: id },
        refetchQueries: [
          { query: GetFolders, variables: { envId: params.environment, path: secretPath } },
        ],
      })
      toast.success('Folder deleted.')
    },
    [deleteFolder, params.environment, secretPath]
  )

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
      setDecrypting(true)
      const decryptSecrets = async () => {
        const decryptedStaticSecrets = await Promise.all(
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

        //Decrypt dynamic secrets keyMap.keyName
        const decryptedDynamicSecrets = await Promise.all(
          (data.dynamicSecrets ?? []).map(async (secret: DynamicSecretType) => {
            const decryptedSecret = structuredClone(secret)
            if (decryptedSecret.keyMap && Array.isArray(decryptedSecret.keyMap)) {
              decryptedSecret.keyMap = await Promise.all(
                decryptedSecret.keyMap.map(async (keyMapItem) => ({
                  ...keyMapItem,
                  keyName: keyMapItem?.keyName
                    ? await decryptAsymmetric(
                        keyMapItem.keyName,
                        envKeys.privateKey,
                        envKeys.publicKey
                      )
                    : keyMapItem?.keyName,
                }))
              )
            }
            return decryptedSecret
          })
        )

        return { decryptedStaticSecrets, decryptedDynamicSecrets }
      }

      decryptSecrets().then((decryptedSecrets) => {
        setServerSecrets(decryptedSecrets.decryptedStaticSecrets)
        setClientSecrets(decryptedSecrets.decryptedStaticSecrets)
        setDynamicSecrets(decryptedSecrets.decryptedDynamicSecrets)
        setDecrypting(false)
        setSecretsLoaded(true)
      })
    }
  }, [envKeys, data])

  const handleUpdateSecretProperty = useCallback((id: string, property: string, value: any) => {
    setClientSecrets((prev) => prev.map((s) => (s.id === id ? { ...s, [property]: value } : s)))
  }, [])

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

  const handleSaveChanges = async () => {
    setIsloading(true)
    const changedSecrets = getUpdatedSecrets()
    if (changedSecrets.some((secret) => secret.key.length === 0)) {
      toast.error('Secret keys cannot be empty!')
      setIsloading(false)
      return false
    }

    if (duplicateKeysExist(clientSecrets, dynamicSecrets)) {
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

  const secretNames = useMemo(
    () => serverSecrets.map(({ id, key }) => ({ id, key })),
    [serverSecrets]
  )

  // Fast lookup for canonical secrets by id
  const serverSecretsById = useMemo(
    () => new Map(serverSecrets.map((s) => [s.id, s] as const)),
    [serverSecrets]
  )

  const canonicalSecret = useCallback(
    (id: string) => serverSecretsById.get(id),
    [serverSecretsById]
  )

  const filteredFolders = useMemo(() => {
    if (searchQuery === '') return folders
    const re = new RegExp(escapeRegExp(searchQuery), 'i')
    return folders.filter((f) => re.test(f.name))
  }, [folders, searchQuery])

  const filteredSecrets = useMemo(() => {
    if (searchQuery === '') return clientSecrets
    const re = new RegExp(escapeRegExp(searchQuery), 'i')
    return clientSecrets.filter((s) => re.test(s.key) || re.test(s.value))
  }, [clientSecrets, searchQuery])

  const filteredAndSortedSecrets = useMemo(
    () => sortSecrets(filteredSecrets, sort),
    [filteredSecrets, sort]
  )

  const filteredDynamicSecrets = useMemo(() => {
    if (searchQuery === '') return dynamicSecrets
    const re = new RegExp(escapeRegExp(searchQuery), 'i')
    return dynamicSecrets.filter((s) =>
      re.test(`${s.name}${(s.keyMap ?? []).map((k) => k?.keyName).join('')}`)
    )
  }, [dynamicSecrets, searchQuery])

  // Add this (was missing -> ReferenceError: noSecrets is not defined)
  const noSecrets =
    filteredAndSortedSecrets.length === 0 &&
    filteredFolders.length === 0 &&
    filteredDynamicSecrets.length === 0

  const downloadEnvFile = () => {
    exportToEnvFile(serverSecrets, environment.app.name, environment.name, secretPath)
    logGlobalReveals()
  }

  const NewFolderMenu = () => {
    const [name, setName] = useState<string>('')
    const inputRef = useRef(null)

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
          <Dialog as="div" className="relative z-10" onClose={handleClose} initialFocus={inputRef}>
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
                          ref={inputRef}
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

  const NewSecretMenu = () => {
    const userCanCreateSecrets = userHasPermission(
      organisation?.role?.permissions,
      'Secrets',
      'create',
      true
    )

    const allowDynamicSecrets = organisation?.plan === ApiOrganisationPlanChoices.En

    if (!userCanCreateSecrets) return <></>
    return (
      <SplitButton
        variant="primary"
        onClick={() => handleAddSecret(true)}
        menuContent={
          <div className="w-max flex flex-col items-start gap-1">
            <Button
              variant="secondary"
              onClick={() =>
                allowDynamicSecrets
                  ? dynamicSecretDialogRef.current?.openModal()
                  : upsellDialogRef.current?.openModal()
              }
            >
              <FaBolt /> Dynamic Secret{' '}
              {!allowDynamicSecrets && <PlanLabel plan={ApiOrganisationPlanChoices.En} />}
            </Button>

            <Button variant="secondary" onClick={() => setFolderMenuIsOpen(true)}>
              <div className="flex items-center gap-2">
                <FaFolderPlus /> New Folder
              </div>
            </Button>

            <Button variant="secondary" onClick={() => importDialogRef.current?.openModal()}>
              <div className="flex items-center gap-2">
                <TbDownload /> Import secrets
              </div>
            </Button>
          </div>
        }
      >
        <FaPlus /> New Secret
      </SplitButton>
    )
  }

  // Track secret readiness. Show skeleton while: loading query, no org, decrypting, or waiting for envKeys to initialize
  const isResolving = loading || decrypting || (data && !envKeys)
  const isInitializing = !organisation || (!secretsLoaded && isResolving)

  if (isInitializing) return <EnvironmentPageSkeleton />

  if (!userCanReadEnvironments || !userCanReadSecrets)
    return (
      <div className="h-full max-h-screen overflow-y-auto w-full flex items-center justify-center">
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view Secrets in this app."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      </div>
    )

  const EmptyStateFileImport = () => {
    const handleFileSelection = (fileString: string) => {
      const secrets: SecretType[] = processEnvFile(fileString, environment, '/')
      bulkAddSecrets(secrets)
    }

    return <EnvFileDropZone onFileProcessed={(content) => handleFileSelection(content)} />
  }

  return (
    <div className="h-full max-h-screen overflow-y-auto w-full text-black dark:text-white">
      {keyring !== null && !loading && (
        <div className="flex flex-col py-4 bg-zinc-200 dark:bg-zinc-900">
          <div className="flex items-center gap-8 justify-between w-full">
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
            </div>
            <div>
              {unsavedChanges && (
                <DeployPreview
                  clientSecrets={clientSecrets}
                  serverSecrets={serverSecrets}
                  secretsToDelete={secretsToDelete}
                />
              )}
            </div>
          </div>
          <div className="space-y-0 sticky top-0 z-5 bg-zinc-200/50 dark:bg-zinc-900/50 backdrop-blur">
            <div className="flex items-center w-full justify-between border-b border-zinc-300 dark:border-zinc-700 py-4  backdrop-blur-md">
              <div className="flex items-center gap-4">
                <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2">
                  <div className="">
                    <FaSearch className="text-neutral-500" />
                  </div>
                  <input
                    placeholder="Search keys or values"
                    className="custom bg-zinc-100 dark:bg-zinc-800 placeholder:text-neutral-500"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <FaTimesCircle
                    className={clsx(
                      'cursor-pointer text-neutral-500 transition-opacity ease',
                      searchQuery
                        ? 'opacity-100 pointer-events-auto'
                        : 'opacity-0 pointer-events-none'
                    )}
                    role="button"
                    onClick={() => setSearchQuery('')}
                  />
                </div>
                <div className="relative z-20">
                  <SortMenu sort={sort} setSort={setSort} />
                </div>
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

                {data.envSyncs && userCanReadSyncs && (
                  <div>
                    <EnvSyncStatus syncs={data.envSyncs} team={params.team} app={params.app} />
                  </div>
                )}

                <Button
                  variant={unsavedChanges ? 'primary' : 'secondary'}
                  disabled={!unsavedChanges || savingAndFetching}
                  isLoading={savingAndFetching}
                  onClick={handleSaveChanges}
                >
                  <div className="flex items-center gap-2 text-lg">
                    {!savingAndFetching &&
                      (unsavedChanges ? (
                        <FaCloudUploadAlt className="text-emerald-500 shrink-0" />
                      ) : (
                        <FaCheckCircle className="text-emerald-500 shrink-0" />
                      ))}
                    <span>{unsavedChanges ? 'Deploy' : 'Deployed'}</span>
                  </div>
                </Button>
              </div>
            </div>

            <SingleEnvImportDialog
              environment={environment}
              path={'/'}
              addSecrets={bulkAddSecrets}
              ref={importDialogRef}
            />

            {!noSecrets && (
              <div className="flex items-center w-full">
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
          </div>

          <div className="flex flex-col gap-0 divide-y divide-neutral-500/20 bg-zinc-100 dark:bg-zinc-800 rounded-md shadow-md">
            <NewFolderMenu />
            <CreateDynamicSecretDialog
              environment={environment}
              path={secretPath}
              ref={dynamicSecretDialogRef}
            />
            <UpsellDialog ref={upsellDialogRef} title="Upgrade to Enterprise" />

            {organisation &&
              filteredFolders.map((folder: SecretFolderType) => (
                <SecretFolderRow
                  key={folder.id}
                  folder={folder}
                  handleDelete={handleDeleteFolder}
                />
              ))}

            {environment &&
              filteredDynamicSecrets.map((secret) => (
                <DynamicSecretRow key={secret.id} secret={secret} environment={environment} />
              ))}

            {organisation &&
              filteredAndSortedSecrets.map((secret, index: number) => (
                <div
                  ref={secretToHighlight === secret.id ? highlightedRef : null}
                  className={clsx(
                    'flex items-start gap-2 py-1 px-3 rounded-md',
                    secretToHighlight === secret.id &&
                      'ring-1 ring-inset ring-emerald-100 dark:ring-emerald-900 bg-emerald-400/20'
                  )}
                  key={secret.id}
                >
                  <div className="text-neutral-500 font-mono w-5 h-10 flex items-center">
                    {index + 1}
                  </div>
                  <SecretRow
                    orgId={organisation.id}
                    secret={secret as SecretType}
                    environment={environment}
                    canonicalSecret={canonicalSecret(secret.id)}
                    secretNames={secretNames}
                    handlePropertyChange={handleUpdateSecretProperty}
                    handleDelete={stageSecretForDelete}
                    globallyRevealed={globallyRevealed}
                    stagedForDelete={secretsToDelete.includes(secret.id)}
                  />
                </div>
              ))}

            {noSecrets && (
              <EmptyState
                title={searchQuery ? `No results for "${searchQuery}"` : 'No secrets here'}
                subtitle="Add secrets or folders here to get started"
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    {searchQuery ? <MdSearchOff /> : <MdPassword />}
                  </div>
                }
              >
                {searchQuery ? (
                  userCanCreateSecrets &&
                  normalizeKey(searchQuery) && (
                    <Button variant="primary" onClick={handleCreateSecretFromSearch}>
                      <FaPlus /> Create &quot;{normalizeKey(searchQuery)}&quot;
                    </Button>
                  )
                ) : (
                  <NewSecretMenu />
                )}
                {!searchQuery && (
                  <div className="w-full max-w-screen-sm h-40 rounded-lg">
                    <EmptyStateFileImport />
                  </div>
                )}
              </EmptyState>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
