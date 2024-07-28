import { FaPlus } from 'react-icons/fa'
import GenericDialog from '../common/GenericDialog'
import { GetOrganisationAdminsAndSelf } from '@/graphql/queries/organisation/getOrganisationAdminsAndSelf.gql'
import { ApiEnvironmentEnvTypeChoices, ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { useContext, useRef, useState } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { useMutation, useQuery } from '@apollo/client'
import { createNewEnv } from '@/utils/crypto'
import { CreateEnv } from '@/graphql/mutations/environments/createEnvironment.gql'
import { Button } from '../common/Button'
import { Input } from '../common/Input'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { toast } from 'react-toastify'
import { UpgradeRequestForm } from '../forms/UpgradeRequestForm'
import Spinner from '../common/Spinner'
import { isCloudHosted } from '@/utils/appConfig'
import { Alert } from '../common/Alert'

export const CreateEnvironmentDialog = (props: { appId: string }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: orgAdminsData, loading: orgAdminsDataLoading } = useQuery(
    GetOrganisationAdminsAndSelf,
    {
      variables: {
        organisationId: organisation?.id,
      },
      skip: !organisation,
    }
  )

  const { data: appData, loading: appDataLoading } = useQuery(GetAppEnvironments, {
    variables: { appId: props.appId },
  })

  const isLoading = orgAdminsDataLoading || appDataLoading

  const allowNewEnv = organisation
    ? !organisation.planDetail!.maxEnvsPerApp ||
      organisation.planDetail!.maxEnvsPerApp! > appData?.appEnvironments.length
    : false

  const planDisplay = () => {
    if (organisation?.plan === ApiOrganisationPlanChoices.Fr)
      return {
        planName: 'Free',
        dialogTitle: 'Upgrade to Pro',
        description: `The Free plan is limited to ${organisation.planDetail!.maxEnvsPerApp!} Environments per App. To create more Environments, please upgrade to Pro.`,
      }
    else if (organisation?.plan === ApiOrganisationPlanChoices.Pr)
      return {
        planName: 'Pro',
        dialogTitle: 'Upgrade to Enterprise',
        description: `The Pro plan is limited to ${organisation.planDetail!.maxEnvsPerApp!} Environments per App. To create more Environments, please upgrade to Enterprise.`,
      }
  }

  const [createEnvironment, { loading }] = useMutation(CreateEnv)

  const [name, setName] = useState('')
  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const newEnvData = await createNewEnv(
      props.appId,
      name,
      ApiEnvironmentEnvTypeChoices.Custom,
      orgAdminsData.organisationAdminsAndSelf,
      appData.sseEnabled ? appData.serverPublicKey : null
    )

    await createEnvironment({
      variables: {
        envInput: newEnvData.createEnvPayload,
        adminKeys: newEnvData.adminKeysPayload,
        wrappedSeed: newEnvData.serverKeysPayload.wrappedSeed,
        wrappedSalt: newEnvData.serverKeysPayload.wrappedSalt,
      },
      refetchQueries: [{ query: GetAppEnvironments, variables: { appId: props.appId } }],
    })

    setName('')

    toast.success('Environment created!')

    closeModal()
  }

  const sanitizeInput = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '')

  const closeModal = () => {
    if (dialogRef.current) {
      dialogRef.current.closeModal()
    }
  }

  if (isLoading)
    return (
      <div className="flex w-full h-full items-center justify-center">
        <Spinner size="md" />
      </div>
    )

  return (
    <GenericDialog
      title={allowNewEnv ? 'Create a new Environment' : planDisplay()?.dialogTitle || ''}
      ref={dialogRef}
      onClose={() => {}}
      buttonVariant={'outline'}
      buttonContent={
        <div className="flex items-center gap-2">
          <FaPlus /> New Environment
        </div>
      }
    >
      {allowNewEnv ? (
        <form className="space-y-4 py-4" onSubmit={handleSubmit}>
          <div>
            <p className="text-neutral-500">Create a new Environment in this App</p>
          </div>

          <Alert variant="info" icon={true} size="sm">
            All Organisation Admins will have accesss to this Environment.
          </Alert>

          <Input
            value={sanitizeInput(name)}
            setValue={setName}
            label="Environment name"
            required
            maxLength={32}
            data-autofocus
          />

          <div className="flex justify-end">
            <Button type="submit" variant="primary" isLoading={loading}>
              Create
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4 py-4">
          <p className="text-zinc-400">{planDisplay()?.description}</p>
          {isCloudHosted() ? (
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
    </GenericDialog>
  )
}
