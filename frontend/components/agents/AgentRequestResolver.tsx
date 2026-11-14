import { OrganisationMemberType } from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'

type Resolver = {
  fullName?: string | null
  email?: string | null
} | null

const resolverName = (member: NonNullable<Resolver>) =>
  member.fullName || member.email || 'Unknown member'

/**
 * The member who approved or denied a request: avatar and name, cut short
 * with an ellipsis so a long name cannot widen the row. `detailed` adds the
 * email beneath the name. A member since removed shows nothing.
 */
export function AgentRequestResolver({
  member,
  detailed = false,
  className,
}: {
  member?: Resolver
  detailed?: boolean
  className?: string
}) {
  if (!member) return null
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className ?? ''}`.trim()}>
      <Avatar member={member as OrganisationMemberType} size="sm" showTitle={false} />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {resolverName(member)}
        </span>
        {detailed && member.fullName && member.email && (
          <span className="block truncate text-2xs text-neutral-500">{member.email}</span>
        )}
      </span>
    </span>
  )
}
