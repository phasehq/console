import { PermissionPolicy, updatePolicyResourcePermissions } from '@/utils/access/permissions'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'
import { Dispatch, SetStateAction, Fragment, ReactNode } from 'react'
import { FaAsterisk, FaBan, FaChevronDown, FaEdit, FaEye } from 'react-icons/fa'

export const AccessTemplateSelector = ({
  resource,
  rolePolicy,
  setRolePolicy,
  allowedActions,
  isAppResource,
  disabled,
}: {
  resource: string
  rolePolicy: PermissionPolicy
  setRolePolicy: Dispatch<SetStateAction<PermissionPolicy | null>>
  allowedActions?: string[]
  isAppResource?: boolean
  disabled?: boolean
}) => {
  type AccessTemplate = {
    name: string
    icon: ReactNode
    actions?: string[]
  }

  const fullAccessActions = allowedActions ?? ['create', 'read', 'update', 'delete']
  const accessTemplates: AccessTemplate[] = [
    {
      name: 'No access',
      icon: <FaBan />,
      actions: [],
    },
    ...(fullAccessActions.includes('read')
      ? [
          {
            name: 'Read access',
            icon: <FaEye />,
            actions: ['read'],
          },
        ]
      : []),
    ...(fullAccessActions.length > 1
      ? [
          {
            name: 'Full access',
            icon: <FaAsterisk />,
            actions: fullAccessActions,
          },
        ]
      : []),
    {
      name: 'Custom access',
      icon: <FaEdit />,
      actions: undefined,
    },
  ]

  const applyAccessTemplate = (
    resource: string,
    template: AccessTemplate,
    isAppResource?: boolean
  ) => {
    setRolePolicy((prevPolicy) => {
      if (template.actions) {
        const updatedPolicy = updatePolicyResourcePermissions(prevPolicy!, {
          resource,
          actions: template.actions,
          isAppResource,
        })
        return updatedPolicy
      }
      return prevPolicy
    })
  }

  const permissionsKey = isAppResource ? rolePolicy.app_permissions : rolePolicy.permissions
  const currentActions = permissionsKey[resource] || []
  const value =
    accessTemplates.find(
      (template) =>
        template.actions &&
        template.actions.length === currentActions.length &&
        template.actions.every((action) => currentActions.includes(action))
    ) || accessTemplates.find((template) => template.name === 'Custom access')!

  const handleChange = (selectedValue: AccessTemplate) => {
    if (selectedValue.actions) {
      applyAccessTemplate(resource, selectedValue, isAppResource)
    }
  }

  return (
    <div className="relative">
      <Listbox value={value} onChange={handleChange} disabled={disabled}>
        {({ open }) => (
          <>
            <Listbox.Button as={Fragment} aria-required>
              {({ value }) => (
                <div
                  className={clsx(
                    'px-2 flex items-center justify-between text-xs rounded-md cursor-pointer w-40 transition ease',
                    open ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-300'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {value.icon}
                    {value.name}
                  </div>

                  <FaChevronDown
                    className={clsx(
                      'transition-transform ease duration-300 text-neutral-500',
                      open ? 'rotate-180' : 'rotate-0'
                    )}
                  />
                </div>
              )}
            </Listbox.Button>
            <Listbox.Options className="bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 p-2 w-40 rounded-md shadow-2xl absolute top-8 z-10 focus:outline-none">
              {accessTemplates.map((template) => (
                <Listbox.Option value={template} key={template.name} as={Fragment}>
                  {({ active, selected }) => (
                    <div
                      className={clsx(
                        'flex items-center gap-2 px-2 py-1 cursor-pointer rounded-md text-xs',
                        active && 'bg-zinc-300 dark:bg-zinc-700',
                        selected && 'font-semibold'
                      )}
                    >
                      {template.icon}
                      {template.name}
                    </div>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </>
        )}
      </Listbox>
    </div>
  )
}
