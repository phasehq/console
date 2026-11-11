'use client'

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { FaCheckCircle, FaFolder, FaHome, FaSearch } from 'react-icons/fa'

// Past this many, the list gets a search field
const SEARCH_FROM = 8

const segments = (path: string) => path.split('/').filter(Boolean)

// By segment, so a folder's children follow it even when a sibling's name sorts between them
const byTreeOrder = (a: string, b: string) => {
  const [x, y] = [segments(a), segments(b)]
  for (let i = 0; i < Math.min(x.length, y.length); i++)
    if (x[i] !== y[i]) return x[i].localeCompare(y[i])
  return x.length - y.length
}

type FolderPickerProps = {
  /** Folders to offer, as full paths; the root is always offered */
  folders: string[]
  value: string | null
  onChange: (path: string) => void
}

/** One of an App's folders, or its root, picked from the tree */
export const FolderPicker = ({ folders, value, onChange }: FolderPickerProps) => {
  const [query, setQuery] = useState('')
  const options = useMemo(() => ['/', ...[...folders].sort(byTreeOrder)], [folders])
  const search = query.trim().toLowerCase()
  const shown = search ? options.filter((option) => option.toLowerCase().includes(search)) : options

  return (
    <div className="space-y-2">
      {options.length > SEARCH_FROM && (
        <div className="flex items-center gap-2 rounded-md bg-zinc-100 px-2 ring-1 ring-inset ring-neutral-500/40 dark:bg-zinc-800">
          <FaSearch className="shrink-0 text-xs text-neutral-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search folders"
            className="custom w-full bg-transparent text-sm text-zinc-900 placeholder:text-neutral-500 dark:text-zinc-100"
          />
        </div>
      )}

      <div
        role="radiogroup"
        aria-label="Folder"
        className="max-h-72 overflow-y-auto rounded-md ring-1 ring-inset ring-neutral-500/20"
      >
        {shown.map((option) => {
          const parts = segments(option)
          const selected = option === value
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option)}
              title={option}
              className={clsx(
                'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-zinc-900 transition ease dark:text-zinc-100',
                selected ? 'bg-emerald-400/10' : 'hover:bg-zinc-500/10'
              )}
              // Searching flattens the tree, so each match shows its whole path instead
              style={search ? undefined : { paddingLeft: `${0.5 + Math.max(parts.length - 1, 0)}rem` }}
            >
              {option === '/' ? (
                <FaHome className="shrink-0 text-neutral-500" />
              ) : (
                <FaFolder className="shrink-0 text-amber-500" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {option === '/' ? 'Root' : search ? option : parts.at(-1)}
              </span>
              {selected && <FaCheckCircle className="shrink-0 text-emerald-500" />}
            </button>
          )
        })}
        {shown.length === 0 && (
          <div className="p-3 text-center text-xs text-neutral-500">No folder matches “{query}”</div>
        )}
      </div>
    </div>
  )
}
