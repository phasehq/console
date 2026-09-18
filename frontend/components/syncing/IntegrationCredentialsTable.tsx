'use client'

import clsx from 'clsx'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { FaChevronDown, FaSearch, FaTimesCircle } from 'react-icons/fa'
import { Button } from '@/components/common/Button'
import { relativeTimeFromDates } from '@/utils/time'
import {
  groupIntegrationCredentials,
  integrationMatchesSearch,
  canonicalIntegrationId,
  type IntegrationCredentialSummary,
} from '@/utils/integrationCredentials'
import { ProviderIcon } from './ProviderIcon'
import { DeleteProviderCredentialDialog } from './DeleteProviderCredentialDialog'
import { ProviderCredentialManagerDialog } from './ProviderCredentialManager'

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`

const RelativeDate = ({ value }: { value?: string | null }) => {
  if (!value) return <span className="text-neutral-500">Not available</span>

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return <span className="text-neutral-500">Not available</span>

  return (
    <time dateTime={value} title={date.toLocaleString()} className="whitespace-nowrap">
      {relativeTimeFromDates(date)}
    </time>
  )
}

export const IntegrationCredentialsTableSkeleton = () => (
  <div
    className="overflow-x-auto rounded-xl border border-neutral-500/20"
    aria-label="Loading integrations"
  >
    <div className="h-10 border-b border-neutral-500/20 bg-neutral-500/5" />
    <div className="min-w-[860px]">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="grid grid-cols-[2fr_1fr_1.25fr_1fr_1fr_96px] gap-4 border-b border-neutral-500/20 px-4 py-4 last:border-b-0"
        >
          {[0, 1, 2, 3, 4, 5].map((column) => (
            <div
              key={column}
              className={clsx(
                'h-4 animate-pulse rounded bg-neutral-500/10 motion-reduce:animate-none',
                column === 0 ? 'w-32' : 'w-16'
              )}
            />
          ))}
        </div>
      ))}
    </div>
  </div>
)

export const IntegrationCredentialsTable = ({
  credentials,
  organisationId,
  canEdit,
  canDelete,
  onChanged,
  initialProviderId,
  highlightedCredentialId,
}: {
  credentials: IntegrationCredentialSummary[]
  organisationId: string
  canEdit: boolean
  canDelete: boolean
  onChanged: () => void | Promise<unknown>
  initialProviderId?: string | null
  highlightedCredentialId?: string | null
}) => {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initialProviderId ? [canonicalIntegrationId(initialProviderId)] : [])
  )
  const handledHighlight = useRef<string | null>(null)
  const groups = useMemo(
    () =>
      groupIntegrationCredentials(credentials).filter((group) =>
        integrationMatchesSearch(group, search)
      ),
    [credentials, search]
  )

  useEffect(() => {
    if (!highlightedCredentialId) {
      handledHighlight.current = null
      return
    }
    if (handledHighlight.current === highlightedCredentialId) return

    const credential = credentials.find((candidate) => candidate.id === highlightedCredentialId)
    const groupId = credential
      ? canonicalIntegrationId(credential.provider?.id)
      : initialProviderId
        ? canonicalIntegrationId(initialProviderId)
        : null
    if (!groupId) return
    handledHighlight.current = highlightedCredentialId

    setExpanded((current) => {
      if (current.has(groupId)) return current
      return new Set(current).add(groupId)
    })
  }, [credentials, highlightedCredentialId, initialProviderId])

  useEffect(() => {
    if (!highlightedCredentialId) return

    document
      .getElementById(`integration-credential-${highlightedCredentialId}`)
      ?.scrollIntoView?.({ block: 'center' })
  }, [expanded, highlightedCredentialId])

  const toggleGroup = (groupId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex w-full items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm ring-1 ring-inset ring-neutral-500/30 focus-within:ring-emerald-500 dark:bg-zinc-800 sm:max-w-sm">
          <FaSearch aria-hidden="true" className="shrink-0 text-neutral-500" />
          <span className="sr-only">Search integrations</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search integrations or credentials"
            className="custom min-w-0 flex-1 bg-transparent text-zinc-900 placeholder:text-neutral-500 dark:text-zinc-100"
          />
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setSearch('')}
            className={clsx(
              'text-neutral-500 transition-opacity hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:text-zinc-100',
              search ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
          >
            <FaTimesCircle />
          </button>
        </label>
        <p className="text-xs text-neutral-500" aria-live="polite">
          {plural(groups.length, 'connected integration')}
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-500/30 px-4 py-10 text-center">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            No matching integrations
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Try another integration or credential name.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-500/20">
          <table className="min-w-[860px] w-full divide-y divide-neutral-500/20 text-sm">
            <caption className="sr-only">Connected third-party integrations</caption>
            <thead className="bg-neutral-500/5 text-left text-2xs uppercase tracking-wider text-neutral-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Integration
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Credentials
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Used by
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Created
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Updated
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-500/20">
              {groups.map((group) => {
                const isExpanded = expanded.has(group.id)
                const detailsId = `integration-${group.id}-credentials`
                return (
                  <Fragment key={group.id}>
                    <tr className="group align-top hover:bg-neutral-500/[0.035]">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-500/10 text-lg">
                            <ProviderIcon providerId={group.id} />
                          </span>
                          <div>
                            <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {group.name}
                            </p>
                            <p className="mt-0.5 text-2xs text-neutral-500">Third-party service</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                          {group.credentialCount}
                        </span>
                        <p className="mt-0.5 max-w-48 truncate text-2xs text-neutral-500">
                          {group.credentials.map((credential) => credential.name).join(', ')}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <span className="whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-400">
                          Used by {plural(group.usageCount, 'integration')}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs text-neutral-600 dark:text-neutral-400">
                        <RelativeDate value={group.createdAt} />
                      </td>
                      <td className="px-4 py-4 text-xs text-neutral-600 dark:text-neutral-400">
                        <RelativeDate value={group.updatedAt} />
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Button
                          type="button"
                          variant="secondary"
                          aria-expanded={isExpanded}
                          aria-controls={detailsId}
                          onClick={() => toggleGroup(group.id)}
                        >
                          {isExpanded ? 'Hide credentials' : 'View credentials'}
                          <FaChevronDown
                            aria-hidden="true"
                            className={clsx('transition-transform', isExpanded && 'rotate-180')}
                          />
                        </Button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr id={detailsId}>
                        <td colSpan={6} className="bg-neutral-500/[0.025] px-4 py-3">
                          <ul aria-label={`${group.name} credentials`} className="space-y-2">
                            {group.credentials.map((credential) => (
                              <li
                                key={credential.id}
                                id={`integration-credential-${credential.id}`}
                                aria-current={
                                  credential.id === highlightedCredentialId ? 'true' : undefined
                                }
                                className={clsx(
                                  'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border bg-neutral-100 px-3 py-3 transition-colors dark:bg-neutral-900',
                                  credential.id === highlightedCredentialId
                                    ? 'border-emerald-500/60 bg-emerald-500/[0.055] ring-1 ring-emerald-500/30 dark:bg-emerald-500/[0.08]'
                                    : 'border-neutral-500/20'
                                )}
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                    {credential.name}
                                  </p>
                                  <p className="mt-0.5 text-2xs text-neutral-500">
                                    {credential.provider?.name || group.name}
                                  </p>
                                </div>
                                <p className="text-xs text-neutral-500">
                                  Updated{' '}
                                  <RelativeDate
                                    value={credential.updatedAt ?? credential.createdAt}
                                  />
                                </p>
                                {canEdit ? (
                                  <ProviderCredentialManagerDialog
                                    credential={credential}
                                    onChanged={onChanged}
                                  />
                                ) : canDelete ? (
                                  <DeleteProviderCredentialDialog
                                    credential={credential}
                                    orgId={organisationId}
                                    onDeleted={onChanged}
                                  />
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
