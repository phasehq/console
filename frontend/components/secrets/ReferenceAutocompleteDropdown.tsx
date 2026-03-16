import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { FaKey, FaCubes, FaFolder } from 'react-icons/fa'
import { BsListColumnsReverse } from 'react-icons/bs'
import { MdKeyboardReturn, MdOpenInNew } from 'react-icons/md'
import { ReferenceSuggestion } from '@/utils/secretReferences'

interface ReferenceAutocompleteDropdownProps {
  suggestions: ReferenceSuggestion[]
  activeIndex: number
  onSelect: (index: number) => void
  onNavigate?: (index: number) => void
  visible: boolean
}

const typeIcon: Record<ReferenceSuggestion['type'], { icon: React.ReactNode; className: string }> =
  {
    key: {
      icon: <FaKey />,
      className: 'text-[#3a9474] dark:text-[#74ccaa]',
    },
    env: {
      icon: <BsListColumnsReverse />,
      className: 'text-[#3a8a93] dark:text-[#5fb5be]',
    },
    app: {
      icon: <FaCubes />,
      className: 'text-[#c4608e] dark:text-[#ed9cc2]',
    },
    folder: {
      icon: <FaFolder />,
      className: 'text-[#b07a2a] dark:text-[#f6c177]',
    },
  }

export const ReferenceAutocompleteDropdown: React.FC<ReferenceAutocompleteDropdownProps> = ({
  suggestions,
  activeIndex,
  onSelect,
  onNavigate,
  visible,
}) => {
  const listRef = useRef<HTMLUListElement>(null)
  const activeItemRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!visible || suggestions.length === 0) return null

  return (
    <div className="absolute left-0 top-full mt-0 z-50 w-full min-w-[280px] max-w-lg">
      <ul
        ref={listRef}
        className="max-h-48 overflow-y-auto rounded-b-md bg-zinc-100 dark:bg-zinc-800 shadow-lg ring-1 ring-neutral-500/20 py-1"
        role="listbox"
        aria-activedescendant={activeIndex >= 0 ? `ref-option-${activeIndex}` : undefined}
      >
        {suggestions.map((suggestion, index) => {
          const { icon, className: iconClass } = typeIcon[suggestion.type]
          const isActive = index === activeIndex

          return (
            <li
              key={`${suggestion.insertText}-${index}`}
              id={`ref-option-${index}`}
              ref={isActive ? activeItemRef : undefined}
              role="option"
              aria-selected={isActive}
              className={clsx(
                'flex items-center gap-2 px-3 py-1.5 cursor-pointer text-2xs 2xl:text-sm font-mono',
                isActive
                  ? 'bg-zinc-300 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700/50'
              )}
              onMouseDown={(e) => {
                e.preventDefault() // prevent textarea blur
                if ((e.ctrlKey || e.metaKey) && onNavigate) {
                  onNavigate(index)
                } else {
                  onSelect(index)
                }
              }}
            >
              <span className={clsx('shrink-0 text-2xs', iconClass)}>{icon}</span>
              <span className="truncate">{suggestion.label}</span>
              {isActive ? (
                <span className="ml-auto shrink-0 flex items-center gap-2">
                  <kbd className="flex items-center gap-0.5 text-2xs font-sans text-zinc-500 dark:text-zinc-400 bg-zinc-200 dark:bg-zinc-600 border border-zinc-300 dark:border-zinc-500 rounded px-1">
                    Enter
                    <MdKeyboardReturn className="text-xs" />
                  </kbd>
                  <kbd className="flex items-center gap-0.5 text-2xs font-sans text-zinc-500 dark:text-zinc-400 bg-zinc-200 dark:bg-zinc-600 border border-zinc-300 dark:border-zinc-500 rounded px-1">
                    Ctrl+Enter
                    <MdOpenInNew className="text-xs" />
                  </kbd>
                </span>
              ) : suggestion.description ? (
                <span className="ml-auto text-zinc-500 text-2xs font-sans truncate">
                  {suggestion.description}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
