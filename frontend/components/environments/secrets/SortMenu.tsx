import { Menu, Transition } from '@headlessui/react'
import { FaSortAmountDown, FaArrowUp, FaArrowDown, FaCalendar, FaCalendarAlt } from 'react-icons/fa'
import { Fragment } from 'react'
import { SortOption } from '@/utils/secrets'
import clsx from 'clsx'
import { FaA, FaKey } from 'react-icons/fa6'

const sortOptions = [
  { label: 'Created', value: 'created', icon: <FaCalendarAlt /> },
  { label: 'Updated', value: 'updated', icon: <FaCalendarAlt /> },
  { label: 'Key', value: 'key', icon: <FaKey /> },
  { label: 'Value', value: 'value', icon: <FaKey /> },
]

const SortMenu = ({
  sort,
  setSort,
}: {
  sort: SortOption
  setSort: (option: SortOption) => void
}) => {
  const activeSortLabel = sortOptions.find((option) => sort.includes(option.value))?.label
  const activeSortDirectionIcon = sort.includes('-') ? <FaArrowDown /> : <FaArrowUp />

  return (
    <Menu as="div" className="flex relative">
      {({ open }) => (
        <>
          <Menu.Button as={Fragment}>
            <button
              className={clsx(
                'bg-zinc-100 dark:bg-zinc-800 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition ease p-2 rounded-md flex items-center gap-2',
                open
                  ? 'text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
              )}
            >
              <FaSortAmountDown />
              Sort: {activeSortLabel} {activeSortDirectionIcon}
            </button>
          </Menu.Button>
          <Transition
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
            as="div"
            className="absolute z-20 left-0 origin-top-right top-12"
          >
            <Menu.Items as={Fragment} static>
              <div className="p-2 ring-1 ring-inset ring-neutral-500/20 bg-zinc-200 dark:bg-zinc-800 rounded-md shadow-xl text-sm w-40">
                {sortOptions.map((option) => (
                  <Menu.Item key={option.value}>
                    {({ active }) => (
                      <button
                        onClick={() =>
                          setSort(
                            sort === option.value
                              ? (`-${option.value}` as SortOption)
                              : (option.value as SortOption)
                          )
                        }
                        className={clsx(
                          'flex items-center gap-2 justify-between w-full px-2 py-1  text-left rounded-md',
                          sort === option.value || sort === `-${option.value}`
                            ? 'font-semibold text-neutral-900 dark:text-neutral-100'
                            : 'text-neutral-500',
                          {
                            'bg-zinc-100 dark:bg-zinc-700': active,
                          }
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {option.icon}
                          {option.label}
                        </div>
                        {sort === option.value ? (
                          <FaArrowUp />
                        ) : sort === `-${option.value}` ? (
                          <FaArrowDown />
                        ) : (
                          <span className="w-[14px]"></span>
                        )}
                      </button>
                    )}
                  </Menu.Item>
                ))}
              </div>
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  )
}

export default SortMenu
