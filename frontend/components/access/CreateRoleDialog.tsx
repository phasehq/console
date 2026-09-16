import { ApiOrganisationPlanChoices, RoleType } from '@/apollo/graphql'
import GenericDialog from '../common/GenericDialog'
import { parsePermissions, PermissionPolicy } from '@/utils/access/permissions'
import { FaPlus } from 'react-icons/fa'
import { getRandomCuratedColor, stringContainsCharacters } from '@/utils/copy'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { CreateRole } from '@/graphql/mutations/access/createRole.gql'
import { useContext, useEffect, useRef, useState } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { useMutation, useQuery } from '@apollo/client'
import { Input } from '../common/Input'
import { Button } from '../common/Button'
import { toast } from 'react-toastify'
import { RoleLabel } from '../users/RoleLabel'
import { Textarea } from '../common/TextArea'
import { ColorPicker } from '../common/ColorPicker'
import { UpsellDialog } from '../settings/organisation/UpsellDialog'
import { PlanLabel } from '../settings/organisation/PlanLabel'
import { isCloudHosted } from '@/utils/appConfig'
import { PermissionSection } from './PermissionSection'
import {
  AGENT_PERMISSION_ACTIONS,
  ORGANISATION_PERMISSION_ACTIONS,
} from '@/utils/access/permissionSections'

export const CreateRoleDialog = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const upsell = organisation?.plan === ApiOrganisationPlanChoices.Fr

  const { data: roleData, loading: roleDataPending } = useQuery(GetRoles, {
    variables: { orgId: organisation?.id },
    skip: !organisation,
  })

  const [createRole, { loading: createIsPending }] = useMutation(CreateRole)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const ownerRole = roleData?.roles.find((role: RoleType) => role.name === 'Owner')
  const ownerRolePolicy = ownerRole ? parsePermissions(ownerRole.permissions) : null

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(getRandomCuratedColor())
  const [rolePolicy, setRolePolicy] = useState<PermissionPolicy | null>(null)

  const setEmptyPolicy = () => {
    const emptyPolicy = structuredClone(parsePermissions(ownerRole.permissions))!
    Object.entries(emptyPolicy.permissions).forEach(([key]) => {
      emptyPolicy.permissions[key] = []
    })
    Object.entries(emptyPolicy.app_permissions).forEach(([key]) => {
      emptyPolicy.app_permissions[key] = []
    })
    Object.entries(emptyPolicy.agent_permissions).forEach(([key]) => {
      emptyPolicy.agent_permissions[key] = []
    })
    emptyPolicy.global_access = false

    setRolePolicy(emptyPolicy)
  }

  const reset = () => {
    setEmptyPolicy()
    setName('')
    setDescription('')
  }

  useEffect(() => {
    if (roleData) {
      setEmptyPolicy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleData, ownerRole])

  const handleCreateRole = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (!stringContainsCharacters(name)) {
      toast.error('Role name must contain at least one non-space character!')
      return false
    }

    const created = await createRole({
      variables: {
        name,
        description,
        color,
        permissions: JSON.stringify(rolePolicy),
        organisationId: organisation!.id,
      },
      refetchQueries: [{ query: GetRoles, variables: { orgId: organisation!.id } }],
    })

    if (created.data.createCustomRole.role.id) {
      if (dialogRef.current) dialogRef.current.closeModal()
      reset()
      toast.success('Created new role!')
    }
  }

  if (upsell)
    return (
      <UpsellDialog
        buttonLabel={
          <>
            <FaPlus /> Create Role{' '}
            <PlanLabel
              plan={isCloudHosted() ? ApiOrganisationPlanChoices.Pr : ApiOrganisationPlanChoices.En}
            />
          </>
        }
      />
    )

  if (!rolePolicy || !ownerRolePolicy || roleDataPending) return <></>

  return (
    <GenericDialog
      title="Create a new Role"
      buttonContent={
        <>
          <FaPlus /> Create Role
        </>
      }
      buttonVariant="primary"
      size="lg"
      ref={dialogRef}
    >
      <form onSubmit={handleCreateRole}>
        <div className="divide-y divide-neutral-500/40 max-h-[85vh] overflow-y-auto">
          <div className="flex items-start justify-between w-full py-4 ">
            <div className="w-full">
              <div className="flex items-center gap-4">
                <div className="w-full max-w-xs">
                  <Input
                    value={name}
                    setValue={setName}
                    label="Role name"
                    required
                    maxLength={32}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-neutral-500 text-sm mb-2" htmlFor="colorpicker">
                    Label color
                  </label>{' '}
                  <ColorPicker color={color!} setColor={setColor} />
                </div>
              </div>
              <div className="w-full py-4">
                <Textarea
                  value={description}
                  setValue={setDescription}
                  label="Description"
                  maxLength={128}
                />
              </div>
            </div>
            {name && (
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="text-sm text-neutral-500">This role will appear as:</div>
                <RoleLabel role={{ name, color, id: '' }} />
              </div>
            )}
          </div>

          <PermissionSection
            title="Organisation permissions"
            description="Manage access to organisation-wide resources and actions"
            availablePermissions={ownerRolePolicy.permissions}
            actions={ORGANISATION_PERMISSION_ACTIONS}
            rolePolicy={rolePolicy}
            setRolePolicy={setRolePolicy}
          />

          <PermissionSection
            title="Agent permissions"
            description="Manage access to resources and actions within Agents"
            availablePermissions={ownerRolePolicy.agent_permissions}
            actions={AGENT_PERMISSION_ACTIONS}
            rolePolicy={rolePolicy}
            setRolePolicy={setRolePolicy}
          />

          <PermissionSection
            title="App permissions"
            description="Manage access to resources and actions within Apps"
            availablePermissions={ownerRolePolicy.app_permissions}
            actions={ORGANISATION_PERMISSION_ACTIONS}
            rolePolicy={rolePolicy}
            setRolePolicy={setRolePolicy}
            isAppResource
          />
        </div>

        <div className="flex justify-end items-center gap-2 pt-6">
          <Button type="submit" variant="primary" isLoading={createIsPending}>
            Create Role
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}
