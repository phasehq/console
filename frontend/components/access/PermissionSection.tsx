import { Disclosure, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { Dispatch, SetStateAction } from 'react'
import { FaChevronRight } from 'react-icons/fa'
import { camelCaseToSpaces } from '@/utils/copy'
import {
  PermissionPolicy,
  permissionKeyFor,
  togglePolicyResourcePermission,
} from '@/utils/access/permissions'
import { AccessTemplateSelector } from './AccessTemplateSelector'
import { PermissionToggle } from './PermissionToggle'

type PermissionSectionProps = {
  title: string
  description: string
  availablePermissions: Record<string, string[]>
  actions: readonly string[]
  rolePolicy: PermissionPolicy
  setRolePolicy: Dispatch<SetStateAction<PermissionPolicy | null>>
  isAppResource?: boolean
  disabled?: boolean
}

export const PermissionSection = ({
  title,
  description,
  availablePermissions,
  actions,
  rolePolicy,
  setRolePolicy,
  isAppResource = false,
  disabled = false,
}: PermissionSectionProps) => {
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
                    {actions.map((action) => (
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
                        {camelCaseToSpaces(resource)} {resource === 'Tokens' && '(Legacy)'}
                      </th>
                      <td>
                        <AccessTemplateSelector
                          rolePolicy={rolePolicy}
                          setRolePolicy={setRolePolicy}
                          resource={resource}
                          allowedActions={allowedActions}
                          isAppResource={isAppResource}
                          disabled={disabled}
                        />
                      </td>
                      {actions.map((action) =>
                        allowedActions.includes(action) ? (
                          <PermissionToggle
                            key={action}
                            isActive={(
                              rolePolicy[permissionKeyFor(resource, isAppResource)]?.[resource] ??
                              []
                            ).includes(action)}
                            onToggle={() => handleToggle(resource, action)}
                            disabled={disabled}
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
