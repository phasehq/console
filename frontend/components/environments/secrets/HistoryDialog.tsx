import { SecretType, SecretEventType, ApiSecretEventEventTypeChoices } from '@/apollo/graphql'
import { relativeTimeFromDates } from '@/utils/time'
import clsx from 'clsx'
import { GetSecretHistory } from '@/graphql/queries/secrets/getSecretHistory.gql'
import { useState, useEffect, useContext, useRef } from 'react'
import { FaHistory, FaKey } from 'react-icons/fa'
import { SecretPropertyDiffs } from './SecretPropertyDiffs'
import { Button } from '../../common/Button'
import GenericDialog from '@/components/common/GenericDialog'
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
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [clientSecret, setClientSecret] = useState<SecretType | null>(null)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const decryptHistoryEvent = async (event: SecretEventType, envKeyring: EnvKeyring) => {
    const decryptedEvent = { ...event }
    const { publicKey, privateKey } = envKeyring

    decryptedEvent.key = await decryptAsymmetric(event.key, privateKey, publicKey)

    if (event.value) {
      decryptedEvent.value = await decryptAsymmetric(event.value, privateKey, publicKey)
    } else {
      decryptedEvent.value = ''
    }

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

    if (keyring && isDialogOpen) fetchAndDecryptHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyring, isDialogOpen, secret, getHistory])

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
        <div className="flex items-center gap-1 text-xs">
          <Avatar member={log.user} size="sm" />
          {log.user.fullName || log.user.email}
        </div>
      )
    else if (log.serviceToken)
      return (
        <div className="flex items-center gap-1 text-xs">
          <FaKey /> {log.serviceToken ? log.serviceToken.name : 'Service token'}
        </div>
      )
    else if (log.serviceAccount)
      return (
        <div
          className={clsx(
            'flex items-center gap-1 text-xs',
            log.serviceAccount.deletedAt && 'grayscale'
          )}
        >
          <Avatar serviceAccount={log.serviceAccount} size="sm" />
          <span className={clsx(log.serviceAccount.deletedAt ? 'line-through' : '')}>
            {log.serviceAccount.name}
          </span>{' '}
          {log.serviceAccount.deletedAt && (
            <span className="text-neutral-500 font-normal">(Deleted)</span>
          )}
          {log.serviceAccountToken &&
            !log.serviceAccount.deletedAt &&
            ` (${log.serviceAccountToken.name})`}
        </div>
      )
  }

  const secretHistory = clientSecret?.history

  return (
    <GenericDialog
      ref={dialogRef}
      title="View secret history"
      dialogTitle={
        <div>
          <h3 className="text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
            <span className="font-mono ph-no-capture">
              {secret.key}
            </span>{' '}
            history
          </h3>
          <div className="text-neutral-500 text-xs">
            View the chronological history of changes made to this secret.
          </div>
        </div>
      }
      buttonVariant="outline"
      buttonContent={
        <>
          <span className="py-1">
            <FaHistory className="shrink-0" />
          </span>
          <span className="hidden 2xl:block text-xs">History</span>
        </>
      }
      buttonProps={{ tabIndex: -1 }}
      onOpen={() => setIsDialogOpen(true)}
      onClose={() => setIsDialogOpen(false)}
    >
      {loading || !secretHistory ? (
        <div className="py-8 flex justify-center">
          <Spinner size="sm" />
        </div>
      ) : (
        <div className="space-y-4 py-4">
          <div className="max-h-[800px] overflow-y-auto px-2">
            <div className="space-y-4 pb-4 border-l border-zinc-300 dark:border-zinc-700">
              {secretHistory?.map((historyItem, index) => (
                <div key={historyItem!.timestamp} className="pb-4 space-y-2">
                  <div className="flex flex-row items-center gap-2 -ml-1">
                    <span
                      className={clsx(
                        'h-2 w-2 rounded-full',
                        getEventTypeColor(historyItem!.eventType)
                      )}
                    ></span>
                    <div className="text-zinc-800 dark:text-zinc-200 font-medium text-xs">
                      {getEventTypeText(historyItem!.eventType)}
                    </div>
                    <div
                      className="text-neutral-500 text-xs"
                      title={new Date(historyItem!.timestamp).toLocaleTimeString()}
                    >
                      {relativeTimeFromDates(new Date(historyItem!.timestamp))}
                    </div>
                    <span className="text-neutral-500 text-xs">by</span>

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
                      onRestore={() => dialogRef.current?.closeModal()}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </GenericDialog>
  )
}
