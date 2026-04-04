'use client'

import React, { useContext } from 'react'
import { FaKey } from 'react-icons/fa'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus, coldarkCold } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { ThemeContext } from '@/contexts/themeContext'
import CopyButton from '@/components/common/CopyButton'
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
  const { theme } = useContext(ThemeContext)

  if (!data) return null
  const parsed = typeof data === 'string' ? JSON.parse(data) : data
  const formatted = JSON.stringify(parsed, null, 2)

  return (
    <div className="relative group/json mt-1">
      <div className="absolute right-2 top-2 opacity-0 group-hover/json:opacity-100 transition-opacity z-10">
        <CopyButton value={formatted} buttonVariant="secondary" />
      </div>
      <SyntaxHighlighter
        language="json"
        style={theme === 'dark' ? vscDarkPlus : coldarkCold}
        customStyle={{
          fontSize: '0.65rem',
          fontFamily: 'var(--font-jetbrains-mono)',
          lineHeight: '1.5',
          margin: 0,
          borderRadius: '0.375rem',
          maxHeight: '16rem',
          overflow: 'auto',
          background: theme === 'dark' ? '#171717' : '#e4e4e7',
        }}
        codeTagProps={{
          style: {
            fontSize: '0.65rem',
            fontFamily: 'var(--font-jetbrains-mono)',
          },
        }}
      >
        {formatted}
      </SyntaxHighlighter>
    </div>
  )
}
