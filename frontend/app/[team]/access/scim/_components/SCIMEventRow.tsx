'use client'

import { Disclosure, Transition } from '@headlessui/react'
import { FaChevronRight } from 'react-icons/fa'
import clsx from 'clsx'
import { relativeTimeFromDates } from '@/utils/time'
import { EVENT_TYPE_LABELS, LogField, JsonBlock, ProviderLogo } from './shared'

export function SCIMEventRow({ event }: { event: any }) {
  const eventMeta = EVENT_TYPE_LABELS[event.eventType] || {
    label: event.eventType,
    color: 'text-neutral-500 bg-neutral-500/10 ring-neutral-500/20',
  }

  const isError = event.status === 'ERROR'

  return (
    <Disclosure>
      {({ open }) => (
        <>
          <Disclosure.Button
            as="tr"
            className={clsx(
              'py-4 border-neutral-500/20 transition duration-300 ease-in-out cursor-pointer',
              open
                ? 'bg-neutral-100 dark:bg-neutral-800 border-r'
                : 'border-b hover:bg-neutral-100 dark:hover:bg-neutral-800'
            )}
          >
            <td
              className={clsx(
                'px-6 py-2 border-l',
                open ? 'border-l-emerald-500' : 'border-l-transparent'
              )}
            >
              <FaChevronRight
                className={clsx(
                  'transform transition-all duration-300 text-xs',
                  open && 'rotate-90 text-emerald-500'
                )}
              />
            </td>
            <td className="whitespace-nowrap px-6 py-2 text-xs font-medium capitalize">
              {relativeTimeFromDates(new Date(event.timestamp))}
            </td>
            <td className="whitespace-nowrap px-6 py-2">
              <span
                className={clsx(
                  'text-2xs font-medium',
                  isError ? 'text-red-500' : 'text-emerald-500'
                )}
              >
                {isError ? 'Error' : 'OK'}
              </span>
            </td>
            <td className="whitespace-nowrap px-6 py-2">
              <span
                className={clsx(
                  'inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium ring-1 ring-inset',
                  eventMeta.color
                )}
              >
                {eventMeta.label}
              </span>
            </td>
            <td className="whitespace-nowrap px-6 py-2 text-xs text-neutral-500">
              {event.scimToken ? (
                <div className="flex items-center gap-1.5">
                  <ProviderLogo name={event.scimToken.name} size="sm" />
                  {event.scimToken.name}
                </div>
              ) : (
                '-'
              )}
            </td>
            <td className="whitespace-nowrap px-6 py-2 text-xs">
              <span className="text-zinc-900 dark:text-zinc-100">{event.resourceName || '-'}</span>
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
                  'p-4 w-full space-y-4 bg-neutral-100 dark:bg-neutral-800 border-neutral-500/20 border-l -ml-px',
                  open
                    ? 'border-b border-l-emerald-500 border-r shadow-xl'
                    : 'border-l-transparent'
                )}
              >
                <div className="grid grid-cols-1 md:grid-cols-3 w-full gap-3 text-xs">
                  <LogField label="Timestamp">{new Date(event.timestamp).toISOString()}</LogField>
                  <LogField label="Event ID">{event.id}</LogField>
                  <LogField label="IP address">{event.ipAddress || '-'}</LogField>
                  <LogField label="Method">{event.requestMethod}</LogField>
                  <LogField label="Path">{event.requestPath}</LogField>
                  <LogField label="Response status">
                    <span
                      className={clsx(
                        event.responseStatus >= 400 ? 'text-red-500' : 'text-emerald-500'
                      )}
                    >
                      {event.responseStatus}
                    </span>
                  </LogField>
                  <div className="md:col-span-3">
                    <LogField label="User agent">
                      <span className="font-normal truncate max-w-lg inline-block align-bottom">
                        {event.userAgent || '-'}
                      </span>
                    </LogField>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {event.requestBody && (
                    <div>
                      <div className="text-neutral-500 text-2xs font-medium mb-1">Request Body</div>
                      <JsonBlock data={event.requestBody} />
                    </div>
                  )}
                  {event.responseBody && (
                    <div>
                      <div className="text-neutral-500 text-2xs font-medium mb-1">
                        Response Body
                      </div>
                      <JsonBlock data={event.responseBody} />
                    </div>
                  )}
                </div>
              </Disclosure.Panel>
            </td>
          </Transition>
        </>
      )}
    </Disclosure>
  )
}
