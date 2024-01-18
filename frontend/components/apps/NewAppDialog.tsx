import { OrganisationKeyring, cryptoUtils } from '@/utils/auth'
import { Dialog, Switch, Transition } from '@headlessui/react'
import { useSession } from 'next-auth/react'
import { Fragment, useContext, useEffect, useState } from 'react'
import { FaEye, FaEyeSlash, FaPlus, FaTimes } from 'react-icons/fa'
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
  SecretType,
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

const FREE_APP_LIMIT = 3
const PRO_APP_LIMIT = 10

export default function NewAppDialog(props: { appCount: number; organisation: OrganisationType }) {
  const { organisation, appCount } = props
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [name, setName] = useState<string>('')
  const [pw, setPw] = useState<string>('')
  const [showPw, setShowPw] = useState<boolean>(false)

  const [createStarters, setCreateStarters] = useState<boolean>(appCount === 0)

  const [appCreating, setAppCreating] = useState<boolean>(false)

  const { data: session } = useSession()

  const [createApp] = useMutation(CreateApplication)
  const [initAppEnvironments] = useMutation(InitAppEnvironments)
  const [createSecret] = useMutation(CreateNewSecret)

  const [getApps] = useLazyQuery(GetApps)
  const [getAppEnvs] = useLazyQuery(GetAppEnvironments)
  const [getOrgAdmins, { data: orgAdminsData }] = useLazyQuery(GetOrganisationAdminsAndSelf)

  const IS_CLOUD_HOSTED = process.env.APP_HOST || process.env.NEXT_PUBLIC_APP_HOST

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

  const reset = () => {
    setName('')
    setPw('')
  }

  const closeModal = () => {
    if (!appCreating) {
      reset()
    }

    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
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

  /**
   * Encrypts a set of secrets for the given env and creates them server-side
   *
   * @param {EnvironmentType} env - The environment in which the secrets will be created.
   * @param {Array<Partial<SecretType>>} secrets - An array of secrets to be processed.
   * @returns {Promise<void>} A Promise that resolves when the all secrets are encrypted and stored on the server.
   *
   * @throws {Error} If the specified environment is invalid or if an error occurs during processing.
   */
  async function processSecrets(env: EnvironmentType, secrets: Array<Partial<SecretType>>) {
    const keyring = await validateKeyring(pw)

    const userKxKeys = {
      publicKey: await getUserKxPublicKey(keyring.publicKey),
      privateKey: await getUserKxPrivateKey(keyring.privateKey),
    }

    const envSalt = await decryptAsymmetric(
      env.wrappedSalt,
      userKxKeys.privateKey,
      userKxKeys.publicKey
    )

    const promises = secrets.map(async (secret) => {
      const { key, value, comment } = secret

      const encryptedKey = await encryptAsymmetric(key!, env.identityKey)
      const encryptedValue = await encryptAsymmetric(value!, env.identityKey)
      const keyDigest = await digest(key!, envSalt)
      const encryptedComment = await encryptAsymmetric(comment!, env.identityKey)

      await createSecret({
        variables: {
          newSecret: {
            envId: env.id,
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

    return Promise.all(promises)
  }

  /**
   * Handles the creation of example secrets for a given app. Defines the set of example secrets, fetches all envs for this app and handles creation of each set of secrets with the respective envs
   *
   * @param {string} appId
   * @returns {Promise<void>}
   */
  const createExampleSecrets = async (appId: string) => {
    const DEV_SECRETS = [
      {
        key: 'AWS_ACCESS_KEY_ID',
        value: 'AKIAIX4ONRSG6ODEFVJA',
        comment: 'This is an example secret.',
      },
      {
        key: 'AWS_SECRET_ACCESS_KEY',
        value: 'aCRAMarEbFC3Q5c24pi7AVMIt6TaCfHeFZ4KCf/a',
        comment: 'This is an example secret.',
      },
      {
        key: 'JWT_SECRET',
        value:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjMzNjIwMTcxLCJleHAiOjIyMDg5ODUyMDB9.pHnckabbMbwTHAJOkb5Z7G7B4chY6GllJf6K2m96z3A',
        comment: 'This is an example secret.',
      },
      {
        key: 'STRIPE_SECRET_KEY',
        value: 'sk_test_EeHnL644i6zo4Iyq4v1KdV9H',
        comment: 'This is an example secret.',
      },
      {
        key: 'DJANGO_SECRET_KEY',
        value: 'wwf*2#86t64!fgh6yav$aoeuo@u2o@fy&*gg76q!&%6x_wbduad',
        comment: 'This is an example secret.',
      },
      {
        key: 'DJANGO_DEBUG',
        value: 'True',
        comment: 'This is an example secret.',
      },
      {
        key: 'POSTGRES_CONNECTION_STRING',
        value: 'postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}',
        comment: 'This is an example secret.',
      },
      {
        key: 'DB_USER',
        value: 'postgres',
        comment: 'This is an example secret.',
      },
      {
        key: 'DB_HOST',
        value: 'mc-laren-prod-db.c9ufzjtplsaq.us-west-1.rds.amazonaws.com',
        comment: 'This is an example secret.',
      },
      {
        key: 'DB_NAME',
        value: 'XP1_LM',
        comment: 'This is an example secret.',
      },
      {
        key: 'DB_PASSWORD',
        value: '6c37810ec6e74ec3228416d2844564fceb99ebd94b29f4334c244db011630b0e',
        comment: 'This is an example secret.',
      },
      {
        key: 'DB_PORT',
        value: '5432',
        comment: 'This is an example secret.',
      },
    ]

    const STAG_SECRETS = [
      {
        key: 'DJANGO_DEBUG',
        value: 'False',
        comment: 'This is an example secret.',
      },
    ]

    const PROD_SECRETS = [
      {
        key: 'STRIPE_SECRET_KEY',
        value: 'sk_live_epISNGSkdeXov2frTey7RHAi',
        comment: 'This is an example secret.',
      },
      {
        key: 'DJANGO_DEBUG',
        value: 'False',
        comment: 'This is an example secret.',
      },
    ]

    const { data: appEnvsData } = await getAppEnvs({ variables: { appId } })

    await processSecrets(
      appEnvsData.appEnvironments.find(
        (env: EnvironmentType) => env.envType === ApiEnvironmentEnvTypeChoices.Dev
      ),
      DEV_SECRETS
    )
    await processSecrets(
      appEnvsData.appEnvironments.find(
        (env: EnvironmentType) => env.envType === ApiEnvironmentEnvTypeChoices.Staging
      ),
      STAG_SECRETS
    )
    await processSecrets(
      appEnvsData.appEnvironments.find(
        (env: EnvironmentType) => env.envType === ApiEnvironmentEnvTypeChoices.Prod
      ),
      PROD_SECRETS
    )
  }

  /**
   * Initialize application environments for a given application ID.
   *
   * @param {string} appId - The ID of the application for which environments will be initialized.
   * @returns {Promise<boolean>} A Promise that resolves to `true` when initialization is complete.
   *
   * @throws {Error} If there are any errors during the environment initialization process.
   */
  const initAppEnvs = async (appId: string) => {
    return new Promise<boolean>(async (resolve, reject) => {
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

      resolve(true)
    })
  }

  const handleCreateApp = async () => {
    const APP_VERSION = 1
    setAppCreating(true)

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
          })

          const newAppId = data.createApp.app.id

          await initAppEnvs(newAppId)

          if (createStarters) {
            await createExampleSecrets(newAppId)
          }

          await getApps({
            variables: { organisationId: organisation.id },
            fetchPolicy: 'network-only',
          })

          setAppCreating(false)
          resolve(true)
          closeModal()
        } catch (error) {
          console.error(error)
          setAppCreating(false)
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
      error: 'Something went wrong!',
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
      <div
        className="flex items-center justify-center cursor-pointer w-full h-full group"
        role="button"
        onClick={openModal}
      >
        <div className="flex items-center text-lg gap-1 rounded-full bg-zinc-900 py-1 px-3 text-white group-hover:bg-zinc-700 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:group-hover:bg-emerald-400/10 dark:group-hover:text-emerald-300 dark:group-hover:ring-emerald-300">
          <FaPlus />
          Create an App
        </div>
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
                      {allowNewApp() && 'Create an App'}
                      {!allowNewApp() && planDisplay()?.dialogTitle}
                    </h3>
                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>
                  {allowNewApp() && (
                    <form onSubmit={handleSubmit}>
                      <div className="mt-2 space-y-6 group">
                        <p className="text-sm text-gray-500">
                          Create a new App by entering an App name below. Your App will be
                          initialized with 3 new environments.
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
                                className="w-full ph-no-capture"
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
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={closeModal}
                          disabled={appCreating}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" variant="primary" isLoading={appCreating}>
                          Create
                        </Button>
                      </div>
                    </form>
                  )}

                  {!allowNewApp() && (
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
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
