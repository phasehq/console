'use client'

import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { RotateAppKey } from '@/graphql/mutations/rotateAppKeys.gql'
import { useLazyQuery, useMutation } from '@apollo/client'
import { AppType } from '@/apollo/graphql'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Button } from '@/components/common/Button'
import { copyToClipBoard } from '@/utils/clipboard'
import { FaCopy, FaExclamationTriangle, FaInfo, FaTimes } from 'react-icons/fa'
import { MdContentCopy, MdOutlineRotateLeft } from 'react-icons/md'
import { toast } from 'react-toastify'
import { Dialog, Transition } from '@headlessui/react'
import { cryptoUtils } from '@/utils/auth'
import { splitSecret } from '@/utils/keyshares'
import { Alert } from '@/components/common/Alert'
import UnlockKeyringDialog from '@/components/auth/UnlockKeyringDialog'
import { KeyringContext } from '@/contexts/keyringContext'
import clsx from 'clsx'
import { SecretTokens } from '@/components/apps/tokens/SecretTokens'
import { organisationContext } from '@/contexts/organisationContext'

export default function Tokens({ params }: { params: { team: string; app: string } }) {
  const [getApp, { data }] = useLazyQuery(GetAppDetail)

  const app = data?.apps[0] as AppType

  const [activePanel, setActivePanel] = useState<'secrets' | 'kms'>('secrets')

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { keyring } = useContext(KeyringContext)

  useEffect(() => {
    if (organisation) {
      getApp({
        variables: {
          organisationId: organisation.id,
          appId: params.app,
        },
      })
    }
  }, [getApp, organisation, params.app])

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
              const wrapKey = await cryptoUtils.newAppWrapKey()
              const newAppToken = await cryptoUtils.newAppToken()
              const appSeed = await cryptoUtils.decryptedAppSeed(app.appSeed, keyring!.symmetricKey)

              const appKeys = await cryptoUtils.appKeyring(appSeed)
              const appKeyShares = await splitSecret(appKeys.privateKey)
              const wrappedShare = await cryptoUtils.wrappedKeyShare(appKeyShares[1], wrapKey)
              await rotateAppKeys({
                variables: {
                  id: app.id,
                  appToken: newAppToken,
                  wrappedKeyShare: wrappedShare,
                },
              })

              setAppSecret(`pss:v${APP_VERSION}:${newAppToken}:${appKeyShares[0]}:${wrapKey}`)

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
    <div className="w-full overflow-y-auto relative text-black dark:text-white space-y-16">
      <section className="max-w-screen-xl">
        {organisation && <UnlockKeyringDialog organisationId={organisation.id} />}
        {keyring !== null && (
          <div className="flex gap-8 mt-6 divide-x divide-neutral-500/20 items-start">
            <div className="space-y-4 border-l border-neutral-500/40 h-min">
              <div
                role="button"
                onClick={() => setActivePanel('secrets')}
                className={clsx(
                  'p-4 cursor-pointer border-l transition ease -ml-px w-60',
                  activePanel === 'secrets'
                    ? 'bg-zinc-300 dark:bg-zinc-800 font-semibold border-emerald-500'
                    : 'bg-zinc-200 dark:bg-zinc-900 hover:font-semibold border-neutral-500/40'
                )}
              >
                Secrets
              </div>
              {organisation?.role?.toLowerCase() === 'owner' && (
                <div
                  role="button"
                  onClick={() => setActivePanel('kms')}
                  className={clsx(
                    'p-4 cursor-pointer border-l transition ease -ml-px w-60',
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
    </div>
  )
}
