import { AwsRegion, awsRegions } from '@/utils/syncing/aws'
import { Combobox, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment, useId, useState } from 'react'
import { FaChevronDown } from 'react-icons/fa'

export const AWSRegionPicker = (props: {
  onChange: (region: string) => void
  value?: string
  disabled?: boolean
}) => {
  const { onChange, value, disabled = false } = props
  const inputId = useId()

  const [region, setRegion] = useState<AwsRegion>(
    value ? awsRegions.find((r) => r.region === value) || awsRegions[0] : awsRegions[0]
  )
  const [query, setQuery] = useState('')

  const handleSetRegion = (selectedRegion: AwsRegion | null) => {
    if (!selectedRegion) return

    setRegion(selectedRegion)
    onChange(selectedRegion.region)
  }

  const filteredRegions =
    query === ''
      ? awsRegions
      : awsRegions.filter(
          (awsRegion) => awsRegion.region.includes(query) || awsRegion.regionName.includes(query)
        )

  return (
    <div className="space-y-2">
      <div className="relative">
        <Combobox as="div" value={region} onChange={handleSetRegion} disabled={disabled}>
          {({ open }) => (
            <>
              <div className="space-y-2">
                <Combobox.Label as={Fragment}>
                  <label className="block text-sm text-neutral-500" htmlFor={inputId}>
                    AWS Region
                  </label>
                </Combobox.Label>
                <div className="w-full relative flex items-center">
                  <Combobox.Input
                    id={inputId}
                    className="w-full disabled:cursor-not-allowed disabled:opacity-60"
                    onChange={(event) => setQuery(event.target.value)}
                    required
                    displayValue={(region: AwsRegion) => region.region}
                  />
                  <div className="absolute inset-y-0 right-2 flex items-center">
                    <Combobox.Button disabled={disabled} aria-label="Open AWS Region options">
                      <FaChevronDown
                        className={clsx(
                          'text-neutral-500 transform transition ease',
                          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
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
                    {filteredRegions.map((region: AwsRegion) => (
                      <Combobox.Option as="div" key={region.region} value={region}>
                        {({ active, selected }) => (
                          <div
                            className={clsx(
                              'flex flex-col p-2 cursor-pointer rounded-md w-full',
                              active && 'bg-zinc-400 dark:bg-zinc-700'
                            )}
                          >
                            <div className="font-semibold text-black dark:text-white">
                              {region.regionName}
                            </div>
                            <div className="text-neutral-500 text-2xs">{region.region}</div>
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
