import { AwsRegion, awsRegions } from '@/utils/syncing/aws'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment, useState } from 'react'
import { FaChevronDown } from 'react-icons/fa'

export const AWSRegionPicker = (props: { onChange: (region: string) => void }) => {
  const { onChange } = props

  const [region, setRegion] = useState<AwsRegion>(awsRegions[0])

  const handleSetRegion = (selectedRegion: AwsRegion) => {
    setRegion(selectedRegion)
    onChange(selectedRegion.region)
  }

  //const selectedRegion = awsRegions.find((awsRegion) => awsRegion.region === region)

  return (
    <div className="space-y-2">
      <label className="block text-gray-700 text-sm font-bold mb-2">AWS Region</label>
      <div className="relative">
        <Listbox value={region} onChange={handleSetRegion}>
          {({ open }) => (
            <>
              <Listbox.Button as={Fragment} aria-required>
                <div
                  className={clsx(
                    'p-2 flex items-center justify-between cursor-pointer gap-2 bg-zinc-100 dark:bg-zinc-800 dark:bg-opacity-60 rounded-md text-zinc-800 dark:text-white ring-1 ring-inset ring-neutral-500/40 focus:ring-1 focus:ring-emerald-500 group-focus-within:invalid:ring-red-500 focus:ring-inset'
                  )}
                >
                  {region && (
                    <div>
                      <div className="font-semibold text-sm text-black dark:text-white">
                        {region.regionName}
                      </div>
                      <div className="text-neutral-500 text-xs">{region.region}</div>
                    </div>
                  )}

                  <FaChevronDown
                    className={clsx(
                      'transition-transform ease duration-300 text-neutral-500',
                      open ? 'rotate-180' : 'rotate-0'
                    )}
                  />
                </div>
              </Listbox.Button>
              <Listbox.Options>
                <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10 w-full max-h-80 overflow-y-auto">
                  {awsRegions.map((region) => (
                    <Listbox.Option key={region.region} value={region} as={Fragment}>
                      {({ active, selected }) => (
                        <div
                          className={clsx(
                            'space-y-0 p-2 cursor-pointer rounded-md w-full',
                            active && 'bg-zinc-400 dark:bg-zinc-700'
                          )}
                        >
                          <div className="font-semibold text-sm text-black dark:text-white">
                            {region.regionName}
                          </div>
                          <div className="text-neutral-500 text-xs">{region.region}</div>
                        </div>
                      )}
                    </Listbox.Option>
                  ))}
                </div>
              </Listbox.Options>
            </>
          )}
        </Listbox>
      </div>
    </div>
  )
}
