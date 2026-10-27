import { GCP_GLOBAL_LOCATION, GcpLocation, gcpSecretManagerLocations } from '@/utils/syncing/gcp'
import { Combobox, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment, useState } from 'react'
import { FaChevronDown } from 'react-icons/fa'

const locations: GcpLocation[] = [
  { id: GCP_GLOBAL_LOCATION, name: 'Global (automatic replication)' },
  ...gcpSecretManagerLocations,
]

export const GCPLocationPicker = (props: {
  value: string
  onChange: (location: string) => void
}) => {
  const { value, onChange } = props
  const [query, setQuery] = useState('')

  const selected = locations.find((location) => location.id === value) ?? locations[0]
  const normalizedQuery = query.toLowerCase()
  const filtered =
    query === ''
      ? locations
      : locations.filter(
          (location) =>
            location.id.includes(normalizedQuery) ||
            location.name.toLowerCase().includes(normalizedQuery)
        )

  return (
    <div className="relative">
      <Combobox
        as="div"
        value={selected}
        onChange={(location: GcpLocation | null) => location && onChange(location.id)}
      >
        {({ open }) => (
          <>
            <div className="space-y-2">
              <Combobox.Label as={Fragment}>
                <label className="block text-neutral-500 text-xs">Location</label>
              </Combobox.Label>
              <div className="w-full relative flex items-center">
                <Combobox.Input
                  className="w-full"
                  onChange={(event) => setQuery(event.target.value)}
                  displayValue={(location: GcpLocation) =>
                    location.id === GCP_GLOBAL_LOCATION ? location.name : location.id
                  }
                  required
                />
                <div className="absolute inset-y-0 right-2 flex items-center">
                  <Combobox.Button>
                    <FaChevronDown
                      className={clsx(
                        'text-neutral-500 transform transition ease cursor-pointer',
                        open ? 'rotate-180' : 'rotate-0'
                      )}
                    />
                  </Combobox.Button>
                </div>
              </div>
            </div>
            <Transition
              enter="transition duration-100 ease-out"
              enterFrom="transform scale-95 opacity-0"
              enterTo="transform scale-100 opacity-100"
              leave="transition duration-75 ease-out"
              leaveFrom="transform scale-100 opacity-100"
              leaveTo="transform scale-95 opacity-0"
            >
              <Combobox.Options as={Fragment}>
                <div className="bg-zinc-300 dark:bg-zinc-800 rounded-b-md shadow-2xl z-20 absolute max-h-72 overflow-y-auto w-full border border-t-none border-neutral-500/20 divide-y divide-neutral-500/20">
                  {filtered.map((location) => (
                    <Combobox.Option as="div" key={location.id} value={location}>
                      {({ active }) => (
                        <div
                          className={clsx(
                            'flex flex-col p-2 cursor-pointer rounded-md w-full',
                            active && 'bg-zinc-400 dark:bg-zinc-700'
                          )}
                        >
                          <div className="font-semibold text-black dark:text-white">
                            {location.name}
                          </div>
                          {location.id !== GCP_GLOBAL_LOCATION && (
                            <div className="text-neutral-500 text-2xs">{location.id}</div>
                          )}
                        </div>
                      )}
                    </Combobox.Option>
                  ))}
                </div>
              </Combobox.Options>
            </Transition>
          </>
        )}
      </Combobox>
      <p className="text-neutral-500 text-2xs pt-1">
        {value === GCP_GLOBAL_LOCATION
          ? 'Google chooses where replicas are stored.'
          : 'A regional secret: stored only in this location, on its regional endpoint.'}
      </p>
    </div>
  )
}
