import { Fragment, forwardRef, useContext, useImperativeHandle, useRef, useState } from 'react'
import { Tab } from '@headlessui/react'
import { useMutation } from '@apollo/client'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { FaExternalLinkAlt } from 'react-icons/fa'
import { FaCircleExclamation, FaPause, FaPlay } from 'react-icons/fa6'
import {
  ApiLogStreamHealthChoices,
  LogStreamProviderType,
  LogStreamType,
} from '@/apollo/graphql'
import { UpdateLogStreamOp } from '@/graphql/mutations/logstreams/updateLogStream.gql'
import { ToggleLogStreamOp } from '@/graphql/mutations/logstreams/toggleLogStream.gql'
import { GetLogStreams } from '@/graphql/queries/logstreams/getLogStreams.gql'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { organisationContext } from '@/contexts/organisationContext'
import { relativeTimeFromDates } from '@/utils/time'
import { DeleteLogStreamDialog } from './DeleteLogStreamDialog'
import { LogStreamDeliveryHistory } from './LogStreamDeliveryHistory'
import { LogStreamForm, LogStreamFormValues } from './LogStreamForm'
import { LogStreamStatusIndicator } from './LogStreamStatusIndicator'
import { parseStreamOptions } from './utils'

export type ManageLogStreamDialogHandle = {
  openSettings: () => void
  openHistory: (statusFilter?: string) => void
}

export const ManageLogStreamDialog = forwardRef<
  ManageLogStreamDialogHandle,
  {
    stream: LogStreamType
    userCanUpdate: boolean
    userCanDelete: boolean
  }
>((props, ref) => {
  const { stream, userCanUpdate, userCanDelete } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const [tabIndex, setTabIndex] = useState(0)
  const [historyFilter, setHistoryFilter] = useState<string | undefined>(undefined)

  useImperativeHandle(ref, () => ({
    openSettings: () => {
      setTabIndex(0)
      dialogRef.current?.openModal()
    },
    openHistory: (statusFilter?: string) => {
      setHistoryFilter(statusFilter)
      setTabIndex(1)
      dialogRef.current?.openModal()
    },
  }))

  const closeModal = () => dialogRef.current?.closeModal()

  const refetchStreams = [
    { query: GetLogStreams, variables: { organisationId: organisation?.id } },
  ]

  const [updateLogStream, { loading: updating }] = useMutation(UpdateLogStreamOp)
  const [toggleLogStream, { loading: toggling }] = useMutation(ToggleLogStreamOp)

  const handleUpdate = async (
    values: LogStreamFormValues,
    _provider: LogStreamProviderType
  ) => {
    try {
      await updateLogStream({
        variables: {
          streamId: stream.id,
          name: values.name,
          credentialId: values.credential!.id,
          sources: values.sources,
          service: values.service,
          tags: values.tags,
          gzip: values.gzip,
          maxAttempts: values.maxAttempts,
        },
        refetchQueries: refetchStreams,
      })
      toast.success('Log Stream updated')
    } catch (error: any) {
      toast.error(error.message || 'Could not update the Log Stream')
    }
  }

  const handleToggle = async () => {
    try {
      await toggleLogStream({
        variables: { streamId: stream.id },
        refetchQueries: refetchStreams,
      })
      toast.success(stream.isActive ? 'Log Stream paused' : 'Log Stream resumed')
    } catch (error: any) {
      toast.error(error.message || 'Could not update the Log Stream')
    }
  }

  const streamOptions = parseStreamOptions(stream.options)

  const initialFormValues: LogStreamFormValues = {
    name: stream.name,
    credential: stream.authentication ?? null,
    sources: (stream.sources as string[]) ?? [],
    service: streamOptions.service ?? 'phase-console',
    tags: streamOptions.tags ?? '',
    gzip: streamOptions.gzip ?? true,
    maxAttempts: stream.maxAttempts,
  }

  const dialogTitle = (
    <div className="w-full">
      <h3 className="text-base font-semibold leading-6 text-zinc-900 dark:text-zinc-100">
        {stream.name}
      </h3>
      {stream.providerInfo && (
        <div className="flex items-center gap-2 text-sm text-neutral-500 pt-1 min-w-0">
          <ProviderIcon providerId={stream.providerInfo.id} />
          <span className="truncate">
            Stream logs to{' '}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {stream.providerInfo.name}
            </span>
          </span>
          {stream.destinationUrl && (
            <a
              href={stream.destinationUrl}
              target="_blank"
              rel="noreferrer"
              title={`View the shipped logs in ${stream.providerInfo.name}`}
              className="text-neutral-500 hover:text-emerald-500 transition ease shrink-0"
            >
              <FaExternalLinkAlt className="text-xs" />
            </a>
          )}
        </div>
      )}
    </div>
  )

  const statusSection = (
    <div className="space-y-2">
      <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">Status</div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-neutral-500/40 bg-zinc-100 dark:bg-zinc-800 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <LogStreamStatusIndicator stream={stream} />
          <span className="text-xs text-neutral-500 whitespace-nowrap">
            Last shipped:{' '}
            {stream.lastShippedAt
              ? relativeTimeFromDates(new Date(stream.lastShippedAt))
              : 'never'}
          </span>
        </div>
        {userCanUpdate && (
          <Button
            type="button"
            variant="secondary"
            onClick={handleToggle}
            isLoading={toggling}
            icon={stream.isActive ? FaPause : FaPlay}
            title={
              stream.isActive
                ? 'Pause streaming — resuming continues from where it left off'
                : 'Resume streaming from the stored cursor'
            }
          >
            {stream.isActive ? 'Pause' : 'Resume'}
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <GenericDialog ref={dialogRef} title={stream.name} dialogTitle={dialogTitle} size="lg">
      <div className="pt-2 space-y-4">
        {!stream.isActive && stream.pausedReason === 'auth_error' && (
          <Alert variant="danger" size="sm" icon>
            This stream was paused because the destination rejected the configured credentials.
            Update the credentials and resume the stream.
          </Alert>
        )}

        {!stream.isActive && stream.pausedReason === 'credentials_missing' && (
          <Alert variant="danger" size="sm" icon>
            This stream was paused because its third-party credentials were deleted. Select new
            credentials, save, and resume the stream.
          </Alert>
        )}

        {stream.health === ApiLogStreamHealthChoices.Degraded && stream.lastFailureReason && (
          <div className="text-xs text-red-500 border border-red-500/30 bg-red-400/10 rounded p-3">
            <div className="font-semibold mb-1 flex items-center gap-1">
              <FaCircleExclamation /> Last failure
            </div>
            <div className="break-all">{stream.lastFailureReason}</div>
            {stream.lastFailureAt && (
              <div className="text-2xs text-neutral-500 mt-1">
                {relativeTimeFromDates(new Date(stream.lastFailureAt))}
              </div>
            )}
          </div>
        )}

        <Tab.Group selectedIndex={tabIndex} onChange={setTabIndex}>
          <Tab.List className="flex gap-2 w-full border-b border-neutral-500/20">
            {['Configuration', 'Events'].map((tab) => (
              <Tab as={Fragment} key={tab}>
                {({ selected }) => (
                  <div
                    className={clsx(
                      'p-2 text-xs font-medium border-b focus:outline-none cursor-pointer text-black dark:text-white',
                      selected ? 'border-emerald-500 font-semibold' : 'border-transparent'
                    )}
                  >
                    {tab}
                  </div>
                )}
              </Tab>
            ))}
          </Tab.List>
          <Tab.Panels className="pt-4">
            <Tab.Panel className="space-y-4 text-sm">
              {statusSection}

              {userCanUpdate ? (
                stream.providerInfo && (
                  <LogStreamForm
                    provider={stream.providerInfo}
                    initialValues={initialFormValues}
                    submitLabel="Save"
                    submitting={updating}
                    onSubmit={handleUpdate}
                    sourceLags={stream.sourceLags}
                    footerActions={
                      userCanDelete ? (
                        <DeleteLogStreamDialog stream={stream} onDeleted={closeModal} />
                      ) : undefined
                    }
                  />
                )
              ) : (
                <div className="py-4 space-y-4">
                  <div className="text-sm text-neutral-500">
                    You don&apos;t have permission to edit this Log Stream.
                  </div>
                  {/* Delete is a separate permission — a role can hold it without update. */}
                  {userCanDelete && (
                    <DeleteLogStreamDialog stream={stream} onDeleted={closeModal} />
                  )}
                </div>
              )}
            </Tab.Panel>
            <Tab.Panel className="space-y-4 text-sm">
              <LogStreamDeliveryHistory
                stream={stream}
                userCanRetry={userCanUpdate}
                initialStatusFilter={historyFilter}
              />
            </Tab.Panel>
          </Tab.Panels>
        </Tab.Group>
      </div>
    </GenericDialog>
  )
})

ManageLogStreamDialog.displayName = 'ManageLogStreamDialog'
