import clsx from 'clsx'

export const RoleLabel = (props: { role: string }) => {
  const role = props.role.toLowerCase()

  const roleStyle = () => {
    if (role === 'developer')
      return 'ring-neutral-500/40 bg-neutral-500/40 text-black dark:bg-zinc-800 dark:text-neutral-500'
    if (role === 'admin')
      return 'ring-emerald-400/10 bg-emerald-400 text-black dark:bg-zinc-800 dark:text-emerald-400'
    if (role === 'owner')
      return 'ring-amber-400/10 bg-amber-400 text-black dark:bg-zinc-800 dark:text-amber-400'
  }

  return (
    <span
      className={clsx(
        'px-2 py-0.5 rounded-full ring-1 ring-inset uppercase text-2xs font-medium tracking-wide',
        roleStyle()
      )}
    >
      {role}
    </span>
  )
}
