import { RoleType } from '@/apollo/graphql'
import GenericDialog from '../common/GenericDialog'
import {
  arePoliciesEqual,
  parsePermissions,
  PermissionPolicy,
  updatePolicy,
  userHasPermission,
} from '@/utils/access/permissions'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { Alert } from '../common/Alert'
import { FaCog } from 'react-icons/fa'
import { camelCaseToSpaces } from '@/utils/copy'
import { useContext, useRef, useState } from 'react'
import { Button } from '../common/Button'
import { Input } from '../common/Input'
import { useMutation } from '@apollo/client'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { UpdateRole } from '@/graphql/mutations/access/updateRole.gql'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'

const PermissionToggle = ({
  isActive,
  onToggle,
  disabled,
}: {
  isActive: boolean
  onToggle: () => void
  disabled?: boolean
}) => {
  return (
    <td className="text-center">
      <ToggleSwitch value={isActive} onToggle={onToggle} disabled={disabled} />
    </td>
  )
}

export const ManageRoleDialog = ({ role, ownerRole }: { role: RoleType; ownerRole: RoleType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [name, setName] = useState(role.name!)
  const [rolePolicy, setRolePolicy] = useState<PermissionPolicy>(
    parsePermissions(role.permissions)!
  )

  const roleChanged =
    !arePoliciesEqual(rolePolicy, parsePermissions(role.permissions)!) || name !== role.name

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [updateRole, { loading: updateIsPending }] = useMutation(UpdateRole)

  const actionIsValid = (resource: string, action: string, isAppResource?: boolean) =>
    userHasPermission(ownerRole.permissions, resource, action, isAppResource)

  const allowEdit =
    !role.isDefault && userHasPermission(organisation?.role?.permissions, 'Roles', 'update')

  const handleUpdateResourceAction = (
    resource: string,
    action: string,
    isAppResource: boolean = false
  ) => {
    setRolePolicy((prevPolicy) => {
      const updatedPolicy = updatePolicy(prevPolicy, { resource, action, isAppResource })

      return updatedPolicy
    })
  }

  const handleToggleGlobalAccess = () => {
    setRolePolicy((prevPolicy) => {
      const updatedPolicy = updatePolicy(prevPolicy, { toggleGlobalAccess: true })

      return updatedPolicy
    })
  }

  const handleUpdateRole = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    const updated = await updateRole({
      variables: {
        id: role.id,
        name,
        description: '',
        permissions: JSON.stringify(rolePolicy),
      },
      refetchQueries: [{ query: GetRoles, variables: { orgId: organisation!.id } }],
    })

    if (updated.data.updateCustomRole.role.id) {
      if (dialogRef.current) dialogRef.current.closeModal()

      toast.success('Updated role!')
    }
  }

  return (
    <GenericDialog
      title={`Manage ${role.name}`}
      buttonContent={
        <>
          <FaCog /> Manage
        </>
      }
      buttonVariant="secondary"
      size="lg"
    >
      <form onSubmit={handleUpdateRole}>
        <div className="divide-y divide-neutral-500/40 space-y-6 max-h-[85vh] overflow-y-auto">
          {role.isDefault && (
            <div className="pt-3">
              <Alert size="sm" variant="info" icon={true}>
                This is a default role and cannot edited
              </Alert>
            </div>
          )}
          <div className="w-full max-w-sm">
            <Input
              value={name}
              setValue={setName}
              disabled={!allowEdit}
              label="Role name"
              required
              maxLength={32}
            />
          </div>

          <div>
            <div className="py-4 text-sm">
              <div className="text-zinc-900 dark:text-zinc-100 font-medium">
                Organisation permissions
              </div>
              <div className="text-neutral-500">
                Manage access to resources and actions across the Organisation
              </div>
            </div>
            <table className="table-auto min-w-full divide-y divide-zinc-500/40">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Resource
                  </th>

                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Read
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Create
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Update
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Delete
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-500/20">
                {Object.entries(rolePolicy?.permissions!).map(([resource, actions]) => (
                  <tr key={resource}>
                    <td className="px-4 py-2.5 text-xs text-zinc-700 dark:text-zinc-300">
                      {camelCaseToSpaces(resource)}
                    </td>
                    {['read', 'create', 'update', 'delete'].map((action) =>
                      actionIsValid(resource, action) ? (
                        <PermissionToggle
                          key={action}
                          isActive={actions.includes(action)}
                          onToggle={() => handleUpdateResourceAction(resource, action)}
                          disabled={!allowEdit}
                        />
                      ) : (
                        <td key={action} className="text-center"></td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="py-4 text-sm">
              <div className="text-zinc-900 dark:text-zinc-100 font-medium">App permissions</div>
              <div className="text-neutral-500">
                Manage access to resources and actions within Apps
              </div>
            </div>
            <table className="table-auto min-w-full divide-y divide-zinc-500/40">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Resource
                  </th>

                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Read
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Create
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Update
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Delete
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-500/20">
                {Object.entries(rolePolicy?.app_permissions!).map(([resource, actions]) => (
                  <tr key={resource}>
                    <td className="px-4 py-2.5 text-xs text-zinc-700 dark:text-zinc-300">
                      {camelCaseToSpaces(resource)}
                    </td>
                    {['read', 'create', 'update', 'delete'].map((action) =>
                      actionIsValid(resource, action, true) ? (
                        <PermissionToggle
                          key={action}
                          isActive={actions.includes(action)}
                          onToggle={() => handleUpdateResourceAction(resource, action, true)}
                          disabled={!allowEdit}
                        />
                      ) : (
                        <td key={action} className="text-center"></td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-4 flex items-center justify-between">
            <div>
              <div className="text-zinc-900 dark:text-zinc-100 font-medium">Global Access</div>
              <div className="text-neutral-500">
                Global access will give this role access to all Apps within the organisation.
              </div>
            </div>
            <div className="flex justify-start items-center gap-2 pt-4">
              <ToggleSwitch
                value={rolePolicy.global_access}
                onToggle={handleToggleGlobalAccess}
                disabled={!allowEdit}
              />
            </div>
          </div>
        </div>

        {allowEdit && (
          <div className="flex justify-end items-center gap-2 pt-4">
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
