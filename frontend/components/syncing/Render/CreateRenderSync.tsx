import GetRenderServices from '@/graphql/queries/syncing/render/getServices.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import CreateNewRenderServiceSync from '@/graphql/mutations/syncing/render/createRenderServiceSync.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import {
  EnvironmentType,
  ProviderCredentialsType,
  RailwayEnvironmentType,
  RailwayProjectType,
  RailwayServiceType,
  RenderServiceType,
} from '@/apollo/graphql'
import { SiRender } from 'react-icons/si'
import { toast } from 'react-toastify'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'
import { Input } from '@/components/common/Input'
import { RadioGroup, Combobox, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaDotCircle, FaAngleDoubleDown } from 'react-icons/fa'
import { FaCircle, FaChevronDown } from 'react-icons/fa6'
import { Button } from '@/components/common/Button'

export const CreateRenderSync = ({
  appId,
  closeModal,
}: {
  appId: string
  closeModal: () => void
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: credentialsData } = useQuery(GetSavedCredentials, {
    variables: { orgId: organisation!.id },
  })

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })

  const [getRenderServices, { loading }] = useLazyQuery(GetRenderServices)

  const [createRenderSync] = useMutation(CreateNewRenderServiceSync)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)
  const [credentialsValid, setCredentialsValid] = useState(false)

  const [renderServices, setRenderServices] = useState<RenderServiceType[]>([])
  const [renderService, setRenderService] = useState<RenderServiceType | null>(null)
  const [serviceQuery, setServiceQuery] = useState('')

  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)
  const [path, setPath] = useState('/')

  useEffect(() => {
    if (credentialsData && credentialsData.savedCredentials.length > 0) {
      setCredential(credentialsData.savedCredentials[0])
    }
  }, [credentialsData])

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
      toast.error('Please select credential to use for this sync')
      return false
    } else if (!credentialsValid) {
      const { data: servicesData } = await getRenderServices({
        variables: {
          credentialId: credential.id,
        },
        fetchPolicy: 'network-only',
      })
      if (servicesData?.renderServices) {
        setRenderServices(servicesData?.renderServices)
        setCredentialsValid(true)
      }
    } else if (!renderService) {
      toast.error('Please select a Render Service')
      return false
    } else {
      const { id, name } = renderService
      await createRenderSync({
        variables: {
          envId: phaseEnv?.id,
          path,
          serviceId: id,
          serviceName: name,
          credentialId: credential.id,
        },
        refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
      })

      toast.success('Created new Sync!')
      closeModal()
    }
  }

  const filteredServices =
    serviceQuery === ''
      ? renderServices
      : renderServices.filter((service) =>
          service.name?.toLowerCase().includes(serviceQuery.toLowerCase())
        )

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold text-black dark:text-white flex items-center gap-1">
          <SiRender />
          Render
        </div>
        <div className="text-neutral-500 text-sm">Sync an environment with Render.</div>
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
                  providerFilter={'render'}
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
                  {appEnvsData.appEnvironments.map((env: EnvironmentType) => (
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
              <FaAngleDoubleDown className="shrink-0 text-neutral-500 text-2xl" />
              <div className="border-b border-neutral-500/40 w-full"></div>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="relative col-span-2">
                <Combobox as="div" value={renderService} onChange={setRenderService}>
                  {({ open }) => (
                    <>
                      <div className="space-y-2">
                        <Combobox.Label as={Fragment}>
                          <label className="block text-neutral-500 text-sm" htmlFor="name">
                            Render Service <span className="text-red-500">*</span>
                          </label>
                        </Combobox.Label>
                        <div className="w-full relative flex items-center">
                          <Combobox.Input
                            className="w-full"
                            onChange={(event) => setServiceQuery(event.target.value)}
                            required
                            displayValue={(project: RailwayProjectType) => project?.name!}
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
                            {filteredServices.map((service: RenderServiceType) => (
                              <Combobox.Option as="div" key={service.id} value={service}>
                                {({ active, selected }) => (
                                  <div
                                    className={clsx(
                                      'flex flex-col gap-1 p-2 cursor-pointer rounded-md w-full',
                                      active && 'bg-zinc-400 dark:bg-zinc-700'
                                    )}
                                  >
                                    <div className="font-semibold text-black dark:text-white">
                                      {service.name}
                                    </div>
                                    <div className="text-neutral-500 text-2xs">{service.id}</div>
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
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-8">
          <div>
            {credentialsValid && (
              <Button variant="secondary" onClick={() => setCredentialsValid(false)}>
                Back
              </Button>
            )}
          </div>
          <Button isLoading={loading} variant="primary" type="submit">
            {credentialsValid ? 'Create' : 'Next'}
          </Button>
        </div>
      </form>
    </div>
  )
}
