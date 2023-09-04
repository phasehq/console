'use client'

import { EnvironmentType, SecretInput, SecretType } from '@/apollo/graphql'
import UnlockKeyringDialog from '@/components/auth/UnlockKeyringDialog'
import { KeyringContext } from '@/contexts/keyringContext'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { GetSecrets } from '@/graphql/queries/secrets/getSecrets.gql'
import { CreateNewSecret } from '@/graphql/mutations/environments/createSecret.gql'
import { UpdateSecret } from '@/graphql/mutations/environments/editSecret.gql'
import { DeleteSecretOp } from '@/graphql/mutations/environments/deleteSecret.gql'
import { GetEnvironmentTokens } from '@/graphql/queries/secrets/getEnvironmentTokens.gql'
import { CreateEnvToken } from '@/graphql/mutations/environments/createEnvironmentToken.gql'
import {
  getUserKxPublicKey,
  getUserKxPrivateKey,
  decryptAsymmetric,
  digest,
  encryptAsymmetric,
} from '@/utils/crypto'
import { arraysEqual, envKeyring, generateEnvironmentToken } from '@/utils/environments'
import { useMutation, useQuery } from '@apollo/client'
import { useContext, useEffect, useState } from 'react'
import { Button } from '@/components/common/Button'
import { FaDownload, FaPlus, FaSearch, FaTimesCircle, FaUndo } from 'react-icons/fa'
import SecretRow from '@/components/environments/SecretRow'
import clsx from 'clsx'
import { toast } from 'react-toastify'

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

  const [envKeys, setEnvKeys] = useState<EnvKeyring | null>(null)
  const [secrets, setSecrets] = useState<SecretType[]>([])
  const [updatedSecrets, updateSecrets] = useState<SecretType[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')

  const { data: orgsData } = useQuery(GetOrganisations)

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

  const { data, loading } = useQuery(GetSecrets, {
    variables: {
      appId: params.app,
      envId: params.environment,
    },
    pollInterval: unsavedChanges ? 0 : 5000,
  })

  const [createSecret] = useMutation(CreateNewSecret)
  const [updateSecret] = useMutation(UpdateSecret)
  const [deleteSecret] = useMutation(DeleteSecretOp)

  const [createEnvironmentToken] = useMutation(CreateEnvToken)

  const { data: envTokensData } = useQuery(GetEnvironmentTokens, {
    variables: {
      envId: params.environment,
    },
  })

  const environment = data?.appEnvironments[0] as EnvironmentType

  const handleAddSecret = () => {
    const newSecret = {
      id: `new-${crypto.randomUUID()}`,
      updatedAt: null,
      version: 1,
      key: '',
      value: '',
      tags: [],
      comment: '',
    } as SecretType
    updateSecrets([...updatedSecrets, newSecret])
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

  const handleCreateNewEnvToken = async () => {
    if (keyring) {
      const userKxKeys = {
        publicKey: await getUserKxPublicKey(keyring.publicKey),
        privateKey: await getUserKxPrivateKey(keyring.privateKey),
      }

      const { pssEnv, mutationPayload } = await generateEnvironmentToken(
        environment,
        data.environmentKeys[0],
        userKxKeys
      )

      await createEnvironmentToken({
        variables: mutationPayload,
        refetchQueries: [
          {
            query: GetEnvironmentTokens,
            variables: {
              envId: environment.id,
            },
          },
        ],
      })

      console.log(pssEnv)
    } else {
      console.log('keyring unavailable')
    }
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
      const originalSecret = secrets[i]
      const updatedSecret = updatedSecrets[i]

      if (updatedSecret.id.split('-')[0] === 'new') changedElements.push(updatedSecret)
      else if (
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
    const changedSecrets = getUpdatedSecrets()
    if (changedSecrets.some((secret) => secret.key.length === 0)) {
      toast.error('Secret keys cannot be empty!')
      return false
    }

    if (duplicateKeysExist()) {
      toast.error('Secret keys cannot be repeated!')
      return false
    }

    const updates = changedSecrets.map((secret) => handleUpdateSecret(secret))

    await Promise.all(updates)

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

  return (
    <div className="max-h-screen overflow-y-auto w-full text-black dark:text-white">
      {orgsData?.organisations && (
        <UnlockKeyringDialog organisationId={orgsData.organisations[0].id} />
      )}
      {keyring !== null && !loading && (
        <div className="flex flex-col p-4 gap-8">
          <div className="h3 font-semibold text-2xl">
            {environment.name}
            {unsavedChanges && (
              <span className="text-amber-500 cursor-default" title="Environment has been modified">
                *
              </span>
            )}
          </div>
          <div className="flex items-center w-full justify-between border-b border-zinc-300 dark:border-zinc-700 pb-4">
            <div className="relative flex items-center bg-white dark:bg-zinc-800 rounded-md px-2">
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
              <Button variant="outline" onClick={downloadEnvFile} title="Download as .env file">
                <span className="px-2 py-1">
                  <FaDownload className="text-lg" />
                </span>
              </Button>
              {unsavedChanges && (
                <Button variant="outline" onClick={handleDiscardChanges} title="Discard changes">
                  <span className="px-2 py-1">
                    <FaUndo className="text-lg" />
                  </span>
                </Button>
              )}
              <Button
                variant={unsavedChanges ? 'warning' : 'primary'}
                disabled={!unsavedChanges}
                onClick={handleSaveChanges}
              >
                <span className="text-lg">{unsavedChanges ? 'Deploy' : 'Deployed'}</span>
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {filteredSecrets.map((secret, index: number) => (
              <div className="flex items-center gap-2" key={secret.id}>
                <span className="text-neutral-500 font-mono w-5">{index + 1}</span>
                <SecretRow
                  orgId={orgsData.organisations[0].id}
                  secret={secret as SecretType}
                  cannonicalSecret={cannonicalSecret(secret.id)}
                  secretNames={secretNames}
                  handlePropertyChange={handleUpdateSecretProperty}
                  handleDelete={handleDeleteSecret}
                />
              </div>
            ))}

            <div className="col-span-2 flex mt-4">
              <Button variant="primary" onClick={handleAddSecret}>
                <div className="flex items-center gap-2">
                  <FaPlus /> Create new secret
                </div>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
