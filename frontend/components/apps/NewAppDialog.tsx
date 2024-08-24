import { Dialog, Switch, Transition } from '@headlessui/react'
import { forwardRef, Fragment, useContext, useState, useImperativeHandle, useRef } from 'react'
import { FaPlus, FaTimes } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { Button } from '../common/Button'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { CreateApplication } from '@/graphql/mutations/createApp.gql'
import { BulkProcessSecrets } from '@/graphql/mutations/environments/bulkProcessSecrets.gql'
import { GetOrganisationAdminsAndSelf } from '@/graphql/queries/organisation/getOrganisationAdminsAndSelf.gql'
import { InitAppEnvironments } from '@/graphql/mutations/environments/initAppEnvironments.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetOrganisationPlan } from '@/graphql/queries/organisation/getOrganisationPlan.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import {
  ApiEnvironmentEnvTypeChoices,
  ApiOrganisationPlanChoices,
  EnvironmentType,
  MutationCreateAppArgs,
  OrganisationType,
  SecretInput,
  SecretType,
} from '@/apollo/graphql'

import { KeyringContext } from '@/contexts/keyringContext'

import { MAX_INPUT_STRING_LENGTH } from '@/constants'
import { Alert } from '../common/Alert'
import {
  getUserKxPublicKey,
  getUserKxPrivateKey,
  decryptAsymmetric,
  encryptAsymmetric,
  digest,
  createNewEnv,
  splitSecret,
  appKeyring,
  newAppSeed,
  newAppToken,
  newAppWrapKey,
  encryptAppSeed,
  getWrappedKeyShare,
} from '@/utils/crypto'
import { UpsellDialog } from '../settings/organisation/UpsellDialog'

const NewAppDialog = forwardRef(
  (props: { appCount: number; organisation: OrganisationType }, ref) => {
    const { organisation, appCount } = props
    const [isOpen, setIsOpen] = useState<boolean>(false)
    const [name, setName] = useState<string>('')

    const [createStarters, setCreateStarters] = useState<boolean>(appCount === 0)
    const [appCreating, setAppCreating] = useState<boolean>(false)

    const nameInputRef = useRef(null)

    const [createApp, { error }] = useMutation(CreateApplication)
    const [initAppEnvironments] = useMutation(InitAppEnvironments)
    const [bulkProcessSecrets] = useMutation(BulkProcessSecrets)

    const [getApps] = useLazyQuery(GetApps)
    const [getAppEnvs] = useLazyQuery(GetAppEnvironments)

    const { data: orgAdminsData } = useQuery(GetOrganisationAdminsAndSelf, {
      variables: {
        organisationId: organisation?.id,
      },
      skip: !organisation,
    })

    const { data: orgPlanData } = useQuery(GetOrganisationPlan, {
      variables: {
        organisationId: organisation?.id,
      },
      skip: !organisation,
    })

    const [createSuccess, setCreateSuccess] = useState(false)

    const { keyring } = useContext(KeyringContext)

    const reset = () => {
      setName('')

      setTimeout(() => {
        setCreateSuccess(false)
      }, 2000)
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

    useImperativeHandle(ref, () => ({
      openModal,
    }))

    /**
     * Encrypts a set of secrets for the given env and creates them server-side
     *
     * @param {EnvironmentType} env - The environment in which the secrets will be created.
     * @param {Array<Partial<SecretType>>} secrets - An array of secrets to be processed.
     * @returns {Promise<void>} A Promise that resolves when the all secrets are encrypted and stored on the server.
     *
     * @throws {Error} If the specified environment is invalid or if an error occurs during processing.
     */
    async function processSecrets(
      envs: Array<{ env: EnvironmentType; secrets: Array<Partial<SecretType>> }>
    ) {
      const userKxKeys = {
        publicKey: await getUserKxPublicKey(keyring!.publicKey),
        privateKey: await getUserKxPrivateKey(keyring!.privateKey),
      }

      const allSecretsToCreate: SecretInput[] = []

      await Promise.all(
        envs.map(async ({ env, secrets }) => {
          const envSalt = await decryptAsymmetric(
            env.wrappedSalt,
            userKxKeys.privateKey,
            userKxKeys.publicKey
          )

          const envSecretsPromises = secrets.map(async (secret) => {
            const { key, value, comment } = secret

            const encryptedKey = await encryptAsymmetric(key!, env.identityKey)
            const encryptedValue = await encryptAsymmetric(value!, env.identityKey)
            const keyDigest = await digest(key!, envSalt)
            const encryptedComment = await encryptAsymmetric(comment!, env.identityKey)

            allSecretsToCreate.push({
              envId: env.id,
              key: encryptedKey,
              keyDigest,
              value: encryptedValue,
              path: '/',
              comment: encryptedComment,
              tags: [], // Adjust as necessary if you need to include tags
            })
          })

          await Promise.all(envSecretsPromises)
        })
      )

      // Use the bulkProcessSecrets mutation
      await bulkProcessSecrets({
        variables: {
          secretsToCreate: allSecretsToCreate,
          secretsToUpdate: [],
          secretsToDelete: [],
        },
      })
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
          comment: '',
        },
        {
          key: 'AWS_SECRET_ACCESS_KEY',
          value: 'aCRAMarEbFC3Q5c24pi7AVMIt6TaCfHeFZ4KCf/a',
          comment: '',
        },
        {
          key: 'JWT_SECRET',
          value:
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjMzNjIwMTcxLCJleHAiOjIyMDg5ODUyMDB9.pHnckabbMbwTHAJOkb5Z7G7B4chY6GllJf6K2m96z3A',
          comment: '',
        },
        {
          key: 'STRIPE_SECRET_KEY',
          value: 'sk_test_EeHnL644i6zo4Iyq4v1KdV9H',
          comment: '',
        },
        {
          key: 'DJANGO_SECRET_KEY',
          value: 'wwf*2#86t64!fgh6yav$aoeuo@u2o@fy&*gg76q!&%6x_wbduad',
          comment: '',
        },
        {
          key: 'DJANGO_DEBUG',
          value: 'True',
          comment: '',
        },
        {
          key: 'POSTGRES_CONNECTION_STRING',
          value: 'postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}',
          comment: 'AWS RDS pgsql - us-west-1',
        },
        {
          key: 'DB_USER',
          value: 'postgres',
          comment: '',
        },
        {
          key: 'DB_HOST',
          value: 'mc-laren-prod-db.c9ufzjtplsaq.us-west-1.rds.amazonaws.com',
          comment: '',
        },
        {
          key: 'DB_NAME',
          value: 'XP1_LM',
          comment: '',
        },
        {
          key: 'DB_PASSWORD',
          value: '6c37810ec6e74ec3228416d2844564fceb99ebd94b29f4334c244db011630b0e',
          comment: '',
        },
        {
          key: 'DB_PORT',
          value: '5432',
          comment: '',
        },
      ]

      const STAG_SECRETS = [
        {
          key: 'DJANGO_DEBUG',
          value: 'False',
          comment: '',
        },
      ]

      const PROD_SECRETS = [
        {
          key: 'STRIPE_SECRET_KEY',
          value: 'sk_live_epISNGSkdeXov2frTey7RHAi',
          comment: 'Stripe prod key - Stripe Atlas',
        },
        {
          key: 'DJANGO_DEBUG',
          value: 'False',
          comment: '',
        },
      ]

      const { data: appEnvsData } = await getAppEnvs({ variables: { appId } })

      const envsToProcess = [
        {
          env: appEnvsData.appEnvironments.find(
            (env: EnvironmentType) => env.envType === ApiEnvironmentEnvTypeChoices.Dev
          ),
          secrets: DEV_SECRETS,
        },
        {
          env: appEnvsData.appEnvironments.find(
            (env: EnvironmentType) => env.envType === ApiEnvironmentEnvTypeChoices.Staging
          ),
          secrets: STAG_SECRETS,
        },
        {
          env: appEnvsData.appEnvironments.find(
            (env: EnvironmentType) => env.envType === ApiEnvironmentEnvTypeChoices.Prod
          ),
          secrets: PROD_SECRETS,
        },
      ]

      // Remove any null or undefined environments
      const validEnvsToProcess = envsToProcess.filter(({ env }) => env !== undefined)

      await processSecrets(validEnvsToProcess)
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
          const appSeed = await newAppSeed()
          const appToken = await newAppToken()
          const wrapKey = await newAppWrapKey()
          const id = crypto.randomUUID()

          try {
            const encryptedAppSeed = await encryptAppSeed(appSeed, keyring!.symmetricKey)
            const appKeys = await appKeyring(appSeed)
            const appKeyShares = await splitSecret(appKeys.privateKey)

            const wrappedShare = await getWrappedKeyShare(appKeyShares[1], wrapKey)

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
            setCreateSuccess(true)
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
      if (
        organisation.plan === ApiOrganisationPlanChoices.Fr ||
        organisation.plan === ApiOrganisationPlanChoices.Pr
      ) {
        return appCount < orgPlanData?.organisationPlan.maxApps
      } else if (organisation.plan === ApiOrganisationPlanChoices.En) {
        return true
      }
    }

    const planDisplay = () => {
      if (organisation.plan === ApiOrganisationPlanChoices.Fr)
        return {
          planName: 'Free',
          dialogTitle: 'Upgrade to Pro',
          description: `The Free plan is limited to ${orgPlanData?.organisationPlan.maxApps} Apps. To create more Apps, please upgrade to Pro.`,
        }
      else if (organisation.plan === ApiOrganisationPlanChoices.Pr)
        return {
          planName: 'Pro',
          dialogTitle: 'Upgrade to Enterprise',
          description: `The Pro plan is limited to ${orgPlanData?.organisationPlan.maxApps} Apps. To create more Apps, please upgrade to Enterprise.`,
        }
    }

    if (!allowNewApp() && !createSuccess)
      return (
        <div className="flex items-center justify-center cursor-pointer w-full h-full group">
          <UpsellDialog
            buttonLabel={
              <>
                <FaPlus />
                Create an App
              </>
            }
          />
        </div>
      )

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
          <Dialog as="div" className="relative z-10" onClose={() => {}} initialFocus={nameInputRef}>
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
                        {!allowNewApp() && !createSuccess && planDisplay()?.dialogTitle}
                      </h3>
                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>
                    {allowNewApp() &&
                      (createSuccess ? (
                        <div>
                          <div className="font-semibold text-lg">App Created!</div>
                        </div>
                      ) : (
                        <form onSubmit={handleSubmit}>
                          <div className="mt-2 space-y-6 group">
                            <p className="text-sm text-gray-500">
                              Create a new App by entering an App name below. Your App will be
                              initialized with 3 new environments.
                            </p>
                            {error && (
                              <Alert variant="danger" icon={true}>
                                {error.message}
                              </Alert>
                            )}
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
                                maxLength={MAX_INPUT_STRING_LENGTH}
                                value={name}
                                placeholder="MyApp"
                                onChange={(e) => setName(e.target.value)}
                                ref={nameInputRef}
                              />
                            </div>

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
                      ))}
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>
      </>
    )
  }
)

NewAppDialog.displayName = 'NewAppDialog'

export default NewAppDialog
