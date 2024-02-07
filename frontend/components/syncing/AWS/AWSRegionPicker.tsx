import { AwsRegion, awsRegions } from '@/utils/syncing/aws'
import { Combobox, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment, useState } from 'react'
import { FaChevronDown } from 'react-icons/fa'

export const AWSRegionPicker = (props: { onChange: (region: string) => void }) => {
  const { onChange } = props

  const [region, setRegion] = useState<AwsRegion>(awsRegions[0])
  const [query, setQuery] = useState('')

  const handleSetRegion = (selectedRegion: AwsRegion) => {
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
        <Combobox value={region} onChange={handleSetRegion}>
          {({ open }) => (
            <>
              <div className="space-y-2">
                <Combobox.Label as={Fragment}>
                  <label className="block text-gray-700 text-sm font-bold" htmlFor="name">
                    AWS Region
                  </label>
                </Combobox.Label>
                <div className="w-full relative flex items-center">
                  <Combobox.Input
                    className="w-full"
                    onChange={(event) => setQuery(event.target.value)}
                    required
                    displayValue={(region: AwsRegion) => region.region}
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
                  <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl z-20 absolute max-h-80 overflow-y-auto">
                    {filteredRegions.map((region: AwsRegion) => (
                      <Combobox.Option key={region.region} value={region}>
                        {({ active, selected }) => (
                          <div
                            className={clsx(
                              'flex flex-col gap-1 p-2 cursor-pointer rounded-md w-full',
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
