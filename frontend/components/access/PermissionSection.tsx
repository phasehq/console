import { Disclosure, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { Dispatch, SetStateAction } from 'react'
import { FaChevronRight } from 'react-icons/fa'
import { camelCaseToSpaces } from '@/utils/copy'
import {
  PermissionPolicy,
  permissionKeyFor,
  togglePolicyResourcePermission,
  userCanGrantPermission,
} from '@/utils/access/permissions'
import { AccessTemplateSelector } from './AccessTemplateSelector'
import { PermissionToggle } from './PermissionToggle'

// Every permission class, in every namespace, uses a subset of these. Rows
// leave a cell blank for any action their resource doesn't support.
const PERMISSION_ACTIONS = ['read', 'create', 'update', 'delete'] as const

type PermissionSectionProps = {
  title: string
  description: string
  availablePermissions: Record<string, string[]>
  rolePolicy: PermissionPolicy
  setRolePolicy: Dispatch<SetStateAction<PermissionPolicy | null>>
  actorPolicy: PermissionPolicy | null
  isAppResource?: boolean
  disabled?: boolean
}

export const PermissionSection = ({
  title,
  description,
  availablePermissions,
  rolePolicy,
  setRolePolicy,
  actorPolicy,
  isAppResource = false,
  disabled = false,
}: PermissionSectionProps) => {
  const actionIsActive = (resource: string, action: string) =>
    (rolePolicy[permissionKeyFor(resource, isAppResource)]?.[resource] ?? []).includes(action)

  // Grant ceiling: permissions outside the viewer's own role can't be added.
  // Actions already on the role stay toggleable so they can be removed —
  // the server only ceilings permissions an edit adds.
  const actionIsGrantable = (resource: string, action: string) =>
    userCanGrantPermission(actorPolicy, resource, action, isAppResource)

  const actionToggleDisabled = (resource: string, action: string) =>
    disabled || (!actionIsGrantable(resource, action) && !actionIsActive(resource, action))

  const actionToggleTitle = (resource: string, action: string) => {
    if (disabled || actionIsGrantable(resource, action)) return undefined
    return actionIsActive(resource, action)
      ? 'Your role does not include this permission. You can remove it but cannot add it back.'
      : 'Your role does not include this permission'
  }

  const grantableActionsFor = (resource: string) =>
    PERMISSION_ACTIONS.filter((action) => actionIsGrantable(resource, action))

  const handleToggle = (resource: string, action: string) => {
    setRolePolicy((previousPolicy) =>
      togglePolicyResourcePermission(previousPolicy!, {
        resource,
        action,
        isAppResource,
      })
    )
  }

  return (
    <Disclosure
      as="div"
      defaultOpen={false}
      className="flex w-full flex-col divide-y divide-neutral-500/30"
    >
      {({ open }) => (
        <>
          <Disclosure.Button className="w-full">
            <div className="flex w-full items-center justify-between gap-8 p-2 transition ease">
              <div className="py-4 text-left text-sm">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">{title}</div>
                <div className="text-neutral-500">{description}</div>
              </div>
              <FaChevronRight
                aria-hidden="true"
                className={clsx(
                  'transform text-neutral-500 transition ease',
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
            <Disclosure.Panel className="overflow-x-auto">
              <table
                aria-label={`${title} table`}
                className="min-w-full table-auto divide-y divide-zinc-500/40"
              >
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      Resource
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      Access
                    </th>
                    {PERMISSION_ACTIONS.map((action) => (
                      <th
                        key={action}
                        scope="col"
                        className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500"
                      >
                        {action}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-500/20">
                  {Object.entries(availablePermissions).map(([resource, allowedActions]) => (
                    <tr key={resource}>
                      <th
                        scope="row"
                        className="px-4 py-2.5 text-left text-xs font-normal text-zinc-700 dark:text-zinc-300"
                      >
                        {camelCaseToSpaces(resource)}
                      </th>
                      <td>
                        <AccessTemplateSelector
                          rolePolicy={rolePolicy}
                          setRolePolicy={setRolePolicy}
                          resource={resource}
                          allowedActions={allowedActions}
                          isAppResource={isAppResource}
                          disabled={disabled}
                          grantableActions={grantableActionsFor(resource)}
                        />
                      </td>
                      {PERMISSION_ACTIONS.map((action) =>
                        allowedActions.includes(action) ? (
                          <PermissionToggle
                            key={action}
                            isActive={actionIsActive(resource, action)}
                            onToggle={() => handleToggle(resource, action)}
                            disabled={actionToggleDisabled(resource, action)}
                            title={actionToggleTitle(resource, action)}
                            label={`${camelCaseToSpaces(action)} ${camelCaseToSpaces(resource)}`}
                          />
                        ) : (
                          <td key={action} className="text-center" />
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
  )
}
