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
import { FaChevronRight, FaCog, FaEye, FaPalette } from 'react-icons/fa'
import { camelCaseToSpaces, getContrastingTextColor, stringToHexColor } from '@/utils/copy'
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
  const [description, setDescription] = useState(role.description || '')
  const [color, setColor] = useState(role.color)
  const [rolePolicy, setRolePolicy] = useState<PermissionPolicy>(
    parsePermissions(role.permissions)!
  )

  const roleChanged =
    !arePoliciesEqual(rolePolicy, parsePermissions(role.permissions)!) ||
    name !== role.name ||
    description !== role.description ||
    color !== role.color

  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const colorInputRef = useRef<HTMLInputElement>(null)

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

  const handleTriggerClick = () => {
    colorInputRef.current?.click()
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
        description,
        color,
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
      <form onSubmit={handleUpdateRole}>
        <div className="divide-y divide-neutral-500/40 max-h-[85vh] overflow-y-auto">
          {role.isDefault && (
            <div className="py-3">
              <Alert size="sm" variant="info" icon={true}>
                This is a default role and cannot edited
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
                    Color
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      id="colorpicker"
                      className="size-7 rounded-full flex items-center justify-center ring-1 ring-inset ring-neutral-500"
                      style={{ backgroundColor: `${color}` }}
                      onClick={handleTriggerClick}
                      type="button"
                      title="Role label color"
                      disabled={!allowEdit}
                    >
                      {/* <FaPaintBrush
                      className="text-2xs"
                      style={{ color: getContrastingTextColor(color) }}
                    /> */}
                    </button>

                    <input
                      type="color"
                      ref={colorInputRef}
                      value={color!}
                      onChange={(e) => setColor(e.target.value)}
                      className="hidden"
                      disabled={!allowEdit}
                    />
                  </div>
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
                          {Object.entries(rolePolicy?.app_permissions!).map(
                            ([resource, actions]) => (
                              <tr key={resource}>
                                <td className="px-4 py-2.5 text-xs text-zinc-700 dark:text-zinc-300">
                                  {camelCaseToSpaces(resource)}
                                </td>
                                {['read', 'create', 'update', 'delete'].map((action) =>
                                  actionIsValid(resource, action, true) ? (
                                    <PermissionToggle
                                      key={action}
                                      isActive={actions.includes(action)}
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

          <div className="px-2 pt-4 flex items-center gap-10 justify-between text-sm">
            <div>
              <div className="text-zinc-900 dark:text-zinc-100 font-medium">Global Access</div>
              <div className="text-neutral-500">
                Grant implicit access to all Apps and Environments within the organisation. Useful
                for &quot;Admin&quot; type roles
              </div>
            </div>
            <div className="flex justify-start items-center gap-2 pt-4">
              <ToggleSwitch value={rolePolicy.global_access} onToggle={handleToggleGlobalAccess} />
            </div>
          </div>
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
