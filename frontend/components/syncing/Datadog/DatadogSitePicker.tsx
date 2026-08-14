import { DatadogSite, datadogSites } from '@/utils/syncing/datadog'
import { Combobox, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment, useEffect, useState } from 'react'
import { FaChevronDown } from 'react-icons/fa'

export const DatadogSitePicker = (props: {
  onChange: (site: string) => void
  value?: string
  disabled?: boolean
}) => {
  const { onChange, value, disabled } = props

  const [site, setSite] = useState<DatadogSite>(
    value ? datadogSites.find((s) => s.site === value) || datadogSites[0] : datadogSites[0]
  )
  const [query, setQuery] = useState('')

  // Sites are a fixed allowlist (SSRF surface) — make sure the default is
  // committed to form state even if the user never touches the picker.
  useEffect(() => {
    if (!value) onChange(site.site)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSetSite = (selectedSite: DatadogSite) => {
    setSite(selectedSite)
    onChange(selectedSite.site)
  }

  const filteredSites =
    query === ''
      ? datadogSites
      : datadogSites.filter(
          (datadogSite) =>
            datadogSite.site.includes(query.toLowerCase()) ||
            datadogSite.name.toLowerCase().includes(query.toLowerCase())
        )

  return (
    <div className="space-y-2">
      <div className="relative">
        <Combobox as="div" value={site} onChange={handleSetSite} disabled={disabled}>
          {({ open }) => (
            <>
              <div className="space-y-2">
                <Combobox.Label as={Fragment}>
                  <label className="block text-sm text-neutral-500" htmlFor="site">
                    Datadog Site
                  </label>
                </Combobox.Label>
                <div className="w-full relative flex items-center">
                  <Combobox.Input
                    className="w-full"
                    onChange={(event) => setQuery(event.target.value)}
                    required
                    displayValue={(site: DatadogSite) => site.site}
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
                  <div className="bg-zinc-300 dark:bg-zinc-800 rounded-b-md shadow-2xl z-20 absolute max-h-80 overflow-y-auto w-full border border-t-none border-neutral-500/20 divide-y divide-neutral-500/20">
                    {filteredSites.map((datadogSite: DatadogSite) => (
                      <Combobox.Option as="div" key={datadogSite.site} value={datadogSite}>
                        {({ active }) => (
                          <div
                            className={clsx(
                              'flex flex-col p-2 cursor-pointer rounded-md w-full',
                              active && 'bg-zinc-400 dark:bg-zinc-700'
                            )}
                          >
                            <div className="font-semibold text-black dark:text-white">
                              {datadogSite.name}
                            </div>
                            <div className="text-neutral-500 text-2xs">{datadogSite.site}</div>
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
      </div>
    </div>
  )
}
