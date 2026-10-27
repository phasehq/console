import GetCoolifyApplications from '@/graphql/queries/syncing/coolify/getApplications.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import CreateNewCoolifySync from '@/graphql/mutations/syncing/coolify/CreateCoolifySync.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Button } from '../../common/Button'
import { EnvironmentType, ProviderCredentialsType, CoolifyApplicationType } from '@/apollo/graphql'
import { Combobox, RadioGroup, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaAngleDoubleDown,
  FaArrowLeft,
  FaArrowRight,
  FaCheck,
  FaChevronDown,
  FaCircle,
  FaDotCircle,
} from 'react-icons/fa'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'
import { Input } from '@/components/common/Input'
import { Alert } from '@/components/common/Alert'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { CoolifyIcon } from './CoolifyIcon'

export const CreateCoolifySync = (props: { appId: string; closeModal: () => void }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { appId, closeModal } = props

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })

  const [getCoolifyApplications, { loading }] = useLazyQuery(GetCoolifyApplications)

  const [createCoolifySync, { loading: creating }] = useMutation(CreateNewCoolifySync)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)
  const [applications, setApplications] = useState<CoolifyApplicationType[]>([])
  const [application, setApplication] = useState<CoolifyApplicationType | null>(null)
  const [query, setQuery] = useState('')
  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)
  const [path, setPath] = useState('/')
  const [credentialsValid, setCredentialsValid] = useState(false)
  const [syncPreview, setSyncPreview] = useState(false)
  const [consentGiven, setConsentGiven] = useState(false)

  // Preselect the first available env
  useEffect(() => {
    if (appEnvsData?.appEnvironments.length > 0) {
      const defaultEnv: EnvironmentType = appEnvsData.appEnvironments[0]
      setPhaseEnv(defaultEnv)
    }
  }, [appEnvsData])

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (credential === null) {
      toast.error('Please select a credential to use for this sync')
      return false
    } else if (!credentialsValid) {
      const { data: applicationsData } = await getCoolifyApplications({
        variables: {
          credentialId: credential.id,
        },
      })
      if (applicationsData?.coolifyApplications) {
        const availableApplications: CoolifyApplicationType[] = applicationsData.coolifyApplications
        setApplications(availableApplications)
        // Clear a selection left over from a different credential
        if (application && !availableApplications.some((a) => a.id === application.id))
          setApplication(null)
        setCredentialsValid(true)
      }
    } else {
      if (!application) {
        toast.error('Please select a Coolify application')
        return false
      }
      await createCoolifySync({
        variables: {
          envId: phaseEnv?.id,
          path,
          applicationUuid: application?.id,
          applicationName: application?.name,
          credentialId: credential.id,
          syncPreview,
        },
        refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
      })

      toast.success('Created new Sync!')
      closeModal()
    }
  }

  const filteredApplications =
    query === ''
      ? applications
      : applications.filter((application) =>
          application.name?.toLowerCase().includes(query.toLowerCase())
        )

  const consentPoints = [
    `Phase will delete ${syncPreview ? 'production and preview' : 'production'} variables in this Coolify application that aren't in this environment and path, including ones created in Coolify. Deleted variables can't be restored`,
    'Coolify trims leading and trailing whitespace from values and stores empty values as null',
  ]

  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="text-sm font-semibold text-black dark:text-white flex items-center gap-1">
          <CoolifyIcon className="text-[#8C52FF]" />
          Coolify
        </div>
        <div className="text-neutral-500 text-2xs">
          Sync an environment with the environment variables of a Coolify application. The Coolify
          API must be enabled, and the API token needs read and write access.
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {!credentialsValid && (
          <div className="space-y-4">
            <div className="font-medium text-black dark:text-white">
              Step 1: Choose authentication credentials
            </div>
            <div className="flex items-end gap-2 justify-between">
              <div className="w-full">
                <ProviderCredentialPicker
                  credential={credential}
                  setCredential={(cred) => setCredential(cred)}
                  orgId={organisation!.id}
                  providerFilter={'coolify'}
                  setDefault={true}
                />
              </div>
            </div>
          </div>
        )}

        {credentialsValid && (
          <div className="space-y-6">
            <div className="font-medium text-black dark:text-white">
              Step 2: Select source and destination for Secrets
            </div>
            <div className="space-y-4">
              <RadioGroup value={phaseEnv} onChange={setPhaseEnv}>
                <RadioGroup.Label as={Fragment}>
                  <label className="block text-neutral-500 text-sm mb-2">Phase Environment</label>
                </RadioGroup.Label>
                <div className="flex flex-wrap items-center gap-2">
                  {appEnvsData?.appEnvironments.map((env: EnvironmentType) => (
                    <RadioGroup.Option key={env.id} value={env} as={Fragment}>
                      {({ active, checked }) => (
                        <div
                          className={clsx(
                            'flex items-center gap-2 py-1 px-2 cursor-pointer bg-zinc-800 border border-zinc-800 rounded-full capitalize',
                            active && 'border-zinc-700',
                            checked && 'bg-zinc-700'
                          )}
                        >
                          {checked ? <FaDotCircle className="text-emerald-500" /> : <FaCircle />}
                          {env.name}
                        </div>
                      )}
                    </RadioGroup.Option>
                  ))}
                </div>
              </RadioGroup>

              <Input value={path} setValue={setPath} label="Path" />
            </div>

            <div className="flex justify-between items-center gap-4 py-8">
              <div className="border-b border-neutral-500/40 w-full"></div>
              <FaAngleDoubleDown className="shrink-0 text-neutral-500 text-xl" />
              <div className="border-b border-neutral-500/40 w-full"></div>
            </div>

            <div className="space-y-4">
              <div className="relative">
                <Combobox as="div" value={application} onChange={setApplication}>
                  {({ open }) => (
                    <>
                      <div className="space-y-2">
                        <Combobox.Label as={Fragment}>
                          <label className="block text-neutral-500 text-sm" htmlFor="name">
                            Coolify Application
                          </label>
                        </Combobox.Label>
                        <div className="w-full relative flex items-center">
                          <Combobox.Input
                            className="w-full"
                            onChange={(event) => {
                              setQuery(event.target.value)
                              if (event.target.value === '') setApplication(null)
                            }}
                            required
                            displayValue={(application: CoolifyApplicationType | null) =>
                              application?.name ?? ''
                            }
                          />
                          <div className="absolute inset-y-0 right-2 flex items-center">
                            <Combobox.Button>
                              <FaChevronDown
                                className={clsx(
                                  'text-neutral-500 transform transition ease cursor-pointer',
                                  open ? 'rotate-180' : 'rotate-0'
                                )}
                              />
                            </Combobox.Button>
                          </div>
                        </div>
                      </div>
                      <Transition
                        enter="transition duration-100 ease-out"
                        enterFrom="transform scale-95 opacity-0"
                        enterTo="transform scale-100 opacity-100"
                        leave="transition duration-75 ease-out"
                        leaveFrom="transform scale-100 opacity-100"
                        leaveTo="transform scale-95 opacity-0"
                      >
                        <Combobox.Options as={Fragment}>
                          <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-b-md shadow-2xl z-20 absolute max-h-80 overflow-y-auto w-full border border-t-none border-neutral-500/20 divide-y divide-neutral-500/20">
                            {filteredApplications.map((application: CoolifyApplicationType) => (
                              <Combobox.Option as="div" key={application.id} value={application}>
                                {({ active, selected }) => (
                                  <div
                                    className={clsx(
                                      'flex flex-col gap-1 p-2 cursor-pointer rounded-md w-full',
                                      active && 'bg-zinc-400 dark:bg-zinc-700'
                                    )}
                                  >
                                    <div className="font-semibold text-black dark:text-white">
                                      {application.name}
                                    </div>
                                    <div className="text-neutral-500 text-2xs">
                                      {application.fqdn || application.id}
                                    </div>
                                  </div>
                                )}
                              </Combobox.Option>
                            ))}
                          </div>
                        </Combobox.Options>
                      </Transition>
                    </>
                  )}
                </Combobox>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="font-medium text-sm text-black dark:text-white">
                    Sync preview deployments
                  </div>
                  <div className="text-neutral-500 text-2xs">
                    Also overwrite the preview copy of each variable, so pull request previews get
                    these values too.
                  </div>
                </div>
                <ToggleSwitch value={syncPreview} onToggle={() => setSyncPreview(!syncPreview)} />
              </div>

              <Alert variant="info" size="sm" icon={true}>
                Coolify doesn&apos;t redeploy on sync. New values apply on the application&apos;s
                next deployment.
              </Alert>
            </div>

            <Alert variant="warning" size="sm">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  className="accent-emerald-500 mt-1"
                />
                <span className="block space-y-1">
                  <span className="block">
                    I understand that:<span className="text-red-500 ml-0.5">*</span>
                  </span>
                  {consentPoints.map((point) => (
                    <span key={point} className="flex gap-2 pl-1">
                      <span aria-hidden="true">•</span>
                      {point}
                    </span>
                  ))}
                </span>
              </label>
            </Alert>
          </div>
        )}
        <div className="flex items-center justify-between pt-8">
          <div>
            {credentialsValid && (
              <Button
                variant="secondary"
                type="button"
                icon={FaArrowLeft}
                onClick={() => {
                  setCredentialsValid(false)
                  setConsentGiven(false)
                }}
              >
                Back
              </Button>
            )}
          </div>
          <Button
            isLoading={loading || creating}
            variant="primary"
            type="submit"
            icon={credentialsValid ? FaCheck : FaArrowRight}
            iconPosition={credentialsValid ? 'left' : 'right'}
            disabled={credentialsValid && !consentGiven}
          >
            {credentialsValid ? 'Create' : 'Next'}
          </Button>
        </div>
      </form>
    </div>
  )
}
