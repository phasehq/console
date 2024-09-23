import { RoleType } from '@/apollo/graphql'
import { getContrastingTextColor, stringToHexColor } from '@/utils/copy'
import clsx from 'clsx'

export const RoleLabel = ({ role, size }: { role: RoleType; size?: 'sm' | 'md' | 'lg' }) => {
  const sizeStyles = {
    sm: 'text-2xs',
    md: 'text-sm',
    lg: 'text-base',
  }

  const roleStyle = () => {
    if (role.name!.toLowerCase() === 'admin')
      return 'ring-emerald-400/10 bg-emerald-400 text-black dark:bg-zinc-800 dark:text-emerald-400'
    else if (role.name!.toLowerCase() === 'owner')
      return 'ring-amber-400/10 bg-amber-400 text-black dark:bg-zinc-800 dark:text-amber-400'
    else if (role.name!.toLowerCase() === 'developer')
      return 'ring-neutral-500/40 bg-neutral-500/40 text-black dark:bg-zinc-800 dark:text-neutral-300'
    else return ''
  }

  return (
    <span
      className={clsx(
        'px-2 py-0.5 rounded-md ring-1 ring-inset  uppercase font-medium tracking-wide',
        size ? sizeStyles[size] : sizeStyles['sm'],
        roleStyle()
      )}
      style={
        roleStyle() === ''
          ? {
              backgroundColor: role.color || stringToHexColor(role.name!),
              color: getContrastingTextColor(role.color || stringToHexColor(role.name!)),
            }
          : {}
      }
      title={role.description || undefined}
    >
      {role.name}
    </span>
  )
}
