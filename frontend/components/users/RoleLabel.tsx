import { RoleType } from '@/apollo/graphql'
import { userHasGlobalAccess } from '@/utils/access/permissions'
import { getContrastingTextColor, stringToHexColor } from '@/utils/copy'
import clsx from 'clsx'

export const RoleLabel = ({ role, size }: { role: RoleType; size?: 'sm' | 'md' | 'lg' }) => {
  const sizeStyles = {
    sm: 'text-2xs px-1',
    md: 'text-sm px-2 py-0.5',
    lg: 'text-base px-2 py-0.5',
  }

  const roleStyle = () => {
    if (role.name!.toLowerCase() === 'admin')
      return 'ring-emerald-400/10 bg-emerald-400 text-black dark:bg-zinc-800 dark:text-emerald-400'
    else if (role.name!.toLowerCase() === 'owner')
      return 'ring-amber-400/10 bg-amber-400 text-black dark:bg-zinc-800 dark:text-amber-400'
    else if (role.name!.toLowerCase() === 'manager')
      return 'ring-cyan-500/40 bg-cyan-500/40 text-black dark:bg-zinc-800 dark:text-cyan-300'
    else if (role.name!.toLowerCase() === 'developer')
      return 'ring-neutral-500/40 bg-neutral-500/40 text-black dark:bg-zinc-800 dark:text-neutral-300'
    else if (role.name!.toLowerCase() === 'service')
      return 'ring-purple-500/40 bg-purple-500/40 text-black dark:bg-zinc-800 dark:text-purple-300'
    else return ''
  }

  const roleHasGlobalAccess = userHasGlobalAccess(role.permissions)

  const roleDescription = `${role.description} ${roleHasGlobalAccess ? 'This role grants global access to all apps and environments' : ''}`

  return (
    <span
      className={clsx(
        ' rounded-md ring-1 ring-inset  uppercase font-medium tracking-wide',
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
      title={roleDescription}
    >
      {role.name}
    </span>
  )
}
