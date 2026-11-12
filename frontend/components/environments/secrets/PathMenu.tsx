'use client'

import { Fragment, KeyboardEvent, ReactNode, useEffect, useId, useState } from 'react'
import { Popover, PopoverButton, PopoverPanel, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaCheck,
  FaChevronDown,
  FaFolder,
  FaFolderOpen,
  FaHome,
  FaKey,
  FaLevelDownAlt,
  FaSearch,
} from 'react-icons/fa'
import { filterSyncPathOptions, SyncPathOption } from '@/utils/syncing/paths'

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-neutral-500/40 bg-zinc-200 px-1 font-sans text-[10px] text-neutral-500 dark:bg-zinc-900">
    {children}
  </kbd>
)

const PathCounts = ({ option }: { option: SyncPathOption }) => (
  <div className="flex shrink-0 items-center gap-3 text-2xs tabular-nums text-neutral-500">
    <span className="flex items-center gap-1" title={plural(option.folderCount, 'folder')}>
      <FaFolder className="shrink-0" />
      {option.folderCount}
    </span>
    <span className="flex items-center gap-1" title={plural(option.secretCount, 'secret')}>
      <FaKey className="shrink-0" />
      {option.secretCount}
    </span>
  </div>
)

type PathMenuProps = {
  /** The root and every folder, in tree order */
  options: SyncPathOption[]
  /** The folder the grid is open at */
  path: string
  onNavigate: (path: string) => void
}

/** The list itself; mounted with the panel, so each opening starts on the current folder with no filter */
const PathList = ({ options, path, onNavigate, close }: PathMenuProps & { close: () => void }) => {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(() =>
    Math.max(
      options.findIndex((option) => option.path === path),
      0
    )
  )
  const { options: shown, hiddenCount } = filterSyncPathOptions(options, query)
  const filtering = query.trim() !== ''
  const secretTotal = options.reduce((sum, option) => sum + option.secretCount, 0)
  const rowId = (index: number) => `${listId}-${index}`

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [listId, active])

  const pick = (option: SyncPathOption | undefined) => {
    if (!option) return
    close()
    if (option.path !== path) onNavigate(option.path)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((at) => Math.min(Math.max(at + step, 0), shown.length - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(shown[active])
    }
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-2 px-3 pb-1.5 pt-2">
        <span className="text-xs font-medium">Folders</span>
        <span className="text-2xs text-neutral-500">
          {plural(options.length, 'path')} · {plural(secretTotal, 'secret')}
        </span>
      </div>
      <div className="mx-1 flex items-center gap-2 rounded-md bg-zinc-200 px-2 dark:bg-zinc-900/60">
        <FaSearch className="shrink-0 text-2xs text-neutral-500" />
        <input
          role="combobox"
          aria-label="Find a folder"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={shown.length > 0 ? rowId(active) : undefined}
          aria-autocomplete="list"
          placeholder="Find a folder"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            // The best match comes first
            setActive(0)
          }}
          onKeyDown={handleKeyDown}
          className="custom w-full bg-transparent py-1.5 font-mono text-xs text-zinc-900 placeholder:font-sans placeholder:text-neutral-500 dark:text-zinc-100"
        />
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="Folders"
        className="max-h-60 min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
      >
        {shown.map((option, index) => {
          const isRoot = option.path === '/'
          const isCurrent = option.path === path
          const isActive = index === active
          const parent =
            option.parentPath && option.parentPath !== '/' ? `${option.parentPath}/` : '/'
          return (
            <div
              key={option.path}
              id={rowId(index)}
              role="option"
              aria-selected={isCurrent}
              onMouseMove={() => setActive(index)}
              onClick={() => pick(option)}
              className={clsx(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                isActive && 'bg-zinc-200 dark:bg-zinc-700'
              )}
            >
              <div
                className="flex min-w-0 flex-1 items-center gap-2"
                // The whole tree is indented by depth, capped so deep paths still fit
                style={
                  filtering ? undefined : { paddingLeft: `${Math.min(option.depth, 4) * 0.75}rem` }
                }
              >
                {isRoot ? (
                  <FaHome className="shrink-0 text-xs text-neutral-500" />
                ) : isCurrent ? (
                  <FaFolderOpen className="shrink-0 text-xs text-amber-500" />
                ) : (
                  <FaFolder className="shrink-0 text-xs text-amber-500" />
                )}
                <span className="truncate font-mono text-xs" title={option.path}>
                  {isRoot ? (
                    <span className="text-neutral-500">~/</span>
                  ) : filtering ? (
                    <>
                      <span className="text-neutral-500">{parent}</span>
                      {option.name}
                    </>
                  ) : (
                    option.name
                  )}
                </span>
                {isCurrent && <FaCheck className="shrink-0 text-2xs text-emerald-500" />}
              </div>
              <PathCounts option={option} />
              <span className={clsx('hidden', isActive && 'sm:inline-flex')}>
                <Kbd>
                  <FaLevelDownAlt className="rotate-90" />
                </Kbd>
              </span>
            </div>
          )
        })}
        {shown.length === 0 && (
          <div className="px-2 py-3 text-xs text-neutral-500">No matching folders</div>
        )}
        {hiddenCount > 0 && (
          <div className="px-2 py-2 text-2xs text-neutral-500">
            {plural(hiddenCount, 'more folder')}. Type to filter.
          </div>
        )}
      </div>

      <div className="hidden items-center gap-3 border-t border-neutral-500/20 px-3 py-1.5 text-2xs text-neutral-500 sm:flex">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span className="flex items-center gap-1">
          <Kbd>
            <FaLevelDownAlt className="rotate-90" />
          </Kbd>{' '}
          open
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd> close
        </span>
      </div>
    </>
  )
}

/** The root crumb as a list of every folder to jump to; the same list the sync path picker offers */
export const PathMenu = (props: PathMenuProps) => (
  <Popover className="relative">
    {({ close }) => (
      <>
        <PopoverButton
          title="Jump to a folder"
          className="group flex items-center gap-1.5 rounded px-1 py-0.5 text-neutral-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 focus:outline-none data-[open]:bg-zinc-200 data-[open]:text-zinc-900 data-[focus]:ring-1 data-[focus]:ring-emerald-500/70 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:data-[open]:bg-zinc-800 dark:data-[open]:text-zinc-100"
        >
          <FaHome className="shrink-0 text-xs" />
          <span>~/</span>
          <FaChevronDown className="shrink-0 text-[9px] transition-transform group-data-[open]:rotate-180" />
        </PopoverButton>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <PopoverPanel
            focus
            anchor={{ to: 'bottom start', gap: 6, padding: 16 }}
            className="z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg bg-zinc-100 font-normal text-zinc-900 shadow-xl ring-1 ring-inset ring-neutral-500/30 focus:outline-none dark:bg-zinc-800 dark:text-zinc-100"
          >
            <PathList {...props} close={close} />
          </PopoverPanel>
        </Transition>
      </>
    )}
  </Popover>
)
