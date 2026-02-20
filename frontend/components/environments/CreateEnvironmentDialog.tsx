import { FaPlus } from 'react-icons/fa'
import GenericDialog from '../common/GenericDialog'
import { GetGlobalAccessUsers } from '@/graphql/queries/organisation/getGlobalAccessUsers.gql'
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
import Spinner from '../common/Spinner'
import { Alert } from '../common/Alert'
import { UpsellDialog } from '../settings/organisation/UpsellDialog'
import { sanitizeInput } from '@/utils/environment'
import { PlanLabel } from '../settings/organisation/PlanLabel'
import { isCloudHosted } from '@/utils/appConfig'

export const CreateEnvironmentDialog = (props: { appId: string }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: orgAdminsData, loading: orgAdminsDataLoading } = useQuery(GetGlobalAccessUsers, {
    variables: {
      organisationId: organisation?.id,
    },
    skip: !organisation,
  })

  const { data: appData, loading: appDataLoading } = useQuery(GetAppEnvironments, {
    variables: { appId: props.appId },
  })

  const isLoading = orgAdminsDataLoading || appDataLoading

  const allowNewEnv = () => {
    if (!organisation?.planDetail?.maxEnvsPerApp) return true
    return appData?.appEnvironments.length < organisation.planDetail?.maxEnvsPerApp
  }

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
  const inputRef = useRef(null)

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const newEnvData = await createNewEnv(
      props.appId,
      name,
      ApiEnvironmentEnvTypeChoices.Custom,
      orgAdminsData.organisationGlobalAccessUsers,
      appData.sseEnabled ? appData.serverPublicKey : null
    )

    const { data } = await createEnvironment({
      variables: {
        envInput: newEnvData.createEnvPayload,
        adminKeys: newEnvData.adminKeysPayload,
        wrappedSeed: newEnvData.serverKeysPayload.wrappedSeed,
        wrappedSalt: newEnvData.serverKeysPayload.wrappedSalt,
      },
      refetchQueries: [{ query: GetAppEnvironments, variables: { appId: props.appId } }],
    })

    if (!data) {
      return
    }

    setName('')

    toast.success('Environment created!')

    closeModal()
  }

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

  if (!allowNewEnv())
    return (
      <UpsellDialog
        title={`Upgrade to ${isCloudHosted() ? 'Pro' : 'Enterprise'} to create custom environments`}
        buttonLabel={
          <span className="flex items-center gap-2 truncate">
            <FaPlus className="shrink-0" /> <span className="truncate">New Environment</span>{' '}
            <PlanLabel
              plan={
                organisation?.plan === ApiOrganisationPlanChoices.Fr
                  ? isCloudHosted()
                    ? ApiOrganisationPlanChoices.Pr
                    : ApiOrganisationPlanChoices.En
                  : ApiOrganisationPlanChoices.En
              }
            />
          </span>
        }
        buttonVariant="outline"
      />
    )

  return (
    <GenericDialog
      title={allowNewEnv() ? 'Create a new Environment' : planDisplay()?.dialogTitle || ''}
      ref={dialogRef}
      onClose={() => {}}
      buttonVariant={'outline'}
      buttonContent={
        <div className="flex items-center gap-2">
          <FaPlus /> New Environment
        </div>
      }
      initialFocus={inputRef}
    >
      <form className="space-y-4 py-4" onSubmit={handleSubmit}>
        <div>
          <p className="text-neutral-500">Create a new Environment in this App</p>
        </div>

        <Alert variant="info" icon={true} size="sm">
          All Organisation Admins will have access to this Environment.
        </Alert>

        <div className="space-y-2">
          <Input
            value={sanitizeInput(name)}
            setValue={setName}
            label="Environment name"
            required
            maxLength={32}
            ref={inputRef}
          />
          <p className="text-xs text-neutral-500">
            Use up to 32 characters. Only letters, numbers, hyphens and underscores allowed.
          </p>
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" isLoading={loading}>
            Create
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}
