import { RoleType } from '@/apollo/graphql'
import clsx from 'clsx'

export const RoleLabel = ({ role }: { role: RoleType }) => {
  const roleStyle = () => {
    if (role.name!.toLowerCase() === 'admin')
      return 'ring-emerald-400/10 bg-emerald-400 text-black dark:bg-zinc-800 dark:text-emerald-400'
    else if (role.name!.toLowerCase() === 'owner')
      return 'ring-amber-400/10 bg-amber-400 text-black dark:bg-zinc-800 dark:text-amber-400'
    else
      return 'ring-neutral-500/40 bg-neutral-500/40 text-black dark:bg-zinc-800 dark:text-neutral-500'
  }

  return (
    <span
      className={clsx(
        'px-2 py-0.5 rounded-full ring-1 ring-inset uppercase text-2xs font-medium tracking-wide',
        roleStyle()
      )}
    >
      {role.name}
    </span>
  )
}
