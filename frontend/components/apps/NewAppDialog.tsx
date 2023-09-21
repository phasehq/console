import { cryptoUtils } from '@/utils/auth'
import { copyToClipBoard } from '@/utils/clipboard'
import { getLocalKeyring } from '@/utils/localStorage'
import { Dialog, Transition } from '@headlessui/react'
import { useSession } from 'next-auth/react'
import { Fragment, ReactNode, useEffect, useState } from 'react'
import { FaCopy, FaCross, FaExclamationTriangle, FaEye, FaEyeSlash, FaTimes } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { Button } from '../common/Button'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { CreateApplication } from '@/graphql/mutations/createApp.gql'
import { useMutation } from '@apollo/client'
import {
  ApiOrganisationPlanChoices,
  MutationCreateAppArgs,
  OrganisationType,
} from '@/apollo/graphql'
import { splitSecret } from '@/utils/keyshares'
import { UpgradeRequestForm } from '../forms/UpgradeRequestForm'

const FREE_APP_LIMIT = 5
const PRO_APP_LIMIT = 10

export default function NewAppDialog(props: {
  appCount: number
  organisation: OrganisationType
  buttonLabel?: ReactNode
  buttonVariant?: string
}) {
  const { organisation, appCount } = props
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [name, setName] = useState<string>('')
  const [pw, setPw] = useState<string>('')
  const [showPw, setShowPw] = useState<boolean>(false)
  const [appId, setAppId] = useState<string>('')
  const [appSecret, setAppSecret] = useState<string>('')
  const { data: session } = useSession()
  const [createApp, { data, loading, error }] = useMutation(CreateApplication)

  const IS_CLOUD_HOSTED = process.env.APP_HOST || process.env.NEXT_PUBLIC_APP_HOST

  const DEFAULT_BUTTON = {
    label: 'Create an app',
    variant: 'primary',
  }

  const complete = () => appId && appSecret

  const reset = () => {
    setName('')
    setPw('')
    setAppId('')
    setAppSecret('')
  }

  const closeModal = () => {
    reset()
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleCopy = (val: string) => {
    copyToClipBoard(val)
    toast.info('Copied')
  }

  const handleCreateApp = async () => {
    const APP_VERSION = 1

    return new Promise<boolean>(async (resolve, reject) => {
      setTimeout(async () => {
        const appSeed = await cryptoUtils.newAppSeed()
        const appToken = await cryptoUtils.newAppToken()
        const wrapKey = await cryptoUtils.newAppWrapKey()
        const id = crypto.randomUUID()

        try {
          const deviceKey = await cryptoUtils.deviceVaultKey(pw, session?.user?.email!)
          const encryptedKeyring = getLocalKeyring(session?.user?.email!, organisation.id)
          if (!encryptedKeyring) throw 'Error fetching local encrypted keys from browser'
          const decryptedKeyring = await cryptoUtils.decryptAccountKeyring(
            encryptedKeyring!,
            deviceKey
          )
          if (!decryptedKeyring) throw 'Failed to decrypt keys'
          const encryptedAppSeed = await cryptoUtils.encryptedAppSeed(
            appSeed,
            decryptedKeyring.symmetricKey
          )
          const appKeys = await cryptoUtils.appKeyring(appSeed)
          const appKeyShares = await splitSecret(appKeys.privateKey)

          const wrappedShare = await cryptoUtils.wrappedKeyShare(appKeyShares[1], wrapKey)

          await createApp({
            variables: {
              id,
              name,
              organisationId: organisation.id,
              appSeed: encryptedAppSeed,
              appToken,
              wrappedKeyShare: wrappedShare,
              identityKey: appKeys.publicKey,
              appVersion: APP_VERSION,
            } as MutationCreateAppArgs,
            refetchQueries: [
              {
                query: GetApps,
                variables: {
                  organisationId: organisation.id,
                  appId: '',
                },
              },
            ],
          })

          setAppSecret(`pss:v${APP_VERSION}:${appToken}:${appKeyShares[0]}:${wrapKey}`)
          setAppId(`phApp:v${APP_VERSION}:${appKeys.publicKey}`)

          resolve(true)
        } catch (error) {
          reject(error)
        }
      }, 500)
    })
  }

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    toast.promise(handleCreateApp, {
      pending: 'Setting up your app',
      success: 'App created!',
      error: error?.message
        ? undefined
        : 'Something went wrong! Please check your password and try again.',
    })
  }

  const allowNewApp = () => {
    if (organisation.plan === ApiOrganisationPlanChoices.Fr) {
      return appCount < FREE_APP_LIMIT
    } else if (organisation.plan === ApiOrganisationPlanChoices.Pr) {
      return appCount < PRO_APP_LIMIT
    } else if (organisation.plan === ApiOrganisationPlanChoices.En) return true
  }

  const planDisplay = () => {
    if (organisation.plan === ApiOrganisationPlanChoices.Fr)
      return {
        planName: 'Free',
        dialogTitle: 'Upgrade to Pro',
        description:
          'The Free plan is limited to a single application. To create more applications please upgrade to Pro.',
      }
    else if (organisation.plan === ApiOrganisationPlanChoices.Pr)
      return {
        planName: 'Pro',
        dialogTitle: 'Upgrade to Enterprise',
        description: `The Pro plan is limited to ${PRO_APP_LIMIT} applications. To create more applications please upgrade to Enterprise.`,
      }
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <Button
          variant={props.buttonVariant || DEFAULT_BUTTON.variant}
          type="button"
          onClick={openModal}
        >
          {props.buttonLabel || DEFAULT_BUTTON.label}
        </Button>
      </div>

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
                      {(allowNewApp() || complete()) && 'Create an App'}
                      {!allowNewApp() && !complete() && planDisplay()?.dialogTitle}
                    </h3>
                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>
                  {!complete() && allowNewApp() && (
                    <form onSubmit={handleSubmit}>
                      <div className="mt-2 space-y-6">
                        <p className="text-sm text-gray-500">
                          Create a new app by entering an app name below. A new set of encryption
                          keys will be created to secure your app.
                        </p>
                        <div className="flex flex-col justify-center max-w-md mx-auto">
                          <label
                            className="block text-gray-700 text-sm font-bold mb-2"
                            htmlFor="appname"
                          >
                            App name
                          </label>
                          <input
                            id="appname"
                            className="text-lg"
                            required
                            maxLength={64}
                            value={name}
                            placeholder="MyApp"
                            onChange={(e) => setName(e.target.value.replace(/[^a-z0-9]/gi, ''))}
                          />
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
                      </div>

                      <div className="mt-8 flex items-center w-full justify-between">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button type="submit" variant="primary">
                          Create
                        </Button>
                      </div>
                    </form>
                  )}

                  {!complete() && !allowNewApp() && (
                    <div className="space-y-4 py-4">
                      <p className="text-zinc-400">{planDisplay()?.description}</p>
                      {IS_CLOUD_HOSTED ? (
                        <UpgradeRequestForm onSuccess={closeModal} />
                      ) : (
                        <div>
                          Please contact us at{' '}
                          <a href="mailto:info@phase.dev" className="text-emerald-500">
                            info@phase.dev
                          </a>{' '}
                          to request an upgrade.
                        </div>
                      )}
                    </div>
                  )}
                  {complete() && (
                    <div className="w-full break-all space-y-8 mt-6">
                      <div className="bg-neutral-200 dark:bg-neutral-800  shadow-inner p-3 rounded-lg">
                        <div className="uppercase text-xs tracking-widest text-gray-500 w-full flex items-center justify-between pb-4">
                          app name
                        </div>
                        <code className="text-xs text-black dark:text-white">{name}</code>
                      </div>

                      <div className="bg-emerald-200/60 dark:bg-emerald-400/10 shadow-inner p-3 rounded-lg">
                        <div className="uppercase text-xs tracking-widest text-gray-500 w-full flex items-center justify-between pb-4">
                          app id
                          <Button variant="outline" onClick={() => handleCopy(appId)}>
                            Copy <FaCopy />
                          </Button>
                        </div>
                        <code className="text-xs text-emerald-500">{appId}</code>
                      </div>

                      <div className="bg-red-200 dark:bg-red-400/10 shadow-inner p-3 rounded-lg">
                        <div className="w-full flex items-center justify-between pb-4">
                          <span className="uppercase text-xs tracking-widest text-gray-500">
                            app secret
                          </span>
                          <div className="flex gap-4">
                            <div className="rounded-lg bg-orange-800/30 text-orange-500 p-2 flex items-center gap-4">
                              <FaExclamationTriangle />
                              <div className="text-2xs">
                                {"Copy this value. You won't see it again!"}
                              </div>
                            </div>

                            <Button variant="outline" onClick={() => handleCopy(appSecret)}>
                              <FaCopy /> Copy
                            </Button>
                          </div>
                        </div>
                        <code className="text-xs text-red-500">{appSecret}</code>
                      </div>
                    </div>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
