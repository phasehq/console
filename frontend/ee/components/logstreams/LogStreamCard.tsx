import { useRef } from 'react'
import clsx from 'clsx'
import { FaCog, FaExclamationTriangle, FaExternalLinkAlt } from 'react-icons/fa'
import { LogStreamType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { relativeTimeFromDates } from '@/utils/time'
import {
  ManageLogStreamDialog,
  ManageLogStreamDialogHandle,
} from './ManageLogStreamDialog'
import { LogStreamStatusIndicator } from './LogStreamStatusIndicator'
import { SourceIcon } from './sourceMeta'
import { humanizeLag, lagIsCritical } from './utils'

export const LogStreamCard = (props: {
  stream: LogStreamType
  userCanUpdate: boolean
  userCanDelete: boolean
}) => {
  const { stream, userCanUpdate, userCanDelete } = props

  const dialogRef = useRef<ManageLogStreamDialogHandle>(null)

  return (
    <div className="flex flex-col gap-3 py-3 px-4 rounded-lg border border-neutral-500/40 bg-zinc-100 dark:bg-zinc-800 text-xs font-medium">
      {/* Top row: identity left, status + last shipped right */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <ProviderIcon providerId={stream.provider} />
          <div className="flex flex-col min-w-0">
            <span className="text-zinc-900 dark:text-zinc-100 font-medium text-sm truncate">
              {stream.name}
            </span>
            <span className="text-neutral-500 text-2xs truncate">
              {stream.providerInfo?.name}
              {stream.authentication ? ` • ${stream.authentication.name}` : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="text-neutral-500 text-2xs">
            Last shipped:{' '}
            {stream.lastShippedAt
              ? relativeTimeFromDates(new Date(stream.lastShippedAt))
              : 'never'}
          </div>
          <LogStreamStatusIndicator stream={stream} />
        </div>
      </div>

      {/* Bottom row: source chips left, actions pinned right */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {stream.sourceLags?.map((sourceLag) => (
            <span
              key={sourceLag!.source}
              className={clsx(
                'flex items-center gap-1.5 px-2 py-0.5 rounded-md ring-1 ring-inset text-2xs',
                !stream.isActive
                  ? 'bg-neutral-400/10 ring-neutral-400/20 text-neutral-500'
                  : lagIsCritical(sourceLag!.lagSeconds, stream.providerInfo?.maxEventAgeHours)
                    ? 'bg-red-400/10 ring-red-400/20 text-red-500'
                    : sourceLag!.lagSeconds >= 60
                      ? 'bg-amber-400/10 ring-amber-400/20 text-amber-500'
                      : 'bg-neutral-400/10 ring-neutral-400/20 text-neutral-500'
              )}
              title="How far this source's cursor is behind the newest events"
            >
              <SourceIcon sourceId={sourceLag!.source} className="shrink-0" />
              {sourceLag!.name}
              {stream.isActive ? `: ${humanizeLag(sourceLag!.lagSeconds)}` : ''}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
          {stream.unresolvedFailures > 0 && (
            <Button
              type="button"
              variant="warning"
              icon={FaExclamationTriangle}
              title="Deliveries that failed or were skipped — click to view and re-ship"
              onClick={() => dialogRef.current?.openHistory('unresolved')}
            >
              {stream.unresolvedFailures} out of sync
            </Button>
          )}
          {stream.authentication === null && (
            <span
              className="inline-flex items-center gap-1 whitespace-nowrap text-2xs px-1.5 py-0.5 rounded-md ring-1 ring-inset bg-amber-400/10 ring-amber-400/20 text-amber-500"
              title="Credentials missing"
            >
              <FaExclamationTriangle className="text-[8px]" /> Credentials missing
            </span>
          )}
          {stream.destinationUrl && (
            <a href={stream.destinationUrl} target="_blank" rel="noreferrer">
              <Button
                type="button"
                variant="secondary"
                icon={FaExternalLinkAlt}
                title={`Explore the shipped logs in ${stream.providerInfo?.name ?? 'the destination'}`}
              >
                Explore logs in {stream.providerInfo?.name ?? 'destination'}
              </Button>
            </a>
          )}
          <Button
            type="button"
            variant="secondary"
            icon={FaCog}
            title="Manage log stream"
            onClick={() => dialogRef.current?.openSettings()}
          >
            Manage
          </Button>
          <ManageLogStreamDialog
            ref={dialogRef}
            stream={stream}
            userCanUpdate={userCanUpdate}
            userCanDelete={userCanDelete}
          />
        </div>
      </div>
    </div>
  )
}
