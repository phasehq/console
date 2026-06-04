'use client'

import { OrganisationMemberType, ServiceAccountType } from '@/apollo/graphql'
import { Avatar } from './Avatar'

type ProfileCardSize = 'sm' | 'md' | 'lg'

const avatarSizeMap: Record<ProfileCardSize, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
}

const textSizeMap: Record<ProfileCardSize, { name: string; subtitle: string }> = {
  sm: { name: 'text-2xs', subtitle: 'text-[10px]' },
  md: { name: 'text-xs', subtitle: 'text-2xs' },
  lg: { name: 'text-sm', subtitle: 'text-xs' },
}

const MemberBadges = ({ member }: { member: OrganisationMemberType }) => (
  <>
    {member.scimManaged && (
      <span className="inline-flex items-center shrink-0 px-1 py-px rounded text-3xs font-medium bg-blue-500/10 text-blue-500 ring-1 ring-inset ring-blue-500/20">
        SCIM
      </span>
    )}
    {!member.identityKey && (
      <span className="inline-flex items-center shrink-0 px-1 py-px rounded text-3xs font-medium bg-amber-500/10 text-amber-500 ring-1 ring-inset ring-amber-500/20">
        Pending
      </span>
    )}
  </>
)

export const ProfileCard = ({
  member,
  serviceAccount,
  user,
  size = 'md',
  subtitle,
}: {
  member?: OrganisationMemberType | null
  serviceAccount?: ServiceAccountType | null
  user?: { name?: string | null; email?: string | null; image?: string | null } | null
  size?: ProfileCardSize
  subtitle?: string
}) => {
  const textStyles = textSizeMap[size]

  if (serviceAccount) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div className="shrink-0">
          <Avatar serviceAccount={serviceAccount} size={avatarSizeMap[size]} />
        </div>
        <div className="min-w-0">
          <div className={`${textStyles.name} font-medium text-zinc-900 dark:text-zinc-100 truncate`}>
            {serviceAccount.name}
          </div>
          <div className={`${textStyles.subtitle} text-neutral-500 font-mono truncate`}>
            {subtitle || serviceAccount.id}
          </div>
        </div>
      </div>
    )
  }

  if (member) {
    const displayName = member.fullName || member.email
    const hasBadges = member.scimManaged || !member.identityKey
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div className="shrink-0">
          <Avatar member={member} size={avatarSizeMap[size]} />
        </div>
        <div className="min-w-0">
          <div className={`${textStyles.name} font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5`}>
            <span className="truncate">{displayName}</span>
            {hasBadges && <MemberBadges member={member} />}
          </div>
          {member.fullName && (
            <div className={`${textStyles.subtitle} text-neutral-500 truncate`}>{member.email}</div>
          )}
        </div>
      </div>
    )
  }

  if (user) {
    const displayName = user.name || user.email
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div className="shrink-0">
          <Avatar
            user={{
              name: user.name,
              email: user.email,
              image: user.image,
            }}
            size={avatarSizeMap[size]}
          />
        </div>
        <div className="min-w-0">
          <div className={`${textStyles.name} font-medium text-zinc-900 dark:text-zinc-100 truncate`}>
            {displayName}
          </div>
          {user.name && user.email && (
            <div className={`${textStyles.subtitle} text-neutral-500 truncate`}>{user.email}</div>
          )}
        </div>
      </div>
    )
  }

  return null
}
