'use client'

import { Fragment } from 'react'
import { SCIMEventRow } from './SCIMEventRow'

export function SCIMEventsTable({
  events,
  pageSize,
}: {
  events: any[]
  pageSize?: number
}) {
  return (
    <table className="table-auto min-w-full">
      <thead>
        <tr className="border-b border-neutral-500/20">
          <th className="py-2 w-6"></th>
          <th className="py-2 px-6 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">
            Time
          </th>
          <th className="py-2 px-6 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">
            Status
          </th>
          <th className="py-2 px-6 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">
            Event
          </th>
          <th className="py-2 px-6 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">
            Provider
          </th>
          <th className="py-2 px-6 text-left text-2xs font-medium text-gray-500 uppercase tracking-wider">
            Resource
          </th>
        </tr>
      </thead>
      <tbody>
        {events.map((event: any, n: number) => (
          <Fragment key={event.id}>
            {pageSize && n !== 0 && n % pageSize === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="flex items-center justify-center bg-zinc-300 dark:bg-zinc-800 py-px text-neutral-500 text-xs">
                    Page {n / pageSize + 1}
                  </div>
                </td>
              </tr>
            )}
            <SCIMEventRow event={event} />
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}
