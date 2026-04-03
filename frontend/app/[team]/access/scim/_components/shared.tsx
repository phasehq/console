'use client'

import React from 'react'
import { FaKey } from 'react-icons/fa'
import { EntraIDLogo, OktaLogo, JumpCloudLogo } from '@/components/common/logos'

export const PROVIDER_PATTERNS: {
  keywords: string[]
  logo: React.FC<{ className?: string }>
  label: string
}[] = [
  { keywords: ['entra', 'azure', 'microsoft'], logo: EntraIDLogo, label: 'Microsoft Entra ID' },
  { keywords: ['okta'], logo: OktaLogo, label: 'Okta' },
  { keywords: ['jumpcloud'], logo: JumpCloudLogo, label: 'JumpCloud' },
]

const logoSizeMap = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
}

export function getProviderIcon(name: string): React.FC<{ className?: string }> {
  const lower = name.toLowerCase()
  const match = PROVIDER_PATTERNS.find((p) => p.keywords.some((k) => lower.includes(k)))
  return match ? match.logo : FaKey
}

export function ProviderLogo({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const lower = name.toLowerCase()
  const match = PROVIDER_PATTERNS.find((p) => p.keywords.some((k) => lower.includes(k)))
  const sizeClass = logoSizeMap[size]
  if (match) {
    const Logo = match.logo
    return <Logo className={`${sizeClass} shrink-0`} />
  }
  return <FaKey className={`${sizeClass} text-neutral-400 shrink-0`} />
}

export const EXPIRY_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: 'No expiration', value: null },
]

export const EVENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  USER_CREATED: {
    label: 'User Created',
    color: 'text-emerald-500 bg-emerald-500/10 ring-emerald-500/20',
  },
  USER_UPDATED: { label: 'User Updated', color: 'text-blue-500 bg-blue-500/10 ring-blue-500/20' },
  USER_DEACTIVATED: {
    label: 'User Deactivated',
    color: 'text-red-500 bg-red-500/10 ring-red-500/20',
  },
  USER_REACTIVATED: {
    label: 'User Reactivated',
    color: 'text-emerald-500 bg-emerald-500/10 ring-emerald-500/20',
  },
  GROUP_CREATED: {
    label: 'Group Created',
    color: 'text-emerald-500 bg-emerald-500/10 ring-emerald-500/20',
  },
  GROUP_UPDATED: {
    label: 'Group Updated',
    color: 'text-blue-500 bg-blue-500/10 ring-blue-500/20',
  },
  GROUP_DELETED: {
    label: 'Group Deleted',
    color: 'text-red-500 bg-red-500/10 ring-red-500/20',
  },
  MEMBER_ADDED: {
    label: 'Member Added',
    color: 'text-emerald-500 bg-emerald-500/10 ring-emerald-500/20',
  },
  MEMBER_REMOVED: {
    label: 'Member Removed',
    color: 'text-red-500 bg-red-500/10 ring-red-500/20',
  },
}

export function LogField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-neutral-500 font-medium">{label}: </span>
      <span className="font-medium font-mono">{children}</span>
    </div>
  )
}

export function JsonBlock({ data }: { data: any }) {
  if (!data) return null
  const parsed = typeof data === 'string' ? JSON.parse(data) : data
  return (
    <pre className="mt-1 text-2xs font-mono bg-zinc-100 dark:bg-zinc-900 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-200">
      {JSON.stringify(parsed, null, 2)}
    </pre>
  )
}
