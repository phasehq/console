'use client'

import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { RotateAppKey } from '@/graphql/mutations/rotateAppKeys.gql'
import { useMutation, useQuery } from '@apollo/client'
import { AppType } from '@/apollo/graphql'
import { Fragment, useContext, useState } from 'react'
import { Button } from '@/components/common/Button'
import { copyToClipBoard } from '@/utils/clipboard'
import { FaBan, FaCopy, FaExclamationTriangle, FaInfo, FaTimes } from 'react-icons/fa'
import { MdContentCopy, MdOutlineRotateLeft } from 'react-icons/md'
import { toast } from 'react-toastify'
import { Dialog, Transition } from '@headlessui/react'
import { Alert } from '@/components/common/Alert'
import { KeyringContext } from '@/contexts/keyringContext'
import clsx from 'clsx'
import { SecretTokens } from '@/components/apps/tokens/SecretTokens'
import { organisationContext } from '@/contexts/organisationContext'
import {
  newAppWrapKey,
  newAppToken,
  decryptedEnvSeed,
  appKeyring,
  splitSecret,
  getWrappedKeyShare,
} from '@/utils/crypto'
import { userHasPermission } from '@/utils/access/permissions'
import { EmptyState } from '@/components/common/EmptyState'

export default function Tokens({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadTokens = userHasPermission(
    organisation?.role?.permissions,
    'Tokens',
    'read',
    true
  )

  const { data } = useQuery(GetAppDetail, {
    variables: {
      organisationId: organisation?.id,
      appId: params.app,
    },
    skip: !organisation,
  })

  const app = data?.apps[0] as AppType

  const [activePanel, setActivePanel] = useState<'secrets' | 'kms'>('secrets')

  const { keyring } = useContext(KeyringContext)

  const handleCopy = (val: string) => {
    copyToClipBoard(val)
    toast.info('Copied')
  }

  const KmsPanel = () => {
    const appId = `phApp:v${app?.appVersion}:${app?.identityKey}`

    const [appSecret, setAppSecret] = useState<string>('')

    const appSecretPlaceholder = '*'.repeat(295)

    const RotateAppDialog = () => {
      const [pw, setPw] = useState<string>('')
      const [showPw, setShowPw] = useState<boolean>(false)
      const [loading, setLoading] = useState<boolean>(false)
      const [isOpen, setIsOpen] = useState(false)
      const [rotateAppKeys] = useMutation(RotateAppKey)

      const closeModal = () => {
        setPw('')
        setIsOpen(false)
      }

      const handleGenerateNewAppKey = async () => {
        const APP_VERSION = 1

        return new Promise<boolean>(async (resolve, reject) => {
          setTimeout(async () => {
            setLoading(true)
            try {
              const wrapKey = await newAppWrapKey()
              const appToken = await newAppToken()
              const appSeed = await decryptedEnvSeed(app.appSeed, keyring!.symmetricKey)

              const appKeys = await appKeyring(appSeed)
              const appKeyShares = await splitSecret(appKeys.privateKey)
              const wrappedShare = await getWrappedKeyShare(appKeyShares[1], wrapKey)
              await rotateAppKeys({
                variables: {
                  id: app.id,
                  appToken,
                  wrappedKeyShare: wrappedShare,
                },
              })

              setAppSecret(`pss:v${APP_VERSION}:${appToken}:${appKeyShares[0]}:${wrapKey}`)

              setLoading(false)
              resolve(true)
            } catch (error) {
              console.log(error)
              setLoading(false)
              reject()
            }
          }, 500)
        })
      }

      const handleSubmit = async (event: { preventDefault: () => void }) => {
        event.preventDefault()
        toast
          .promise(handleGenerateNewAppKey, {
            pending: 'Generating app keys',
            success: 'Success!',
            error: 'Something went wrong! Please check your password and try again.',
          })
          .then(() => closeModal())
      }

      return (
        <>
          <Button variant="outline" onClick={() => setIsOpen(true)}>
            <MdOutlineRotateLeft /> Rotate app secret
          </Button>
          <Transition appear show={isOpen} as={Fragment}>
            <Dialog as="div" className="relative z-10" onClose={() => {}}>
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
                          Genereate new app secret
                        </h3>
                        <Button variant="text" onClick={closeModal}>
                          <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                        </Button>
                      </Dialog.Title>

                      <Dialog.Description as="p" className="text-sm text-gray-500">
                        Generate a new app secret for {app.name}
                      </Dialog.Description>

                      <form onSubmit={handleSubmit}>
                        <div className="mt-6 space-y-8">
                          <div className="space-y-4 text-sm">
                            <Alert variant="warning">
                              <div className="flex items-center gap-4">
                                <FaExclamationTriangle />
                                <div>
                                  Warning: This will revoke your current app keys. Your application
                                  won&apos;t be able to decrypt data using the current keys.
                                </div>
                              </div>
                            </Alert>

                            <Alert variant="info">
                              <div className="flex items-center gap-4">
                                <FaInfo />
                                <div>
                                  Your new keys will be available to use immediately. You will be
                                  able to decrypt any existing data with your new keys. Please allow
                                  up to 60 seconds for your old keys to be revoked.
                                </div>
                              </div>
                            </Alert>
                          </div>

                          <div className="mt-10 flex items-center w-full justify-between">
                            <Button variant="secondary" type="button" onClick={closeModal}>
                              Cancel
                            </Button>
                            <Button type="submit" variant="primary" disabled={loading}>
                              Generate
                            </Button>
                          </div>
                        </div>
                      </form>
                    </Dialog.Panel>
                  </Transition.Child>
                </div>
              </div>
            </Dialog>
          </Transition>
        </>
      )
    }

    return (
      <div className="break-all space-y-8">
        <div className="bg-emerald-200/60 dark:bg-emerald-400/10 shadow-inner p-3 rounded-lg">
          <div className="uppercase text-xs tracking-widest text-gray-500 w-full flex items-center justify-between pb-4">
            app id
            <Button variant="outline" onClick={() => handleCopy(appId)}>
              <FaCopy /> Copy
            </Button>
          </div>
          <code className="text-xs text-emerald-500 font-medium">{appId}</code>
        </div>

        <div className="bg-red-200 dark:bg-red-400/10 shadow-inner p-3 rounded-lg">
          <div className="w-full flex items-center justify-between pb-4">
            <span className="uppercase text-xs tracking-widest text-gray-500">app secret</span>
            <div className="flex gap-4">
              {appSecret && (
                <div className="rounded-lg bg-orange-800/30 text-orange-500 p-2 flex items-center gap-4">
                  <FaExclamationTriangle />
                  <div className="text-2xs">{"Copy this value. You won't see it again!"}</div>
                </div>
              )}
              {appSecret && (
                <Button variant="outline" onClick={() => handleCopy(appSecret)}>
                  <MdContentCopy /> Copy
                </Button>
              )}
            </div>
            {!appSecret && <RotateAppDialog />}
          </div>
          <code className="text-xs text-red-500 ph-no-capture">
            {appSecret || appSecretPlaceholder}
          </code>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full overflow-y-auto relative text-black dark:text-white space-y-16 px-8">
      {userCanReadTokens ? (
        <section className="max-w-screen-xl">
          {keyring !== null && (
            <div className="flex gap-8 mt-6 divide-x divide-neutral-500/20 items-start">
              <div className="space-y-4 border-l border-neutral-500/40 h-min">
                <div
                  role="button"
                  onClick={() => setActivePanel('secrets')}
                  className={clsx(
                    'p-4 cursor-pointer border-l rounded-r-lg transition ease -ml-px w-60',
                    activePanel === 'secrets'
                      ? 'bg-zinc-300 dark:bg-zinc-800 font-semibold border-emerald-500'
                      : 'bg-zinc-200 dark:bg-zinc-900 hover:font-semibold border-neutral-500/40'
                  )}
                >
                  Secrets
                </div>
                {organisation?.role!.name!.toLowerCase() === 'owner' && (
                  <div
                    role="button"
                    onClick={() => setActivePanel('kms')}
                    className={clsx(
                      'p-4 cursor-pointer border-l rounded-r-lg transition ease -ml-px w-60',
                      activePanel === 'kms'
                        ? 'bg-zinc-300 dark:bg-zinc-800 font-semibold border-emerald-500'
                        : 'bg-zinc-200 dark:bg-zinc-900 hover:font-semibold border-neutral-500/40'
                    )}
                  >
                    KMS{' '}
                    <span className="rounded-full bg-purple-200 dark:bg-purple-900/50 text-neutral-800 dark:text-neutral-300 px-2 py-0.5 text-2xs">
                      Legacy
                    </span>
                  </div>
                )}
              </div>
              <div className="overflow-y-auto px-4">
                {app && activePanel === 'secrets' && (
                  <SecretTokens organisationId={organisation!.id} appId={params.app} />
                )}
                {app && activePanel === 'kms' && <KmsPanel />}
              </div>
            </div>
          )}
        </section>
      ) : (
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view Tokens in this app."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      )}
    </div>
  )
}
