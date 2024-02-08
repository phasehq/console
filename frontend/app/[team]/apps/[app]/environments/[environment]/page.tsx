'use client'

import { EnvironmentType, SecretInput, SecretType } from '@/apollo/graphql'
import UnlockKeyringDialog from '@/components/auth/UnlockKeyringDialog'
import { KeyringContext } from '@/contexts/keyringContext'
import { GetSecrets } from '@/graphql/queries/secrets/getSecrets.gql'
import { CreateNewSecret } from '@/graphql/mutations/environments/createSecret.gql'
import { UpdateSecret } from '@/graphql/mutations/environments/editSecret.gql'
import { DeleteSecretOp } from '@/graphql/mutations/environments/deleteSecret.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import {
  getUserKxPublicKey,
  getUserKxPrivateKey,
  decryptAsymmetric,
  digest,
  encryptAsymmetric,
} from '@/utils/crypto'
import { arraysEqual, envKeyring } from '@/utils/environments'
import { useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/common/Button'
import {
  FaChevronDown,
  FaDownload,
  FaExchangeAlt,
  FaPlus,
  FaSearch,
  FaTimesCircle,
  FaUndo,
} from 'react-icons/fa'
import SecretRow from '@/components/environments/SecretRow'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { Menu, Transition } from '@headlessui/react'
import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Alert } from '@/components/common/Alert'
import { EnvSyncStatus } from '@/components/syncing/EnvSyncStatus'

type EnvKeyring = {
  privateKey: string
  publicKey: string
  salt: string
}

export default function Environment({
  params,
}: {
  params: { team: string; app: string; environment: string }
}) {
  const { keyring } = useContext(KeyringContext)
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const secretToHighlight = searchParams?.get('secret')
  const highlightedRef = useRef<HTMLDivElement>(null)

  const [envKeys, setEnvKeys] = useState<EnvKeyring | null>(null)
  const [secrets, setSecrets] = useState<SecretType[]>([])
  const [updatedSecrets, updateSecrets] = useState<SecretType[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isLoading, setIsloading] = useState(false)

  const { activeOrganisation: organisation } = useContext(organisationContext)

  useEffect(() => {
    // 2. Scroll into view when secretToHighlight changes
    if (highlightedRef.current && secrets.length > 0) {
      highlightedRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
    }
  }, [secretToHighlight, secrets])

  const unsavedChanges =
    secrets.length !== updatedSecrets.length ||
    secrets.some((secret, index) => {
      const updatedSecret = updatedSecrets[index]

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
    },
    pollInterval: unsavedChanges ? 0 : 5000,
  })

  const savingAndFetching = isLoading || loading

  const [createSecret] = useMutation(CreateNewSecret)
  const [updateSecret] = useMutation(UpdateSecret)
  const [deleteSecret] = useMutation(DeleteSecretOp)

  const envPath = (env: EnvironmentType) => {
    const pathSegments = pathname!.split('/')
    pathSegments[pathSegments.length - 1] = env.id
    return pathSegments?.join('/')
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
    } as SecretType
    start
      ? updateSecrets([newSecret, ...updatedSecrets])
      : updateSecrets([...updatedSecrets, newSecret])
  }

  const handleUpdateSecret = async (secret: SecretType) => {
    const { id, key, value, comment, tags } = secret

    const encryptedKey = await encryptAsymmetric(key, environment.identityKey)
    const encryptedValue = await encryptAsymmetric(value, environment.identityKey)
    const keyDigest = await digest(key, envKeys!.salt)
    const encryptedComment = await encryptAsymmetric(comment, environment.identityKey)
    const tagIds = tags.map((tag) => tag.id)

    if (id.split('-')[0] === 'new') {
      await createSecret({
        variables: {
          newSecret: {
            envId: params.environment,
            key: encryptedKey,
            keyDigest,
            value: encryptedValue,
            folderId: null,
            comment: encryptedComment,
            tags: tagIds,
          } as SecretInput,
        },
        refetchQueries: [
          {
            query: GetSecrets,
            variables: {
              appId: params.app,
              envId: params.environment,
            },
          },
        ],
      })
    } else {
      await updateSecret({
        variables: {
          id,
          secretData: {
            key: encryptedKey,
            keyDigest,
            value: encryptedValue,
            folderId: null,
            comment: encryptedComment,
            tags: tagIds,
          } as SecretInput,
        },
        refetchQueries: [
          {
            query: GetSecrets,
            variables: {
              appId: params.app,
              envId: params.environment,
            },
          },
        ],
      })
    }
  }

  const handleDeleteSecret = async (id: string) => {
    if (id.split('-')[0] === 'new')
      updateSecrets(updatedSecrets.filter((secret) => secret.id !== id))
    else {
      await deleteSecret({
        variables: {
          id,
        },
        refetchQueries: [
          {
            query: GetSecrets,
            variables: {
              appId: params.app,
              envId: params.environment,
            },
          },
        ],
      })
    }
    toast.success('Secret deleted.')
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
        setSecrets(decryptedSecrets)
        updateSecrets(decryptedSecrets)
      })
    }
  }, [envKeys, data])

  const handleUpdateSecretProperty = (id: string, property: string, value: any) => {
    const updatedSecretList = updatedSecrets.map((secret) => {
      if (secret.id === id) {
        return { ...secret, [property]: value }
      }
      return secret
    })

    updateSecrets(updatedSecretList)
  }

  const getUpdatedSecrets = () => {
    const changedElements = []

    for (let i = 0; i < updatedSecrets.length; i++) {
      const updatedSecret = updatedSecrets[i]
      const originalSecret = secrets.find((secret) => secret.id === updatedSecret.id)

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

    for (const secret of updatedSecrets) {
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

    const updates = changedSecrets.map((secret) => handleUpdateSecret(secret))

    await Promise.all(updates)

    setTimeout(() => setIsloading(false), 500)

    toast.success('Changes successfully deployed.')
  }

  const handleDiscardChanges = () => {
    updateSecrets(secrets)
  }

  const secretNames = secrets.map((secret) => {
    const { id, key } = secret
    return {
      id,
      key,
    }
  })

  const filteredSecrets =
    searchQuery === ''
      ? updatedSecrets
      : updatedSecrets.filter((secret) => {
          const searchRegex = new RegExp(searchQuery, 'i')
          return searchRegex.test(secret.key)
        })

  const cannonicalSecret = (id: string) => secrets.find((secret) => secret.id === id)

  const downloadEnvFile = () => {
    const envContent = secrets
      .map((secret) => {
        const comment = secret.comment ? `#${secret.comment}\n` : ''
        return `${comment}${secret.key}=${secret.value}`
      })
      .join('\n')

    const blob = new Blob([envContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `${environment.name}.env`

    document.body.appendChild(a)
    a.click()

    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // useEffect(() => {
  //   const warningText = 'You have unsaved changes - are you sure you wish to leave this page?'
  //   const handleWindowClose = (e: BeforeUnloadEvent) => {
  //     if (!unsavedChanges) return
  //     e.preventDefault()
  //     return (e.returnValue = warningText)
  //   }
  //   const handleBrowseAway = () => {
  //     if (!unsavedChanges) return
  //     if (window.confirm(warningText)) return
  //     router.events.emit('routeChangeError')
  //     throw 'routeChange aborted.'
  //   }
  //   window.addEventListener('beforeunload', handleWindowClose)
  //   router.events.on('routeChangeStart', handleBrowseAway)
  //   return () => {
  //     window.removeEventListener('beforeunload', handleWindowClose)
  //     router.events.off('routeChangeStart', handleBrowseAway)
  //   }
  // }, [unsavedChanges])

  // const EnvSyncStatus = () => {
  //   const syncStatus = () => {
  //     if (
  //       data.envSyncs.some(
  //         (sync: EnvironmentSyncType) => sync.status === ApiEnvironmentSyncStatusChoices.Failed
  //       )
  //     )
  //       return ApiEnvironmentSyncStatusChoices.Failed
  //     else if (
  //       data.envSyncs.some(
  //         (sync: EnvironmentSyncType) => sync.status === ApiEnvironmentSyncStatusChoices.InProgress
  //       )
  //     )
  //       return ApiEnvironmentSyncStatusChoices.InProgress
  //     else return ApiEnvironmentSyncStatusChoices.Completed
  //   }

  //   if (data?.envSyncs.length > 0) {
  //     return (
  //       <Menu as="div" className="relative inline-block text-left">
  //         {({ open }) => (
  //           <>
  //             <Menu.Button
  //               as="div"
  //               className="p-2 text-neutral-500 font-semibold uppercase tracking-wider cursor-pointer flex items-center justify-between"
  //             >
  //               <SyncStatusIndicator status={syncStatus()} />
  //             </Menu.Button>
  //             <Transition
  //               as={Fragment}
  //               enter="transition ease-out duration-100"
  //               enterFrom="transform opacity-0 scale-95"
  //               enterTo="transform opacity-100 scale-100"
  //               leave="transition ease-in duration-75"
  //               leaveFrom="transform opacity-100 scale-100"
  //               leaveTo="transform opacity-0 scale-95"
  //             >
  //               <Menu.Items className="absolute z-20 -right-2 top-12 w-[512px] md:w-[768px] origin-top-right divide-y divide-neutral-500/40 rounded-md bg-neutral-200/40 dark:bg-neutral-800/40 backdrop-blur-md shadow-2xl focus:outline-none">
  //                 <div className="p-4">
  //                   <div className="space-y-2">
  //                     <div className="flex items-center justify-between">
  //                       <div className="text-black dark:text-white font-medium text-lg flex items-center gap-2">
  //                         <FaSync />
  //                         Syncs
  //                       </div>
  //                       <Link href={`/${params.team}/apps/${params.app}/syncing`}>
  //                         <Button variant="secondary">
  //                           Explore
  //                           <FaArrowRight />
  //                         </Button>
  //                       </Link>
  //                     </div>
  //                     {data.envSyncs.map((sync: EnvironmentSyncType) => (
  //                       <SyncCard key={sync.id} sync={sync} />
  //                     ))}
  //                   </div>
  //                 </div>
  //               </Menu.Items>
  //             </Transition>
  //           </>
  //         )}
  //       </Menu>
  //     )
  //   } else return <></>
  // }

  return (
    <div className="max-h-screen overflow-y-auto w-full text-black dark:text-white">
      {organisation && <UnlockKeyringDialog organisationId={organisation.id} />}
      {keyring !== null && !loading && (
        <div className="flex flex-col p-4 gap-8">
          <div className="flex items-center gap-8">
            {envLinks.length > 1 ? (
              <Menu as="div" className="relative group">
                {({ open }) => (
                  <>
                    <Menu.Button as={Fragment}>
                      <div className="cursor-pointer flex items-center gap-2">
                        <h3 className="font-semibold text-2xl">{environment.name}</h3>
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
                      className="absolute z-10 left-0 origin-bottom-left mt-2"
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
                  searchQuery ? 'opacity-100' : 'opacity-0'
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
                onClick={handleSaveChanges}
              >
                <span className="text-lg">{unsavedChanges ? 'Deploy' : 'Deployed'}</span>
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center w-full sticky top-0 z-10 bg-zinc-200/70 dark:bg-zinc-900/70 backdrop-blur-md">
              <div className="px-9 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                key
              </div>
              <div className="pl-3 pr-14 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-2/3 flex items-center justify-between">
                value
                <Button variant="primary" onClick={() => handleAddSecret(true)}>
                  <div className="flex items-center gap-2">
                    <FaPlus /> Create new secret
                  </div>
                </Button>
              </div>
            </div>
            {organisation &&
              filteredSecrets.map((secret, index: number) => (
                <div
                  ref={secretToHighlight === secret.id ? highlightedRef : null}
                  className={clsx(
                    'flex items-center gap-2 p-1 rounded-md',
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
                    handleDelete={handleDeleteSecret}
                  />
                </div>
              ))}

            <div className="col-span-2 flex mt-4 gap-4 items-center">
              <Button variant="primary" onClick={() => handleAddSecret(false)}>
                <div className="flex items-center gap-2">
                  <FaPlus /> Create new secret
                </div>
              </Button>
              <Button variant="outline" onClick={downloadEnvFile} title="Download as .env file">
                <div className="flex items-center gap-2">
                  <FaDownload /> Export .env
                </div>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
