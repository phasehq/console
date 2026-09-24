import { RoleType } from '@/apollo/graphql'
import { RoleLabel } from '../users/RoleLabel'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment } from 'react'
import { FaExclamationTriangle, FaLock } from 'react-icons/fa'

const CEILING_REASON =
  'This role includes permissions your own role does not, so you cannot assign it'

/**
 * Listbox option for role pickers, rendered disabled with an explanation
 * when the role exceeds the viewer's grant ceiling, or when the caller
 * supplies another reason the role can't be assigned right now.
 */
export const AssignableRoleOption = ({
  option,
  assignable,
  disabled = false,
  disabledReason,
}: {
  option: RoleType
  assignable: boolean
  disabled?: boolean
  disabledReason?: string
}) => {
  const selectable = assignable && !disabled

  let title: string | undefined
  if (!assignable) title = CEILING_REASON
  else if (disabled) title = disabledReason

  return (
    <Listbox.Option value={option} as={Fragment} disabled={!selectable}>
      {({ active }) => (
        <div
          className={clsx(
            'flex items-center justify-between gap-4 p-2 rounded-full',
            selectable ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed',
            active && selectable && 'bg-zinc-300 dark:bg-zinc-700'
          )}
          title={title}
        >
          <RoleLabel role={option} />
          {!assignable && (
            <span className="flex items-center gap-1 text-2xs whitespace-nowrap text-neutral-500">
              <FaLock /> Exceeds your permissions
            </span>
          )}
          {assignable && disabled && (
            <FaExclamationTriangle className="text-amber-500 text-xs shrink-0" />
          )}
        </div>
      )}
    </Listbox.Option>
  )
}
