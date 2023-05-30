'use client'

import { GetOrganisations } from '@/apollo/queries/getOrganisations.gql'
import { GetAppDetail } from '@/apollo/queries/getAppDetail.gql'
import { RotateAppKeys } from '@/apollo/mutations/rotateAppKeys.gql'
import { useLazyQuery, useQuery, useMutation } from '@apollo/client'
import { AppType, ChartDataPointType, TimeRange } from '@/apollo/graphql'
import { Fragment, useEffect, useState } from 'react'
import { Button } from '@/components/common/Button'
import { copyToClipBoard } from '@/utils/clipboard'
import {
  FaCopy,
  FaExclamationTriangle,
  FaEye,
  FaEyeSlash,
  FaInfo,
  FaMagic,
  FaTimes,
} from 'react-icons/fa'
import { MdContentCopy, MdOutlineRotateLeft } from 'react-icons/md'
import { toast } from 'react-toastify'
import { Dialog, Transition } from '@headlessui/react'
import { cryptoUtils } from '@/utils/auth'
import { useSession } from 'next-auth/react'
import { getLocalKeyring } from '@/utils/localStorage'
import { splitSecret } from '@/utils/keyshares'
import { Alert } from '@/components/common/Alert'

export default function App({ params }: { params: { team: string; app: string } }) {
  const { data: orgsData } = useQuery(GetOrganisations)
  const [getApp, { data }] = useLazyQuery(GetAppDetail)

  const app = data?.apps[0] as AppType

  const appId = `phApp:v${app?.appVersion}:${app?.identityKey}`

  const [appSecret, setAppSecret] = useState<string>('')

  const { data: session } = useSession()

  const appSecretPlaceholder = '*'.repeat(295)

  useEffect(() => {
    if (orgsData) {
      const organisationId = orgsData.organisations[0].id
      getApp({
        variables: {
          organisationId,
          appId: params.app,
        },
      })
    }
  }, [getApp, orgsData, params.app])

  const handleCopy = (val: string) => {
    copyToClipBoard(val)
    toast.info('Copied')
  }

  const RotateAppDialog = () => {
    const [pw, setPw] = useState<string>('')
    const [showPw, setShowPw] = useState<boolean>(false)
    const [loading, setLoading] = useState<boolean>(false)
    const [isOpen, setIsOpen] = useState(false)
    const [rotateAppKeys] = useMutation(RotateAppKeys)

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
            const deviceKey = await cryptoUtils.deviceVaultKey(pw, session?.user?.email!)
            const encryptedKeyring = getLocalKeyring(orgsData.organisations[0].id)
            if (!encryptedKeyring) throw 'Error fetching local encrypted keys from browser'
            const decryptedKeyring = await cryptoUtils.decryptAccountKeyring(
              encryptedKeyring!,
              deviceKey
            )
            if (!decryptedKeyring) throw 'Failed to decrypt keys'

            const appSeed = await cryptoUtils.decryptedAppSeed(
              app.appSeed,
              decryptedKeyring.symmetricKey
            )

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
                                won't be able to decrypt data using the current keys.
                              </div>
                            </div>
                          </Alert>

                          <Alert variant="info">
                            <div className="flex items-center gap-4">
                              <FaInfo />
                              <div>
                                Your new keys will be available to use immediately. You will be able
                                to decrypt any existing data with your new keys. Please allow up to
                                60 seconds for your old keys to be revoked.
                              </div>
                            </div>
                          </Alert>
                        </div>

                        <div className="flex flex-col justify-center max-w-md mx-auto">
                          <label
                            className="block text-gray-700 text-sm font-bold mb-2"
                            htmlFor="password"
                          >
                            Sudo password
                          </label>
                          <div className="relative">
                            <input
                              id="password"
                              value={pw}
                              onChange={(e) => setPw(e.target.value)}
                              type={showPw ? 'text' : 'password'}
                              minLength={16}
                              required
                              className="w-full "
                            />
                            <button
                              className="absolute inset-y-0 right-4"
                              type="button"
                              onClick={() => setShowPw(!showPw)}
                              tabIndex={-1}
                            >
                              {showPw ? <FaEyeSlash /> : <FaEye />}
                            </button>
                          </div>
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
    <div className="h-screen w-full text-black dark:text-white grid grid-cols-1 md:grid-cols-3 gap-16">
      <section className="md:col-span-2">
        {/* <h2 className="text-gray-500 uppercase tracking-widest font-semibold text-sm">keys</h2> */}
        {app && (
          <div className="w-full break-all space-y-8 mt-6">
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
              <code className="text-xs text-red-500">{appSecret || appSecretPlaceholder}</code>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
