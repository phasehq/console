import { OrganisationKeyring, cryptoUtils } from '@/utils/auth'
import { copyToClipBoard } from '@/utils/clipboard'
import { Dialog, Switch, Transition } from '@headlessui/react'
import { useSession } from 'next-auth/react'
import { Fragment, ReactNode, useContext, useEffect, useState } from 'react'
import { FaCopy, FaExclamationTriangle, FaEye, FaEyeSlash, FaTimes } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { Button } from '../common/Button'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { CreateApplication } from '@/graphql/mutations/createApp.gql'
import { CreateNewSecret } from '@/graphql/mutations/environments/createSecret.gql'
import { GetOrganisationAdminsAndSelf } from '@/graphql/queries/organisation/getOrganisationAdminsAndSelf.gql'
import { InitAppEnvironments } from '@/graphql/mutations/environments/initAppEnvironments.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { useLazyQuery, useMutation } from '@apollo/client'
import {
  ApiEnvironmentEnvTypeChoices,
  ApiOrganisationPlanChoices,
  EnvironmentType,
  MutationCreateAppArgs,
  OrganisationType,
  SecretInput,
} from '@/apollo/graphql'
import { splitSecret } from '@/utils/keyshares'
import { UpgradeRequestForm } from '../forms/UpgradeRequestForm'
import { KeyringContext } from '@/contexts/keyringContext'
import { createNewEnv } from '@/utils/environments'
import {
  decryptAsymmetric,
  digest,
  encryptAsymmetric,
  getUserKxPrivateKey,
  getUserKxPublicKey,
} from '@/utils/crypto'

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
  const [createStarters, setCreateStarters] = useState<boolean>(appCount === 0)
  const [appSecret, setAppSecret] = useState<string>('')
  const { data: session } = useSession()

  const [createApp] = useMutation(CreateApplication)
  const [initAppEnvironments] = useMutation(InitAppEnvironments)
  const [createSecret] = useMutation(CreateNewSecret)
  const [getAppEnvs] = useLazyQuery(GetAppEnvironments)

  const [getOrgAdmins, { data: orgAdminsData }] = useLazyQuery(GetOrganisationAdminsAndSelf)

  const IS_CLOUD_HOSTED = process.env.APP_HOST || process.env.NEXT_PUBLIC_APP_HOST

  const DEFAULT_BUTTON = {
    label: 'Create an app',
    variant: 'primary',
  }

  const { keyring, setKeyring } = useContext(KeyringContext)

  useEffect(() => {
    if (organisation) {
      getOrgAdmins({
        variables: {
          organisationId: organisation.id,
        },
      })
    }
  }, [getOrgAdmins, organisation])

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

  const validateKeyring = async (password: string) => {
    return new Promise<OrganisationKeyring>(async (resolve, reject) => {
      if (keyring) resolve(keyring)
      else {
        try {
          const decryptedKeyring = await cryptoUtils.getKeyring(
            session?.user?.email!,
            organisation!.id,
            password
          )
          setKeyring(decryptedKeyring)
          resolve(decryptedKeyring)
        } catch (error) {
          reject(error)
        }
      }
    })
  }

  const createExampleSecrets = async (environment: EnvironmentType, salt: string) => {
    const secrets = [
      {
        key: 'JWT_SECRET',
        value: 'myjsonwebtoken',
        comment: 'This is an example secret.',
      },
      {
        key: 'DJANGO_SECRET_KEY',
        value: 'your_django_secret_key',
        comment: 'This is an example secret.',
      },
      {
        key: 'STRIPE_SECRET_KEY',
        value: 'your_stripe_secret_key',
        comment: 'This is an example secret.',
      },
      {
        key: 'AWS_SECRET_ACCESS_KEY',
        value: 'your_secret_access_key',
        comment: 'This is an example secret.',
      },
      {
        key: 'PORT',
        value: '3000',
        comment: 'This is an example secret.',
      },
    ]

    const encryptAndCreatePromises = secrets.map(async (secret) => {
      const { key, value, comment } = secret

      const encryptedKey = await encryptAsymmetric(key, environment.identityKey)
      const encryptedValue = await encryptAsymmetric(value, environment.identityKey)
      const keyDigest = await digest(key, salt)
      const encryptedComment = await encryptAsymmetric(comment, environment.identityKey)

      await createSecret({
        variables: {
          newSecret: {
            envId: environment.id,
            key: encryptedKey,
            keyDigest,
            value: encryptedValue,
            folderId: null,
            comment: encryptedComment,
            tags: [],
          } as SecretInput,
        },
      })
    })

    await Promise.all(encryptAndCreatePromises)
  }

  const initAppEnvs = async (appId: string) => {
    const mutationPayload = {
      devEnv: await createNewEnv(
        appId,
        'Development',
        ApiEnvironmentEnvTypeChoices.Dev,
        orgAdminsData.organisationAdminsAndSelf
      ),
      stagingEnv: await createNewEnv(
        appId,
        'Staging',
        ApiEnvironmentEnvTypeChoices.Staging,
        orgAdminsData.organisationAdminsAndSelf
      ),
      prodEnv: await createNewEnv(
        appId,
        'Production',
        ApiEnvironmentEnvTypeChoices.Prod,
        orgAdminsData.organisationAdminsAndSelf
      ),
    }

    await initAppEnvironments({
      variables: {
        devEnv: mutationPayload.devEnv.createEnvPayload,
        stagingEnv: mutationPayload.stagingEnv.createEnvPayload,
        prodEnv: mutationPayload.prodEnv.createEnvPayload,
        devAdminKeys: mutationPayload.devEnv.adminKeysPayload,
        stagAdminKeys: mutationPayload.stagingEnv.adminKeysPayload,
        prodAdminKeys: mutationPayload.prodEnv.adminKeysPayload,
      },
    })

    if (createStarters) {
      const { data: appEnvsData } = await getAppEnvs({ variables: { appId } })

      const keyring = await validateKeyring(pw)

      const devEnv = appEnvsData.appEnvironments.find(
        (env: EnvironmentType) => env.envType === ApiEnvironmentEnvTypeChoices.Dev
      )

      const userKxKeys = {
        publicKey: await getUserKxPublicKey(keyring!.publicKey),
        privateKey: await getUserKxPrivateKey(keyring!.privateKey),
      }

      const salt = await decryptAsymmetric(
        devEnv.wrappedSalt,
        userKxKeys.privateKey,
        userKxKeys.publicKey
      )

      await createExampleSecrets(devEnv, salt)
    }
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
          const keyring = await validateKeyring(pw)
          const encryptedAppSeed = await cryptoUtils.encryptedAppSeed(appSeed, keyring.symmetricKey)
          const appKeys = await cryptoUtils.appKeyring(appSeed)
          const appKeyShares = await splitSecret(appKeys.privateKey)

          const wrappedShare = await cryptoUtils.wrappedKeyShare(appKeyShares[1], wrapKey)

          const { data } = await createApp({
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

          await initAppEnvs(data.createApp.app.id)

          setAppSecret(`pss:v${APP_VERSION}:${appToken}:${appKeyShares[0]}:${wrapKey}`)
          setAppId(`phApp:v${APP_VERSION}:${appKeys.publicKey}`)

          resolve(true)
          closeModal()
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
      error: 'Something went wrong! Please check your sudo password and try again.',
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
        description: `The Free plan is limited to ${FREE_APP_LIMIT} Apps. To create more Apps, please upgrade to Pro.`,
      }
    else if (organisation.plan === ApiOrganisationPlanChoices.Pr)
      return {
        planName: 'Pro',
        dialogTitle: 'Upgrade to Enterprise',
        description: `The Pro plan is limited to ${PRO_APP_LIMIT} Apps. To create more Apps, please upgrade to Enterprise.`,
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
                      <div className="mt-2 space-y-6 group">
                        <p className="text-sm text-gray-500">
                          Create a new app by entering an app name below. A new set of encryption
                          keys will be created to secure your app.
                        </p>
                        <div className="flex flex-col justify-center">
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
                            onChange={(e) => setName(e.target.value)}
                          />
                        </div>

                        {!keyring && (
                          <div className="flex flex-col justify-center">
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
                        )}

                        <div className="flex items-center gap-2">
                          <label
                            className="block text-neutral-500 text-sm font-bold mb-2"
                            htmlFor="create-starters"
                          >
                            Create example secrets
                          </label>
                          <Switch
                            id="create-starters"
                            checked={createStarters}
                            onChange={() => setCreateStarters(!createStarters)}
                            className={`${
                              createStarters
                                ? 'bg-emerald-400/10 ring-emerald-400/20'
                                : 'bg-neutral-500/40 ring-neutral-500/30'
                            } relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset`}
                          >
                            <span className="sr-only">Initialize with example secrets</span>
                            <span
                              className={`${
                                createStarters
                                  ? 'translate-x-6 bg-emerald-400'
                                  : 'translate-x-1 bg-black'
                              } flex items-center justify-center h-4 w-4 transform rounded-full transition`}
                            ></span>
                          </Switch>
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
