import {
  GITLAB_ALL_ENVIRONMENTS_SCOPE,
  gitLabEnvironmentScopeLabel,
  gitLabEnvironmentScopeOptions,
  isValidGitLabEnvironmentScope,
} from '@/utils/syncing/gitlab'
import { Combobox, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment, useRef, useState } from 'react'
import { FaCheckCircle, FaChevronDown } from 'react-icons/fa'

export const GitLabEnvironmentScopePicker = (props: {
  value: string
  onChange: (scope: string) => void
  environments: string[]
  loading?: boolean
  isGroup: boolean
}) => {
  const { value, onChange, environments, loading, isGroup } = props
  const [query, setQuery] = useState('')
  // What was typed but not picked from the list. Kept when the picker closes (e.g. on
  // clicking elsewhere), so the scope that's shown is the scope that's used, rather
  // than silently falling back to all environments. Escape discards it.
  const typedScope = useRef('')

  const { scopes, customScope } = gitLabEnvironmentScopeOptions(environments, query)

  const optionClassName = (active: boolean) =>
    clsx(
      'flex items-center justify-between gap-2 p-2 cursor-pointer w-full border-b border-neutral-500/20',
      active && 'bg-zinc-300 dark:bg-zinc-700'
    )

  return (
    <div className="relative">
      <Combobox
        as="div"
        value={value}
        onChange={(scope: string | null) => {
          typedScope.current = ''
          if (scope) onChange(scope)
          setQuery('')
        }}
        onClose={() => {
          const typed = typedScope.current.trim()
          typedScope.current = ''
          setQuery('')
          if (typed && typed !== value && isValidGitLabEnvironmentScope(typed)) onChange(typed)
        }}
      >
        {({ open }) => (
          <>
            <div className="space-y-2">
              <Combobox.Label as={Fragment}>
                <label className="block text-neutral-500 text-sm">GitLab Environment Scope</label>
              </Combobox.Label>
              <div className="w-full relative flex items-center">
                <Combobox.Input
                  className="w-full"
                  onChange={(event) => {
                    typedScope.current = event.target.value
                    setQuery(event.target.value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') typedScope.current = ''
                  }}
                  displayValue={(scope: string) =>
                    scope === GITLAB_ALL_ENVIRONMENTS_SCOPE
                      ? `${gitLabEnvironmentScopeLabel(scope)} (*)`
                      : scope
                  }
                  placeholder="Select or type a scope"
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
                <div className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-b-md shadow-2xl z-20 absolute max-h-72 overflow-y-auto w-full border border-t-none border-neutral-500/20">
                  {loading && (
                    <div className="p-2 text-neutral-500 text-sm">
                      {isGroup ? 'Loading scopes...' : 'Loading environments...'}
                    </div>
                  )}
                  {scopes.map((scope) => (
                    <Combobox.Option as="div" key={scope} value={scope}>
                      {({ active, selected }) => (
                        <div className={optionClassName(active)}>
                          <div>
                            <div className="font-semibold text-black dark:text-white">
                              {gitLabEnvironmentScopeLabel(scope)}
                            </div>
                            {scope === GITLAB_ALL_ENVIRONMENTS_SCOPE && (
                              <div className="text-neutral-500 text-2xs">Default scope (*)</div>
                            )}
                          </div>
                          {selected && <FaCheckCircle className="shrink-0 text-emerald-500" />}
                        </div>
                      )}
                    </Combobox.Option>
                  ))}
                  {customScope && (
                    <Combobox.Option as="div" key={`custom:${customScope}`} value={customScope}>
                      {({ active }) => (
                        <div className={optionClassName(active)}>
                          <div>
                            <div className="font-semibold text-black dark:text-white">
                              Use &quot;{customScope}&quot;
                            </div>
                            <div className="text-neutral-500 text-2xs">Custom scope</div>
                          </div>
                        </div>
                      )}
                    </Combobox.Option>
                  )}
                  {scopes.length === 0 && !customScope && (
                    <div className="p-2 text-neutral-500 text-sm">
                      Not a valid environment scope
                    </div>
                  )}
                </div>
              </Combobox.Options>
            </Transition>
          </>
        )}
      </Combobox>
      <p className="text-neutral-500 text-2xs pt-1">
        {isGroup
          ? "Choose a scope used by this group's variables, or type one such as production or review/*. Scoped group variables require GitLab Premium or Ultimate."
          : 'Choose an environment from this project, or type a wildcard scope such as review/*.'}
      </p>
    </div>
  )
}
