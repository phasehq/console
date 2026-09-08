import clsx from 'clsx'
import { FaUserSlash } from 'react-icons/fa'

// A hard-deleted account: the actor FKs are SET_NULL and the server flags
// actorDeleted to distinguish it from engine events (see PhaseActor).
export const DeletedActor = ({ className }: { className?: string }) => (
  <span className={clsx('flex items-center gap-1.5 min-w-0 text-neutral-500', className)}>
    <FaUserSlash className="shrink-0" />
    <span className="min-w-0 truncate">Deleted account</span>
  </span>
)
