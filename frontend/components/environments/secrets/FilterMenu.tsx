import { Popover, Transition } from '@headlessui/react'
import { Fragment, useEffect } from 'react'
import { FaCog, FaFilter, FaKey, FaLock, FaUserEdit } from 'react-icons/fa'
import { FaArrowsRotate, FaBolt, FaXmark } from 'react-icons/fa6'
import clsx from 'clsx'
import { ApiSecretTypeChoices, SecretTagType } from '@/apollo/graphql'
import { Checkbox } from '@/components/common/Checkbox'
import {
  SecretFilter,
  EMPTY_SECRET_FILTER,
  activeFilterCount,
  filterIsActive,
} from '@/utils/secrets'

const SECTION_LABEL =
  'flex items-center justify-between gap-2 px-2 pt-1.5 pb-0.5 text-3xs font-semibold uppercase tracking-widest text-neutral-400 dark:text-neutral-600'

const SectionHeading = ({
  label,
  hint,
  divider,
}: {
  label: string
  hint: string
  divider?: boolean
}) => (
  <div className={clsx(SECTION_LABEL, divider && 'mt-1 border-t border-neutral-500/15')}>
    <span>{label}</span>
    <span className="font-mono font-semibold normal-case tracking-normal text-neutral-400/80 dark:text-neutral-600">
      {hint}
    </span>
  </div>
)

const ToggleRow = ({
  active,
  onToggle,
  icon,
  label,
}: {
  active: boolean
  onToggle: () => void
  icon: React.ReactNode
  label: React.ReactNode
}) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onToggle}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onToggle()
      }
    }}
    className={clsx(
      'flex items-center justify-between gap-2 w-full px-2 py-1 text-left rounded-md cursor-pointer transition ease hover:bg-zinc-100 dark:hover:bg-zinc-700',
      active ? 'font-semibold text-neutral-900 dark:text-neutral-100' : 'text-neutral-500'
    )}
  >
    <span className="flex items-center gap-2 min-w-0">
      {icon}
      <span className="truncate">{label}</span>
    </span>
    <Checkbox checked={active} onChange={() => onToggle()} size="sm" />
  </div>
)

// Reports the Popover's open state up to the parent (so the sticky toolbar can be
// lifted above the secret rows' hover menus while the menu is open).
const OpenObserver = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
}) => {
  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])
  return null
}

const FilterMenu = ({
  filter,
  setFilter,
  availableTags,
  onOpenChange,
}: {
  filter: SecretFilter
  setFilter: (filter: SecretFilter) => void
  availableTags: SecretTagType[]
  onOpenChange?: (open: boolean) => void
}) => {
  const count = activeFilterCount(filter)
  const active = filterIsActive(filter)

  const toggleType = (type: ApiSecretTypeChoices) =>
    setFilter({
      ...filter,
      types: filter.types.includes(type)
        ? filter.types.filter((t) => t !== type)
        : [...filter.types, type],
    })

  const toggleBool = (key: 'rotating' | 'dynamic' | 'overridden') =>
    setFilter({ ...filter, [key]: !filter[key] })

  const toggleTag = (id: string) =>
    setFilter({
      ...filter,
      tagIds: filter.tagIds.includes(id)
        ? filter.tagIds.filter((t) => t !== id)
        : [...filter.tagIds, id],
    })

  return (
    <Popover as="div" className="flex relative">
      {({ open }) => (
        <>
          <OpenObserver open={open} onOpenChange={onOpenChange} />
          <Popover.Button as={Fragment}>
            <button
              className={clsx(
                'bg-zinc-100 dark:bg-zinc-800 transition ease px-2 py-1.5 text-2xs 2xl:text-sm rounded-md flex items-center gap-2',
                open || active
                  ? 'text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
              )}
            >
              <FaFilter />
              Filter
              {count > 0 && (
                <span className="flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-zinc-300 dark:bg-zinc-600 text-zinc-700 dark:text-zinc-200 text-3xs font-semibold">
                  {count}
                </span>
              )}
            </button>
          </Popover.Button>
          <Transition
            as={Fragment}
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
          >
            <Popover.Panel className="absolute z-20 left-0 origin-top-left top-10 p-1.5 ring-1 ring-inset ring-neutral-500/20 bg-zinc-200 dark:bg-zinc-800 rounded-md shadow-xl text-2xs 2xl:text-sm w-52 max-h-[70vh] overflow-y-auto">
              <SectionHeading label="Type" hint="type:" />
              <ToggleRow
                active={filter.types.includes(ApiSecretTypeChoices.Config)}
                onToggle={() => toggleType(ApiSecretTypeChoices.Config)}
                icon={<FaCog className="text-blue-500 shrink-0" />}
                label="Config"
              />
              <ToggleRow
                active={filter.types.includes(ApiSecretTypeChoices.Secret)}
                onToggle={() => toggleType(ApiSecretTypeChoices.Secret)}
                icon={<FaKey className="shrink-0" />}
                label="Secret"
              />
              <ToggleRow
                active={filter.types.includes(ApiSecretTypeChoices.Sealed)}
                onToggle={() => toggleType(ApiSecretTypeChoices.Sealed)}
                icon={<FaLock className="text-red-500 shrink-0" />}
                label="Sealed"
              />

              <SectionHeading label="Management" hint="is:" divider />
              <ToggleRow
                active={filter.rotating}
                onToggle={() => toggleBool('rotating')}
                icon={<FaArrowsRotate className="text-emerald-500 shrink-0" />}
                label="Rotating"
              />
              <ToggleRow
                active={filter.dynamic}
                onToggle={() => toggleBool('dynamic')}
                icon={<FaBolt className="text-emerald-500 shrink-0" />}
                label="Dynamic"
              />
              <ToggleRow
                active={filter.overridden}
                onToggle={() => toggleBool('overridden')}
                icon={<FaUserEdit className="shrink-0" />}
                label="Overridden"
              />

              {availableTags.length > 0 && (
                <>
                  <SectionHeading label="Tags" hint="tag:" divider />
                  {availableTags.map((tag) => (
                    <ToggleRow
                      key={tag.id}
                      active={filter.tagIds.includes(tag.id)}
                      onToggle={() => toggleTag(tag.id)}
                      icon={
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                      }
                      label={tag.name}
                    />
                  ))}
                </>
              )}

              {active && (
                <div className="mt-1 pt-1 border-t border-neutral-500/20">
                  <button
                    type="button"
                    onClick={() => setFilter(EMPTY_SECRET_FILTER)}
                    className="flex items-center gap-2 w-full px-2 py-1 text-left rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition ease"
                  >
                    <FaXmark className="shrink-0" />
                    Clear filters
                  </button>
                </div>
              )}
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  )
}

export default FilterMenu
