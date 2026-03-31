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
      <div className="flex items-center gap-2">
        <Avatar serviceAccount={serviceAccount} size={avatarSizeMap[size]} />
        <div>
          <div className={`${textStyles.name} font-medium text-zinc-900 dark:text-zinc-100`}>
            {serviceAccount.name}
          </div>
          <div className={`${textStyles.subtitle} text-neutral-500 font-mono`}>
            {subtitle || serviceAccount.id}
          </div>
        </div>
      </div>
    )
  }

  if (member) {
    const displayName = member.fullName || member.email
    return (
      <div className="flex items-center gap-2">
        <Avatar member={member} size={avatarSizeMap[size]} />
        <div>
          <div className={`${textStyles.name} font-medium text-zinc-900 dark:text-zinc-100`}>
            {displayName}
          </div>
          {member.fullName && (
            <div className={`${textStyles.subtitle} text-neutral-500`}>{member.email}</div>
          )}
        </div>
      </div>
    )
  }

  if (user) {
    const displayName = user.name || user.email
    return (
      <div className="flex items-center gap-2">
        <Avatar
          user={{
            name: user.name,
            email: user.email,
            image: user.image,
          }}
          size={avatarSizeMap[size]}
        />
        <div>
          <div className={`${textStyles.name} font-medium text-zinc-900 dark:text-zinc-100`}>
            {displayName}
          </div>
          {user.name && user.email && (
            <div className={`${textStyles.subtitle} text-neutral-500`}>{user.email}</div>
          )}
        </div>
      </div>
    )
  }

  return null
}
