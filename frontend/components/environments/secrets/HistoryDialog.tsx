import { SecretType, SecretEventType, ApiSecretEventEventTypeChoices } from '@/apollo/graphql'
import { relativeTimeFromDates } from '@/utils/time'
import clsx from 'clsx'
import { GetSecretHistory } from '@/graphql/queries/secrets/getSecretHistory.gql'
import { useState, Fragment, useEffect, useContext } from 'react'
import { FaHistory, FaKey, FaRobot, FaTimes } from 'react-icons/fa'
import { SecretPropertyDiffs } from './SecretPropertyDiffs'
import { Button } from '../../common/Button'
import { Dialog, Transition } from '@headlessui/react'
import { Avatar } from '../../common/Avatar'
import { useLazyQuery } from '@apollo/client'
import {
  EnvKeyring,
  getUserKxPublicKey,
  getUserKxPrivateKey,
  decryptAsymmetric,
  envKeyring,
} from '@/utils/crypto'
import { KeyringContext } from '@/contexts/keyringContext'
import Spinner from '@/components/common/Spinner'

export const HistoryDialog = ({
  secret,
  handlePropertyChange,
}: {
  secret: SecretType
  handlePropertyChange: Function
}) => {
  const { keyring } = useContext(KeyringContext)
  const [getHistory, { loading }] = useLazyQuery(GetSecretHistory, {
    fetchPolicy: 'cache-and-network',
  })
  const [isOpen, setIsOpen] = useState(false)
  const [clientSecret, setClientSecret] = useState<SecretType | null>(null)

  const closeModal = () => setIsOpen(false)
  const openModal = () => setIsOpen(true)

  const decryptHistoryEvent = async (event: SecretEventType, envKeyring: EnvKeyring) => {
    const decryptedEvent = { ...event }
    const { publicKey, privateKey } = envKeyring

    decryptedEvent.key = await decryptAsymmetric(event.key, privateKey, publicKey)
    decryptedEvent.value = await decryptAsymmetric(event.value, privateKey, publicKey)

    if (decryptedEvent.comment) {
      decryptedEvent.comment = await decryptAsymmetric(event.comment, privateKey, publicKey)
    }

    return decryptedEvent
  }

  const decryptSecretHistory = async (secret: SecretType, envKeyring: EnvKeyring) => {
    if (!secret.history || secret.history.length === 0) return secret

    const decryptedHistory = await Promise.all(
      secret.history.map((event) => decryptHistoryEvent(event!, envKeyring))
    )

    return { ...secret, history: decryptedHistory }
  }

  useEffect(() => {
    const fetchAndDecryptHistory = async () => {
      try {
        const { data } = await getHistory({
          variables: {
            appId: secret.environment.app.id,
            envId: secret.environment.id,
            id: secret.id,
          },
        })

        if (data && keyring) {
          const wrappedSeed = data.environmentKeys[0].wrappedSeed

          const userKxKeys = {
            publicKey: await getUserKxPublicKey(keyring.publicKey),
            privateKey: await getUserKxPrivateKey(keyring.privateKey),
          }
          const seed = await decryptAsymmetric(
            wrappedSeed,
            userKxKeys.privateKey,
            userKxKeys.publicKey
          )

          const { publicKey, privateKey } = await envKeyring(seed)

          const decryptedSecret = await decryptSecretHistory(data.secrets[0], {
            privateKey,
            publicKey,
            salt: '',
          })

          setClientSecret(decryptedSecret)
        }
      } catch (error) {
        console.error('Error fetching or decrypting secret history:', error)
      }
    }

    if (keyring && isOpen) fetchAndDecryptHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyring, isOpen, secret, getHistory])

  const getEventTypeColor = (eventType: ApiSecretEventEventTypeChoices) => {
    if (eventType === ApiSecretEventEventTypeChoices.C) return 'bg-emerald-500'
    if (eventType === ApiSecretEventEventTypeChoices.U) return 'bg-yellow-500'
    if (eventType === ApiSecretEventEventTypeChoices.R) return 'bg-blue-500'
    if (eventType === ApiSecretEventEventTypeChoices.D) return 'bg-red-500'
  }

  const getEventTypeText = (eventType: ApiSecretEventEventTypeChoices) => {
    if (eventType === ApiSecretEventEventTypeChoices.C) return 'Created'
    if (eventType === ApiSecretEventEventTypeChoices.U) return 'Updated'
    if (eventType === ApiSecretEventEventTypeChoices.R) return 'Read'
    if (eventType === ApiSecretEventEventTypeChoices.D) return 'Deleted'
  }

  const eventCreatedBy = (log: SecretEventType) => {
    if (log.user)
      return (
        <div className="flex items-center gap-1 text-sm">
          <Avatar member={log.user} size="sm" />
          {log.user.fullName || log.user.email}
        </div>
      )
    else if (log.serviceToken)
      return (
        <div className="flex items-center gap-1 text-sm">
          <FaKey /> {log.serviceToken ? log.serviceToken.name : 'Service token'}
        </div>
      )
    else if (log.serviceAccount)
      return (
        <div className="flex items-center gap-1 text-sm">
          <Avatar serviceAccount={log.serviceAccount} size="sm" />
          {log.serviceAccount.name}
          {log.serviceAccountToken && ` (${log.serviceAccountToken.name})`}
        </div>
      )
  }

  const secretHistory = clientSecret?.history

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="outline" onClick={openModal} title="View secret history" tabIndex={-1}>
          <FaHistory /> <span className="hidden 2xl:block text-xs">History</span>
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
                {loading || !secretHistory ? (
                  <div>
                    <Spinner size="sm" />
                  </div>
                ) : (
                  <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                    <Dialog.Title as="div" className="flex w-full justify-between items-start">
                      <div>
                        <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                          <span className="text-zinc-700 dark:text-zinc-200 font-mono ph-no-capture">
                            {secret.key}
                          </span>{' '}
                          history
                        </h3>
                        <div className="text-neutral-500 text-sm">
                          View the chronological history of changes made to this secret.
                        </div>
                      </div>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <div className="space-y-8 py-4">
                      <div className="max-h-[800px] overflow-y-auto px-2">
                        <div className="space-y-4 pb-4 border-l border-zinc-300 dark:border-zinc-700">
                          {secretHistory?.map((historyItem, index) => (
                            <div key={historyItem!.timestamp} className="pb-8 space-y-2">
                              <div className="flex flex-row items-center gap-2 -ml-1">
                                <span
                                  className={clsx(
                                    'h-2 w-2 rounded-full',
                                    getEventTypeColor(historyItem!.eventType)
                                  )}
                                ></span>
                                <div className="text-zinc-800 dark:text-zinc-200 font-semibold">
                                  {getEventTypeText(historyItem!.eventType)}
                                </div>
                                <div
                                  className="text-neutral-500 text-sm"
                                  title={new Date(historyItem!.timestamp).toLocaleTimeString()}
                                >
                                  {relativeTimeFromDates(new Date(historyItem!.timestamp))}
                                </div>
                                <span className="text-neutral-500 text-sm">by</span>

                                <div className="text-zinc-900 dark:text-zinc-100">
                                  {eventCreatedBy(historyItem!)}
                                </div>
                              </div>
                              {index > 0 && (
                                <SecretPropertyDiffs
                                  secret={clientSecret}
                                  historyItem={historyItem!}
                                  index={index}
                                  handlePropertyChange={handlePropertyChange}
                                  onRestore={closeModal}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Dialog.Panel>
                )}
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
