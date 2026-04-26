'use client'

import clsx from 'clsx'
import { relativeTimeFromDates } from '@/utils/time'
import { ProfileCard } from '@/components/common/ProfileCard'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { ProviderLogo } from './shared'
import { DeleteSCIMTokenDialog } from './SCIMTokenDialogs'

export function SCIMTokensTable({
  tokens,
  organisationId,
  userCanManageSCIM,
  onToggleToken,
}: {
  tokens: any[]
  organisationId: string
  userCanManageSCIM: boolean
  onToggleToken: (tokenId: string, currentActive: boolean) => void
}) {
  return (
    <table className="table-auto min-w-full divide-y divide-zinc-500/40">
      <thead>
        <tr>
          <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Provider
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Created
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Expires
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Last Used
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Active
          </th>
          <th className="px-6 py-3"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-500/20">
        {tokens.map((token: any) => (
          <tr key={token.id} className="group">
            <td className="py-2">
              <div className="flex items-center gap-3">
                <ProviderLogo name={token.name} />
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    {token.name}
                    {!token.isActive && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium bg-neutral-500/10 text-neutral-500 ring-1 ring-inset ring-neutral-500/20">
                        Disabled
                      </span>
                    )}
                  </div>
                  <code className="text-2xs text-neutral-500 font-mono">{token.id}</code>
                </div>
              </div>
            </td>
            <td className="px-6 py-2">
              <div className="space-y-1">
                <div className="text-2xs text-neutral-500">
                  {relativeTimeFromDates(new Date(token.createdAt))}
                  {token.createdBy && ' by'}
                </div>
                {token.createdBy && (
                  <ProfileCard
                    user={{
                      name: token.createdBy.fullName,
                      email: token.createdBy.email,
                      image: token.createdBy.avatarUrl,
                    }}
                    size="sm"
                  />
                )}
              </div>
            </td>
            <td className="px-6 py-2 text-sm">
              {token.expiresAt ? (
                <span
                  className={clsx(
                    'text-2xs',
                    new Date(token.expiresAt) < new Date() ? 'text-red-400' : 'text-neutral-500'
                  )}
                >
                  {new Date(token.expiresAt) < new Date()
                    ? 'Expired'
                    : relativeTimeFromDates(new Date(token.expiresAt))}
                </span>
              ) : (
                <span className="text-2xs text-neutral-500">Never</span>
              )}
            </td>
            <td className="px-6 py-2">
              <span className="text-2xs text-neutral-500">
                {token.lastUsedAt
                  ? relativeTimeFromDates(new Date(token.lastUsedAt))
                  : 'Never'}
              </span>
            </td>
            <td className="px-6 py-2">
              {userCanManageSCIM && (
                <ToggleSwitch
                  value={token.isActive}
                  onToggle={() => onToggleToken(token.id, token.isActive)}
                  size="sm"
                />
              )}
            </td>
            <td className="px-6 py-2 text-right">
              {userCanManageSCIM && (
                <div className="opacity-0 group-hover:opacity-100 transition ease">
                  <DeleteSCIMTokenDialog
                    tokenId={token.id}
                    tokenName={token.name}
                    organisationId={organisationId}
                  />
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
