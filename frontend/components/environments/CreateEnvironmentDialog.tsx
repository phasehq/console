import { FaPlus } from 'react-icons/fa'
import GenericDialog from '../common/GenericDialog'
import { GetGlobalAccessUsers } from '@/graphql/queries/organisation/getGlobalAccessUsers.gql'
import { ApiEnvironmentEnvTypeChoices, ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { forwardRef, useContext, useImperativeHandle, useRef, useState } from 'react'
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
import { UpsellDialog, UpsellDialogHandle } from '../settings/organisation/UpsellDialog'
import { sanitizeInput } from '@/utils/environment'
import { PlanLabel } from '../settings/organisation/PlanLabel'
import { ColorPicker } from '../common/ColorPicker'
import { stringToHexColor } from '@/utils/copy'

export type CreateEnvironmentDialogHandle = { openModal: () => void }

/**
 * The secrets grid's "+ New environment" button (with the plan to upgrade to,
 * when the plan's env limit is reached). The grid also opens it from any cell
 * of its new-environment column.
 */
export const CreateEnvironmentDialog = forwardRef<
  CreateEnvironmentDialogHandle,
  { appId: string }
>(function CreateEnvironmentDialog(props, ref) {
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
  // '' = auto: the server stores null and clients derive a color from the name
  const [color, setColor] = useState('')

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const upsellRef = useRef<UpsellDialogHandle>(null)
  const inputRef = useRef(null)

  useImperativeHandle(ref, () => ({
    openModal: () =>
      allowNewEnv() ? dialogRef.current?.openModal() : upsellRef.current?.openModal(),
  }))

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
        envInput: { ...newEnvData.createEnvPayload, color: color || null },
        adminKeys: newEnvData.adminKeysPayload,
        wrappedSeed: newEnvData.serverKeysPayload.wrappedSeed,
        wrappedSalt: newEnvData.serverKeysPayload.wrappedSalt,
      },
      refetchQueries: [
        { query: GetAppEnvironments, variables: { appId: props.appId } },
        // The secrets grid's columns, when it's mounted
        'GetAppSecrets',
      ],
    })

    if (!data) {
      return
    }

    setName('')
    setColor('')

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

  if (!allowNewEnv()) {
    // Custom environments are a Pro feature (up to 10/app); Enterprise is unlimited.
    // The upgrade target tracks the org's current plan, not the hosting mode.
    const isFreePlan = organisation?.plan === ApiOrganisationPlanChoices.Fr
    const targetPlan = isFreePlan
      ? ApiOrganisationPlanChoices.Pr
      : ApiOrganisationPlanChoices.En

    return (
      <UpsellDialog
        ref={upsellRef}
        title={
          isFreePlan
            ? 'Upgrade to Pro to create custom environments'
            : 'Upgrade to Enterprise for unlimited environments'
        }
        targetPlan={targetPlan}
        buttonLabel={
          <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
            <FaPlus className="shrink-0 text-2xs" /> New environment <PlanLabel plan={targetPlan} />
          </span>
        }
        buttonVariant="ghost"
      />
    )
  }

  return (
    <GenericDialog
      title={allowNewEnv() ? 'Create a new Environment' : planDisplay()?.dialogTitle || ''}
      ref={dialogRef}
      onClose={() => {}}
      buttonVariant="ghost"
      buttonContent={
        <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
          <FaPlus className="shrink-0 text-2xs" /> New environment
        </span>
      }
      initialFocus={inputRef}
    >
      <form className="space-y-4 pt-4" onSubmit={handleSubmit}>
        <div>
          <p className="text-neutral-500 text-sm">Create a new Environment in this App</p>
        </div>

        <Alert variant="info" icon={true} size="sm">
          All Organisation Admins will have access to this Environment.
        </Alert>

        <div className="space-y-2">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Input
                value={sanitizeInput(name)}
                setValue={setName}
                label="Environment name"
                required
                maxLength={32}
                ref={inputRef}
              />
            </div>
            <div className="pb-0.5" title="Environment color">
              <ColorPicker
                color={color || stringToHexColor(name || 'environment')}
                setColor={setColor}
              />
            </div>
          </div>
          <p className="text-xs text-neutral-500">
            Use up to 32 characters. Only letters, numbers, hyphens, and underscores are allowed.
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
})
