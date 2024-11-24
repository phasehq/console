import { RoleType } from '@/apollo/graphql'
import GenericDialog from '../common/GenericDialog'
import {
  arePoliciesEqual,
  parsePermissions,
  PermissionPolicy,
  togglePolicyResourcePermission,
  userHasPermission,
} from '@/utils/access/permissions'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { Alert } from '../common/Alert'
import { FaChevronRight, FaCog, FaEye } from 'react-icons/fa'
import { camelCaseToSpaces, stringContainsCharacters } from '@/utils/copy'
import { useContext, useRef, useState } from 'react'
import { Button } from '../common/Button'
import { Input } from '../common/Input'
import { useMutation } from '@apollo/client'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { UpdateRole } from '@/graphql/mutations/access/updateRole.gql'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { Disclosure, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { RoleLabel } from '../users/RoleLabel'
import { Textarea } from '../common/TextArea'
import { PermissionToggle } from './PermissionToggle'
import { AccessTemplateSelector } from './AccessTemplateSelector'
import { ColorPicker } from '../common/ColorPicker'
import { updateServiceAccountHandlers } from '@/utils/crypto/service-accounts'
import { KeyringContext } from '@/contexts/keyringContext'
import { arraysEqual } from '@/utils/crypto'

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

  const actionIsValid = (resource: string, action: string, isAppResource?: boolean) =>
    userHasPermission(ownerRole.permissions, resource, action, isAppResource)

  const allowEdit =
    !role.isDefault && userHasPermission(organisation?.role?.permissions, 'Roles', 'update')

  const resourcePermissions = (resource: string, isAppResource?: boolean) => {
    const permissionKey = isAppResource ? 'app_permissions' : 'permissions'
    return rolePolicy![permissionKey]?.[resource] ?? []
  }

  const handleUpdateResourceAction = (
    resource: string,
    action: string,
    isAppResource: boolean = false
  ) => {
    setRolePolicy((prevPolicy) => {
      const updatedPolicy = togglePolicyResourcePermission(prevPolicy!, {
        resource,
        action,
        isAppResource,
      })

      return updatedPolicy
    })
  }

  const handleToggleGlobalAccess = () => {
    setRolePolicy((prevPolicy) => {
      const updatedPolicy = togglePolicyResourcePermission(prevPolicy!, {
        toggleGlobalAccess: true,
      })

      return updatedPolicy
    })
  }

  const handleFormSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (!stringContainsCharacters(name)) {
      toast.error('Role name must contain at least one non-space character!')
      return false
    }

    toast.promise(handleUpdateRole, {
      pending: 'Updating role...',
      success: 'Updated role!',
      error: 'Something went wrong!',
    })
  }

  const handleUpdateRole = () => {
    return new Promise(async (resolve, reject) => {
      const existingRolePolicy: PermissionPolicy = JSON.parse(role.permissions)
      const mustUpdateServiceAccountHandlers = !arraysEqual(
        rolePolicy!.permissions!['ServiceAccounts'],
        existingRolePolicy.permissions['ServiceAccounts']
      )

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

      if (mustUpdateServiceAccountHandlers)
        await updateServiceAccountHandlers(organisation!.id, keyring!)

      if (updated.data.updateCustomRole.role.id) {
        resolve(true)
        if (dialogRef.current) dialogRef.current.closeModal()
      } else reject
    })
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

          <div>
            <Disclosure
              as="div"
              defaultOpen={false}
              className="flex flex-col divide-y divide-neutral-500/30 w-full"
            >
              {({ open }) => (
                <>
                  <Disclosure.Button>
                    <div
                      className={clsx(
                        'p-2 flex justify-between items-center gap-8 transition ease w-full'
                      )}
                    >
                      <div className="py-4 text-sm text-left">
                        <div className="text-zinc-900 dark:text-zinc-100 font-medium">
                          Organisation permissions
                        </div>
                        <div className="text-neutral-500">
                          Manage access to resources and actions across the Organisation
                        </div>
                      </div>
                      <FaChevronRight
                        className={clsx(
                          'transform transition ease text-neutral-500',
                          open ? 'rotate-90' : 'rotate-0'
                        )}
                      />
                    </div>
                  </Disclosure.Button>

                  <Transition
                    enter="transition-all duration-300 ease-out"
                    enterFrom="max-h-0 opacity-0"
                    enterTo="max-h-screen opacity-100"
                    leave="transition-all duration-200 ease-out"
                    leaveFrom="max-h-screen opacity-100"
                    leaveTo="max-h-0 opacity-0"
                  >
                    <Disclosure.Panel>
                      <table className="table-auto min-w-full divide-y divide-zinc-500/40">
                        <thead>
                          <tr>
                            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Resource
                            </th>

                            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Access
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
                          {Object.entries(ownerRolePolicy?.permissions!).map(
                            ([resource, actions]) => (
                              <tr key={resource}>
                                <td className="px-4 py-2.5 text-xs text-zinc-700 dark:text-zinc-300">
                                  {camelCaseToSpaces(resource)}
                                </td>

                                <td>
                                  <AccessTemplateSelector
                                    rolePolicy={rolePolicy!}
                                    setRolePolicy={setRolePolicy}
                                    resource={resource}
                                    isAppResource={false}
                                  />
                                </td>

                                {['read', 'create', 'update', 'delete'].map((action) =>
                                  actionIsValid(resource, action) ? (
                                    <PermissionToggle
                                      key={action}
                                      isActive={resourcePermissions(resource).includes(action)}
                                      onToggle={() => handleUpdateResourceAction(resource, action)}
                                      disabled={!allowEdit}
                                    />
                                  ) : (
                                    <td key={action} className="text-center"></td>
                                  )
                                )}
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </Disclosure.Panel>
                  </Transition>
                </>
              )}
            </Disclosure>
          </div>

          <div>
            <Disclosure
              as="div"
              defaultOpen={false}
              className="flex flex-col divide-y divide-neutral-500/30 w-full"
            >
              {({ open }) => (
                <>
                  <Disclosure.Button>
                    <div
                      className={clsx(
                        'p-2 flex justify-between items-center gap-8 transition ease w-full'
                      )}
                    >
                      <div className="py-4 text-sm text-left">
                        <div className="text-zinc-900 dark:text-zinc-100 font-medium">
                          App permissions
                        </div>
                        <div className="text-neutral-500">
                          Manage access to resources and actions within Apps
                        </div>
                      </div>
                      <FaChevronRight
                        className={clsx(
                          'transform transition ease text-neutral-500',
                          open ? 'rotate-90' : 'rotate-0'
                        )}
                      />
                    </div>
                  </Disclosure.Button>

                  <Transition
                    enter="transition-all duration-300 ease-out"
                    enterFrom="max-h-0 opacity-0"
                    enterTo="max-h-screen opacity-100"
                    leave="transition-all duration-300 ease-out"
                    leaveFrom="max-h-screen opacity-100"
                    leaveTo="max-h-0 opacity-0"
                  >
                    <Disclosure.Panel>
                      <table className="table-auto min-w-full divide-y divide-zinc-500/40">
                        <thead>
                          <tr>
                            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Resource
                            </th>

                            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Access
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
                          {Object.entries(ownerRolePolicy?.app_permissions!).map(
                            ([resource, actions]) => (
                              <tr key={resource}>
                                <td className="px-4 py-2.5 text-xs text-zinc-700 dark:text-zinc-300">
                                  {camelCaseToSpaces(resource)}{' '}
                                  {resource === 'Tokens' && '(Legacy)'}
                                </td>
                                <td>
                                  <AccessTemplateSelector
                                    rolePolicy={rolePolicy!}
                                    setRolePolicy={setRolePolicy}
                                    resource={resource}
                                    isAppResource={true}
                                  />
                                </td>

                                {['read', 'create', 'update', 'delete'].map((action) =>
                                  actionIsValid(resource, action, true) ? (
                                    <PermissionToggle
                                      key={action}
                                      isActive={resourcePermissions(resource, true).includes(
                                        action
                                      )}
                                      onToggle={() =>
                                        handleUpdateResourceAction(resource, action, true)
                                      }
                                      disabled={!allowEdit}
                                    />
                                  ) : (
                                    <td key={action} className="text-center"></td>
                                  )
                                )}
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </Disclosure.Panel>
                  </Transition>
                </>
              )}
            </Disclosure>
          </div>

          {/* <div className="px-2 pt-4 flex items-center gap-10 justify-between text-sm">
            <div>
              <div className="text-zinc-900 dark:text-zinc-100 font-medium">Global Access</div>
              <div className="text-neutral-500">
                Grant implicit access to all Apps and Environments within the organisation. Useful
                for &quot;Admin&quot; type roles
              </div>
            </div>
            <div className="flex justify-start items-center gap-2 pt-4">
              <ToggleSwitch
                value={rolePolicy!.global_access}
                onToggle={handleToggleGlobalAccess}
                disabled={!allowEdit}
              />
            </div>
          </div> */}
        </div>

        {allowEdit && (
          <div className="flex justify-end items-center gap-2 pt-8">
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
