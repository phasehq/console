import { Fragment, forwardRef, useContext, useImperativeHandle, useState } from 'react'
import { Dialog, Tab, Transition } from '@headlessui/react'
import { useMutation } from '@apollo/client'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { FaExternalLinkAlt, FaPause, FaPlay, FaTimes } from 'react-icons/fa'
import {
  ApiLogStreamHealthChoices,
  LogStreamProviderType,
  LogStreamType,
} from '@/apollo/graphql'
import { UpdateLogStreamOp } from '@/graphql/mutations/logstreams/updateLogStream.gql'
import { ToggleLogStreamOp } from '@/graphql/mutations/logstreams/toggleLogStream.gql'
import { GetLogStreams } from '@/graphql/queries/logstreams/getLogStreams.gql'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { organisationContext } from '@/contexts/organisationContext'
import { relativeTimeFromDates } from '@/utils/time'
import { DeleteLogStreamDialog } from './DeleteLogStreamDialog'
import { LogStreamDeliveryHistory } from './LogStreamDeliveryHistory'
import { LogStreamForm, LogStreamFormValues } from './LogStreamForm'
import { LogStreamStatusIndicator } from './LogStreamStatusIndicator'
import { humanizeLag, lagIsCritical, parseStreamOptions } from './utils'

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

  const [isOpen, setIsOpen] = useState(false)
  const [tabIndex, setTabIndex] = useState(0)
  const [historyFilter, setHistoryFilter] = useState<string | undefined>(undefined)

  useImperativeHandle(ref, () => ({
    openSettings: () => {
      setTabIndex(0)
      setIsOpen(true)
    },
    openHistory: (statusFilter?: string) => {
      setHistoryFilter(statusFilter)
      setTabIndex(1)
      setIsOpen(true)
    },
  }))

  const closeModal = () => setIsOpen(false)

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

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={closeModal}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25 backdrop-blur-md" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-3xl transform rounded-2xl bg-zinc-100 dark:bg-zinc-900 p-6 text-left align-middle shadow-xl transition-all">
                <Dialog.Title as="div" className="flex w-full justify-between items-start gap-4">
                  <div>
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white">
                      {stream.name}
                    </h3>
                    {stream.providerInfo && (
                      <div className="flex items-center gap-2 text-sm text-neutral-500 pt-1">
                        <ProviderIcon providerId={stream.providerInfo.id} />
                        <span>
                          Stream logs to{' '}
                          <span className="font-semibold text-black dark:text-white">
                            {stream.providerInfo.name}
                          </span>
                        </span>
                        {stream.destinationUrl && (
                          <a
                            href={stream.destinationUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={`View the shipped logs in ${stream.providerInfo.name}`}
                            className="text-neutral-500 hover:text-emerald-500 transition ease"
                          >
                            <FaExternalLinkAlt className="text-xs" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-3 text-sm">
                        <LogStreamStatusIndicator stream={stream} />
                        {userCanUpdate && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={handleToggle}
                            isLoading={toggling}
                            title={
                              stream.isActive
                                ? 'Pause streaming — resuming continues from where it left off'
                                : 'Resume streaming from the stored cursor'
                            }
                          >
                            {stream.isActive ? (
                              <>
                                <FaPause /> Pause
                              </>
                            ) : (
                              <>
                                <FaPlay /> Resume
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                      <div className="text-xs text-neutral-500">
                        Last shipped:{' '}
                        {stream.lastShippedAt
                          ? relativeTimeFromDates(new Date(stream.lastShippedAt))
                          : 'never'}
                      </div>
                    </div>
                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </div>
                </Dialog.Title>

                <div className="py-4 space-y-4">
                  {!stream.isActive && stream.pausedReason === 'auth_error' && (
                    <Alert variant="danger" size="sm" icon>
                      This stream was paused because the destination rejected the configured
                      credentials. Update the credentials and resume the stream.
                    </Alert>
                  )}

                  {!stream.isActive && stream.pausedReason === 'credentials_missing' && (
                    <Alert variant="danger" size="sm" icon>
                      This stream was paused because its third-party credentials were deleted.
                      Select new credentials, save, and resume the stream.
                    </Alert>
                  )}

                  {stream.health === ApiLogStreamHealthChoices.Degraded &&
                    stream.lastFailureReason && (
                      <Alert variant="warning" size="sm" icon>
                        Last failure: {stream.lastFailureReason}
                      </Alert>
                    )}

                  <Tab.Group selectedIndex={tabIndex} onChange={setTabIndex}>
                    <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20">
                      {['Configuration', 'Events'].map((tab) => (
                        <Tab as={Fragment} key={tab}>
                          {({ selected }) => (
                            <button
                              type="button"
                              className={clsx(
                                'p-3 font-medium border-b focus:outline-none text-black dark:text-white',
                                selected
                                  ? 'border-emerald-500 font-semibold'
                                  : 'border-transparent cursor-pointer'
                              )}
                            >
                              {tab}
                            </button>
                          )}
                        </Tab>
                      ))}
                    </Tab.List>
                    <Tab.Panels>
                      <Tab.Panel>
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
                                  <DeleteLogStreamDialog
                                    stream={stream}
                                    onDeleted={closeModal}
                                  />
                                ) : undefined
                              }
                            />
                          )
                        ) : (
                          <div className="py-8 space-y-6 text-center">
                            <div className="text-sm text-neutral-500">
                              You don&apos;t have permission to edit this Log Stream.
                            </div>
                            {/* Delete is a separate permission — a role can
                                hold it without update. */}
                            {userCanDelete && (
                              <div className="flex justify-center">
                                <DeleteLogStreamDialog stream={stream} onDeleted={closeModal} />
                              </div>
                            )}
                          </div>
                        )}
                      </Tab.Panel>
                      <Tab.Panel>
                        <LogStreamDeliveryHistory
                          stream={stream}
                          userCanRetry={userCanUpdate}
                          initialStatusFilter={historyFilter}
                        />
                      </Tab.Panel>
                    </Tab.Panels>
                  </Tab.Group>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
})

ManageLogStreamDialog.displayName = 'ManageLogStreamDialog'
