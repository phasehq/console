'use client'

import { SCIMEventRow } from './SCIMEventRow'

export function SCIMEventsTable({ events }: { events: any[] }) {
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
        {events.map((event: any) => (
          <SCIMEventRow key={event.id} event={event} />
        ))}
      </tbody>
    </table>
  )
}
