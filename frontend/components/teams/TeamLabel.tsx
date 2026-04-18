import clsx from 'clsx'
import Link from 'next/link'
import { ComponentType } from 'react'
import { FaUsers } from 'react-icons/fa'

type Variant = 'default' | 'info'

const variantClasses: Record<Variant, string> = {
  default:
    'bg-zinc-300/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700',
  info: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 hover:bg-blue-500/25 dark:hover:bg-blue-500/25',
}

export const TeamLabel = ({
  teamId,
  teamName,
  orgSlug,
  variant = 'default',
  title,
  icon: Icon = FaUsers,
}: {
  teamId: string
  teamName: string
  orgSlug: string
  variant?: Variant
  title?: string
  icon?: ComponentType<{ className?: string }>
}) => (
  <Link
    href={`/${orgSlug}/access/teams/${teamId}`}
    title={title}
    className={clsx(
      'inline-flex items-center gap-1 text-3xs font-semibold px-1 py-0 rounded-full transition',
      variantClasses[variant]
    )}
  >
    <Icon className="text-[8px] shrink-0" />
    {teamName}
  </Link>
)
