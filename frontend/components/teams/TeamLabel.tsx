import Link from 'next/link'
import { FaUsers } from 'react-icons/fa'

export const TeamLabel = ({
  teamId,
  teamName,
  orgSlug,
}: {
  teamId: string
  teamName: string
  orgSlug: string
}) => (
  <Link
    href={`/${orgSlug}/access/teams/${teamId}`}
    className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-300/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition"
  >
    <FaUsers className="text-[9px] shrink-0" />
    {teamName}
  </Link>
)
