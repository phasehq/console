import TestNomadAuth from '@/graphql/queries/syncing/nomad/testAuth.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import CreateNewNomadSync from '@/graphql/mutations/syncing/nomad/createNomadSync.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Button } from '../../common/Button'
import { EnvironmentType, ProviderCredentialsType } from '@/apollo/graphql'
import { RadioGroup } from '@headlessui/react'
import clsx from 'clsx'
import { FaAngleDoubleDown, FaCircle, FaDotCircle } from 'react-icons/fa'
import { toast } from 'react-toastify'

import { organisationContext } from '@/contexts/organisationContext'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'
import { ProviderIcon } from '../ProviderIcon'
import { Input } from '@/components/common/Input'

export const CreateNomadSync = (props: { appId: string; closeModal: () => void }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { appId, closeModal } = props

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })
  const { data: credentialsData } = useQuery(GetSavedCredentials, {
    variables: { orgId: organisation!.id },
  })

  const [testCreds, { loading: credentialTestPending }] = useLazyQuery(TestNomadAuth)

  const [createNomadSync, { data: syncData, loading: creating }] = useMutation(CreateNewNomadSync)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)

  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)

  const [path, setPath] = useState('/')

  const [nomadPath, setNomadPath] = useState<string>('')
  const [nomadNamespace, setNomadNamespace] = useState('default')

  const [pathIsCustom, setPathIsCustom] = useState(false)

  const [credentialsValid, setCredentialsValid] = useState(false)

  useEffect(() => {
    if (appEnvsData?.appEnvironments.length > 0) {
      const defaultEnv: EnvironmentType = appEnvsData.appEnvironments[0]
      setPhaseEnv(defaultEnv)
      setNomadPath(`${defaultEnv.app.name.replace(/ /g, '-')}/${defaultEnv.name}`.toLowerCase())
    }
  }, [appEnvsData])

  useEffect(() => {
    if (phaseEnv && !pathIsCustom)
      setNomadPath(`${phaseEnv.app.name.replace(/ /g, '-')}/${phaseEnv.name}`.toLowerCase())
  }, [phaseEnv, pathIsCustom])

  useEffect(() => {
    if (credentialsData && credentialsData.savedCredentials.length > 0) {
      setCredential(credentialsData.savedCredentials[0])
    }
  }, [credentialsData])

  const handleUpdatePath = (pathValue: string) => {
    setNomadPath(pathValue)
    setPathIsCustom(true)
  }

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (credential === null) {
      toast.error('Please select credential to use for this sync')
      return false
    } else if (!credentialsValid) {
      const { data: credsTestData } = await testCreds({
        variables: { credentialId: credential.id },
      })
      if (credsTestData) {
        setCredentialsValid(true)
      }
    } else {
      await createNomadSync({
        variables: {
          envId: phaseEnv?.id,
          path,
          nomadPath,
          nomadNamespace,
          credentialId: credential.id,
        },
        refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
      })
      toast.success('Created new Sync!')
      closeModal()
    }
  }

  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="text-2xl font-semibold text-black dark:text-white flex items-center gap-2">
          <ProviderIcon providerId="hashicorp_nomad" />
          Hashicorp Nomad
        </div>
        <div className="text-neutral-500 text-sm">Sync an environment with Hashicorp Nomad.</div>
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
                  providerFilter={'hashicorp_nomad'}
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
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Phase Environment
                  </label>
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

            <div className="flex justify-between items-center gap-4 py-4">
              <div className="border-b border-neutral-500/40 w-full"></div>
              <FaAngleDoubleDown className="shrink-0 text-neutral-500 text-2xl" />
              <div className="border-b border-neutral-500/40 w-full"></div>
            </div>

            <div className="grid gap-8">
              <Input
                value={nomadPath}
                setValue={handleUpdatePath}
                label="Nomad Variable path"
                required
              />
              <Input value={nomadNamespace} setValue={setNomadNamespace} label="Nomad Namespace" />
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
          <Button
            variant="primary"
            type="submit"
            isLoading={!credentialsValid && credentialTestPending}
          >
            {credentialsValid ? 'Create' : 'Next'}
          </Button>
        </div>
      </form>
    </div>
  )
}
