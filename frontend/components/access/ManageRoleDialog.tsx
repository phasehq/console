import { RoleType } from '@/apollo/graphql'
import GenericDialog from '../common/GenericDialog'
import {
  arePoliciesEqual,
  parsePermissions,
  PermissionPolicy,
  userHasPermission,
} from '@/utils/access/permissions'
import { Alert } from '../common/Alert'
import { FaCog, FaEye } from 'react-icons/fa'
import { stringContainsCharacters } from '@/utils/copy'
import { useContext, useMemo, useRef, useState } from 'react'
import { Button } from '../common/Button'
import { Input } from '../common/Input'
import { useMutation } from '@apollo/client'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { UpdateRole } from '@/graphql/mutations/access/updateRole.gql'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { RoleLabel } from '../users/RoleLabel'
import { Textarea } from '../common/TextArea'
import { ColorPicker } from '../common/ColorPicker'
import { updateServiceAccountHandlers } from '@/utils/crypto/service-accounts'
import { KeyringContext } from '@/contexts/keyringContext'
import { arraysEqual } from '@/utils/crypto'
import { isHandledGraphQLError } from '@/utils/errors'
import { PermissionSection } from './PermissionSection'

export const ManageRoleDialog = ({ role, ownerRole }: { role: RoleType; ownerRole: RoleType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const ownerRolePolicy = parsePermissions(ownerRole.permissions)

  const [name, setName] = useState(role.name!)
  const [description, setDescription] = useState(role.description || '')
  const [color, setColor] = useState(role.color)
  const [rolePolicy, setRolePolicy] = useState<PermissionPolicy | null>(
    parsePermissions(role.permissions)!
  )

  const roleChanged =
    !arePoliciesEqual(rolePolicy!, parsePermissions(role.permissions)!) ||
    name !== role.name ||
    description !== role.description ||
    color !== role.color

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [updateRole, { loading: updateIsPending }] = useMutation(UpdateRole)

  const allowEdit =
    !role.isDefault && userHasPermission(organisation?.role?.permissions, 'Roles', 'update')

  // Grant ceiling: permissions outside the viewer's own role can't be granted
  const actorPolicy = useMemo(
    () => parsePermissions(organisation?.role?.permissions ?? ''),
    [organisation?.role?.permissions]
  )

  const handleFormSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (!stringContainsCharacters(name)) {
      toast.error('Role name must contain at least one non-space character!')
      return false
    }

    try {
      await handleUpdateRole()
      toast.success('Updated role!')
    } catch (error) {
      // The global errorLink surfaces the server error (e.g. grant-ceiling violations)
      if (!isHandledGraphQLError(error)) toast.error('Something went wrong')
    }
  }

  const handleUpdateRole = async () => {
    const existingRolePolicy: PermissionPolicy = JSON.parse(role.permissions)
    const mustUpdateServiceAccountHandlers = !arraysEqual(
      rolePolicy!.permissions!['ServiceAccounts'],
      existingRolePolicy.permissions['ServiceAccounts']
    )

    if (mustUpdateServiceAccountHandlers)
      await updateServiceAccountHandlers(organisation!.id, keyring!)

    const updated = await updateRole({
      variables: {
        id: role.id,
        name,
        description,
        color,
        permissions: JSON.stringify(rolePolicy),
      },
      refetchQueries: [{ query: GetRoles, variables: { orgId: organisation!.id } }],
    })

    if (updated.data.updateCustomRole.role.id) {
      if (dialogRef.current) dialogRef.current.closeModal()
    }
  }

  return (
    <GenericDialog
      title={`${role.isDefault ? 'View' : 'Manage'} ${role.name}`}
      buttonContent={
        <>
          {role.isDefault ? <FaEye /> : <FaCog />} {role.isDefault ? 'View' : 'Manage'}
        </>
      }
      buttonVariant="secondary"
      size="lg"
      ref={dialogRef}
    >
      <form onSubmit={handleFormSubmit}>
        <div className="divide-y divide-neutral-500/40 max-h-[85vh] overflow-y-auto">
          {role.isDefault && (
            <div className="py-3">
              <Alert size="sm" variant="info" icon={true}>
                This role is managed by Phase and cannot be edited
              </Alert>
            </div>
          )}
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
                    disabled={!allowEdit}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-neutral-500 text-sm mb-2" htmlFor="colorpicker">
                    Label color
                  </label>{' '}
                  <ColorPicker color={color!} setColor={setColor} disabled={!allowEdit} />
                </div>
              </div>
              <div className="w-full py-4">
                <Textarea
                  value={description}
                  setValue={setDescription}
                  label="Description"
                  maxLength={128}
                  disabled={!allowEdit}
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
            availablePermissions={ownerRolePolicy?.permissions ?? {}}
            rolePolicy={rolePolicy!}
            setRolePolicy={setRolePolicy}
            actorPolicy={actorPolicy}
            disabled={!allowEdit}
          />

          <PermissionSection
            title="Agent permissions"
            description="Manage access to resources and actions within Agents"
            availablePermissions={ownerRolePolicy?.agent_permissions ?? {}}
            rolePolicy={rolePolicy!}
            setRolePolicy={setRolePolicy}
            actorPolicy={actorPolicy}
            disabled={!allowEdit}
          />

          <PermissionSection
            title="App permissions"
            description="Manage access to resources and actions within Apps"
            availablePermissions={ownerRolePolicy?.app_permissions ?? {}}
            rolePolicy={rolePolicy!}
            setRolePolicy={setRolePolicy}
            actorPolicy={actorPolicy}
            isAppResource
            disabled={!allowEdit}
          />
        </div>

        {allowEdit && (
          <div className="flex justify-end items-center gap-2 pt-6">
            <Button
              type="submit"
              variant="primary"
              isLoading={updateIsPending}
              disabled={!roleChanged}
            >
              Save
            </Button>
          </div>
        )}
      </form>
    </GenericDialog>
  )
}
