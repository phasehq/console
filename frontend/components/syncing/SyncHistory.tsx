import { ApiEnvironmentSyncEventStatusChoices, EnvironmentSyncEventType } from '@/apollo/graphql'
import { relativeTimeFromDates } from '@/utils/time'
import { SyncStatusIndicator } from './SyncStatusIndicator'
import { Disclosure, Transition } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { FaChevronRight, FaExternalLinkAlt } from 'react-icons/fa'
import { Button } from '../common/Button'

const FormattedJSON = (props: { jsonData: string }) => {
  const parseJSON = (jsonString: string) => {
    try {
      return JSON.parse(jsonString)
    } catch (e) {
      return jsonString // Return original string if parsing fails
    }
  }

  // Safely parse the JSON string
  const jsonData = parseJSON(props.jsonData)

  // Format the JSON (or keep the original string if it's not valid JSON)
  const formattedJSON = typeof jsonData === 'object' ? JSON.stringify(jsonData, null, 2) : jsonData

  return (
    <div className="overflow-auto p-2">
      <code className="block whitespace-pre-wrap break-words text-xs">
        <pre>{formattedJSON}</pre>
      </code>
    </div>
  )
}

const SyncLogRow = (props: { event: EnvironmentSyncEventType }) => {
  const { event } = props

  return (
    <Disclosure>
      {({ open }) => (
        <>
          <Disclosure.Button
            as="tr"
            className={clsx(
              'py-4 border-neutral-500/20 transition duration-300 ease-in-out cursor-pointer',
              open
                ? 'bg-neutral-200 dark:bg-neutral-800 border-r'
                : 'border-b hover:bg-neutral-200 dark:hover:bg-neutral-800'
            )}
          >
            <td
              className={clsx(
                'px-6 py-4 border-l-4',
                open ? 'border-l-emerald-500 ' : 'border-l-transparent'
              )}
            >
              <FaChevronRight
                className={clsx(
                  'transform transition-all duration-300',
                  open && 'rotate-90 text-emerald-500'
                )}
              />
            </td>

            <td className="whitespace-nowrap px-6 py-4">
              <div className="flex items-center gap-2">
                <SyncStatusIndicator status={event.status} showLabel />
              </div>
            </td>

            <td className="whitespace-nowrap px-6 py-4">
              <div>Created {relativeTimeFromDates(new Date(event.createdAt))}</div>
            </td>

            <td className="whitespace-nowrap px-6 py-4 font-mono">
              {event.completedAt &&
                event.status !== ApiEnvironmentSyncEventStatusChoices.InProgress && (
                  <div>Completed {relativeTimeFromDates(new Date(event.completedAt))}</div>
                )}
            </td>
          </Disclosure.Button>
          <Transition
            as="tr"
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
          >
            <td colSpan={6}>
              <Disclosure.Panel
                className={clsx(
                  'p-4 w-full space-y-6 bg-neutral-200 dark:bg-neutral-800 border-neutral-500/20',
                  open ? 'border-b border-l-2 border-l-emerald-500 border-r shadow-xl' : ''
                )}
              >
                <div className="text-sm font-mono border-b border-dashed border-neutral-500/20">
                  <span className="text-neutral-500">Event ID: </span>
                  <span className="font-semibold">{event.id}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 w-full gap-4 text-sm">
                  <div className="col-span-2">
                    <FormattedJSON jsonData={event.meta} />
                  </div>
                </div>
              </Disclosure.Panel>
            </td>
          </Transition>
        </>
      )}
    </Disclosure>
  )
}

export const SyncHistory = (props: { history: EnvironmentSyncEventType[] }) => {
  const { history } = props

  return (
    <table className="table-auto w-full text-left text-sm font-light">
      <thead className="border-b-2 font-medium border-neutral-500/20  z-10  bg-neutral-300/50 dark:bg-neutral-900/60 backdrop-blur-lg shadow-xl">
        <tr className="text-neutral-500">
          <th></th>
          <th className="px-6 py-4">Status</th>
          <th className="px-6 py-4">Created</th>
          <th className="px-6 py-4">Completed</th>
        </tr>
      </thead>
      <tbody className="h-full max-h-96 overflow-y-auto">
        {history.map((syncEvent) => (
          <SyncLogRow key={syncEvent.id} event={syncEvent} />
        ))}
      </tbody>
    </table>
  )
}
