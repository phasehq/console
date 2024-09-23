import { RoleType } from '@/apollo/graphql'
import GenericDialog from '../common/GenericDialog'
import {
  parsePermissions,
  PermissionPolicy,
  updatePolicy,
  userHasPermission,
} from '@/utils/access/permissions'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { FaBrush, FaChevronRight, FaPaintBrush, FaPalette, FaPlus } from 'react-icons/fa'
import { camelCaseToSpaces, generateRandomHexColor, getContrastingTextColor } from '@/utils/copy'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { CreateRole } from '@/graphql/mutations/access/createRole.gql'
import { useContext, useEffect, useRef, useState } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { useMutation, useQuery } from '@apollo/client'
import { Input } from '../common/Input'
import { Button } from '../common/Button'
import { toast } from 'react-toastify'
import { Disclosure, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { RoleLabel } from '../users/RoleLabel'
import { Textarea } from '../common/TextArea'

const PermissionToggle = ({ isActive, onToggle }: { isActive: boolean; onToggle: () => void }) => {
  return (
    <td className="text-center">
      <ToggleSwitch value={isActive} onToggle={onToggle} />
    </td>
  )
}

export const CreateRoleDialog = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: roleData, loading: roleDataPending } = useQuery(GetRoles, {
    variables: { orgId: organisation?.id },
    skip: !organisation,
  })

  const [createRole, { loading: createIsPending }] = useMutation(CreateRole)

  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const colorInputRef = useRef<HTMLInputElement>(null)

  const ownerRole = roleData?.roles.find((role: RoleType) => role.name === 'Owner')

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(generateRandomHexColor())
  const [rolePolicy, setRolePolicy] = useState<PermissionPolicy | null>(null)

  const setEmptyPolicy = () => {
    const emptyPolicy = structuredClone(parsePermissions(ownerRole.permissions))!
    Object.entries(emptyPolicy.permissions).forEach(([key]) => {
      emptyPolicy.permissions[key] = []
    })
    Object.entries(emptyPolicy.app_permissions).forEach(([key]) => {
      emptyPolicy.app_permissions[key] = []
    })
    emptyPolicy.global_access = false

    setRolePolicy(emptyPolicy)
  }

  const reset = () => {
    setEmptyPolicy()
    setName('')
  }

  useEffect(() => {
    if (roleData) {
      setEmptyPolicy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleData, ownerRole])

  const actionIsValid = (resource: string, action: string, isAppResource?: boolean) =>
    userHasPermission(ownerRole.permissions, resource, action, isAppResource)

  const handleUpdateResourceAction = (
    resource: string,
    action: string,
    isAppResource: boolean = false
  ) => {
    setRolePolicy((prevPolicy) => {
      const updatedPolicy = updatePolicy(prevPolicy!, { resource, action, isAppResource })

      return updatedPolicy
    })
  }

  const handleTriggerClick = () => {
    colorInputRef.current?.click()
  }

  const handleToggleGlobalAccess = () => {
    setRolePolicy((prevPolicy) => {
      const updatedPolicy = updatePolicy(prevPolicy!, { toggleGlobalAccess: true })

      return updatedPolicy
    })
  }

  const handleCreateRole = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
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

  if (!rolePolicy || roleDataPending) return <></>

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
                    >
                      {/* <FaPaintBrush
                      className="text-2xs"
                      style={{ color: getContrastingTextColor(color) }}
                    /> */}
                    </button>

                    <input
                      type="color"
                      ref={colorInputRef}
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="hidden"
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

          <div className="px-2 pt-4 flex items-center gap-10 justify-between">
            <div>
              <div className="text-zinc-900 dark:text-zinc-100 font-medium text-sm">
                Global Access
              </div>
              <div className="text-neutral-500 text-sm">
                Grant implicit access to all Apps and Environments within the organisation. Useful
                for &quot;Admin&quot; type roles
              </div>
            </div>
            <div className="flex justify-start items-center gap-2 pt-4">
              <ToggleSwitch value={rolePolicy.global_access} onToggle={handleToggleGlobalAccess} />
            </div>
          </div>
        </div>

        <div className="flex justify-end items-center gap-2 pt-8">
          <Button type="submit" variant="primary" isLoading={createIsPending}>
            Create Role
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}
