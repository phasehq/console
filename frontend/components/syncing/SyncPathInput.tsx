import GetSyncPathStats from '@/graphql/queries/syncing/getSyncPathStats.gql'
import { EnvironmentType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import {
  buildSyncPathOptions,
  environmentPathHref,
  filterSyncPathOptions,
  normalizeSecretPath,
  SyncPathFolder,
  SyncPathOption,
} from '@/utils/syncing/paths'
import { useQuery } from '@apollo/client'
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Label,
} from '@headlessui/react'
import clsx from 'clsx'
import { useContext, useMemo, useRef, useState } from 'react'
import {
  FaCheck,
  FaChevronDown,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaFolder,
  FaFolderOpen,
  FaHome,
  FaKey,
  FaLevelDownAlt,
  FaPlus,
} from 'react-icons/fa'

const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded border border-neutral-500/40 bg-zinc-100 dark:bg-zinc-900 font-sans text-[10px] text-neutral-500">
    {children}
  </kbd>
)

const PathCounts = ({ option }: { option: SyncPathOption }) => (
  <div className="flex items-center gap-3 text-neutral-500 text-2xs tabular-nums shrink-0">
    <span className="flex items-center gap-1" title={pluralize(option.folderCount, 'folder')}>
      <FaFolder className="shrink-0" />
      {option.folderCount}
    </span>
    <span
      className="flex items-center gap-1"
      title={option.secretCount === null ? undefined : pluralize(option.secretCount, 'secret')}
    >
      <FaKey className="shrink-0" />
      {option.secretCount ?? '–'}
    </span>
  </div>
)

/**
 * Picks the path a sync reads secrets from. Lists the folders in the chosen
 * environment with their folder and secret counts, filters them as you type,
 * and still accepts any path typed by hand.
 */
export const SyncPathInput = (props: {
  appId: string
  env: EnvironmentType | null
  path: string
  setPath: (path: string) => void
  label?: string
}) => {
  const { appId, env, path, setPath, label = 'Path' } = props
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [query, setQuery] = useState('')
  // What was typed but not picked from the list. Kept when the list closes (e.g. on
  // clicking elsewhere), so the path that's shown is the path that's used. Escape
  // discards it.
  const typedPath = useRef('')

  // errorPolicy 'all' keeps the folders when the user can't read secrets
  const { data, loading } = useQuery(GetSyncPathStats, {
    variables: { envId: env?.id },
    skip: !env?.id,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })

  const allOptions = useMemo(() => {
    const folders: SyncPathFolder[] = (data?.folders ?? []).filter(Boolean)
    const secretPaths: string[] | null = data?.secrets
      ? data.secrets.filter(Boolean).map((secret: { path: string }) => secret.path)
      : null
    return buildSyncPathOptions(folders, secretPaths)
  }, [data])

  const { options, customPath, hiddenCount } = filterSyncPathOptions(allOptions, query)
  const isFiltering = query.trim() !== ''

  const selectedPath = normalizeSecretPath(path)
  const selectedOption = allOptions.find((option) => option.path === selectedPath)
  const hasLoaded = Boolean(data?.folders)
  const secretsKnown = Boolean(data?.secrets)

  const hrefFor = (optionPath: string) =>
    env && organisation
      ? environmentPathHref(organisation.name, appId, env.id, optionPath)
      : undefined

  const commit = (value: string | null) => {
    typedPath.current = ''
    setQuery('')
    if (value !== null) setPath(normalizeSecretPath(value))
  }

  const envName = env?.name ?? 'this environment'
  const viewHref = hrefFor(selectedOption ? selectedPath : '/')

  return (
    <div className="space-y-2 w-full">
      <Combobox
        value={selectedPath}
        onChange={commit}
        onClose={() => {
          const typed = typedPath.current.trim()
          if (typed && normalizeSecretPath(typed) !== selectedPath) commit(typed)
          else commit(null)
        }}
        immediate
      >
        {({ open }) => (
          <div className="space-y-2">
            <Label className="block text-neutral-500 text-xs">{label}</Label>
            <div className="relative flex items-center w-full">
              <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center">
                {selectedPath === '/' && !isFiltering ? (
                  <FaHome className="text-neutral-500" />
                ) : (
                  <FaFolder className="text-amber-500" />
                )}
              </div>
              <ComboboxInput
                className="w-full !pl-8 !pr-8 font-mono"
                displayValue={(value: string) => value}
                onChange={(event) => {
                  typedPath.current = event.target.value
                  setQuery(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') typedPath.current = ''
                }}
                // Select the path so typing searches from scratch; End or → keeps it to
                // type a subpath. Deferred so the click that focused it doesn't undo it.
                onFocus={(event) => {
                  const input = event.currentTarget
                  requestAnimationFrame(() => input.select())
                }}
                placeholder="/"
                spellCheck={false}
                autoComplete="off"
              />
              <ComboboxButton className="absolute inset-y-0 right-0 flex items-center px-2.5">
                <FaChevronDown
                  className={clsx(
                    'text-neutral-500 transform transition ease',
                    open ? 'rotate-180' : 'rotate-0'
                  )}
                />
              </ComboboxButton>
            </div>

            {/* Anchored in a portal so it's never clipped by the dialog and stays within
                the viewport, flipping above the input when there's no room below */}
            <ComboboxOptions
              anchor={{ to: 'bottom start', gap: 4, padding: 16 }}
              transition
              className={clsx(
                'z-50 flex flex-col w-[var(--input-width)] min-w-[min(20rem,calc(100vw-2rem))]',
                'max-h-[min(24rem,var(--anchor-max-height))] overflow-hidden',
                'rounded-md bg-zinc-200 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/20 shadow-2xl',
                'text-black dark:text-white focus:outline-none',
                'origin-top transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0'
              )}
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-neutral-500/20">
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">
                    Folders in <span className="capitalize">{envName}</span>
                  </div>
                  <div className="text-2xs text-neutral-500">
                    {loading && !hasLoaded
                      ? 'Loading…'
                      : [
                          pluralize(allOptions.length, 'path'),
                          secretsKnown && pluralize(data.secrets.filter(Boolean).length, 'secret'),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </div>
                </div>
              </div>

              <div className="overflow-y-auto overscroll-contain p-1 flex-1 min-h-0">
                {options.map((option) => {
                  const isRoot = option.path === '/'
                  const parent =
                    option.parentPath && option.parentPath !== '/' ? `${option.parentPath}/` : '/'
                  const href = hrefFor(option.path)
                  return (
                    <ComboboxOption
                      key={option.path}
                      value={option.path}
                      className="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer data-[focus]:bg-zinc-300 dark:data-[focus]:bg-zinc-700"
                    >
                      {({ selected }) => (
                        <>
                          <div
                            className="flex min-w-0 flex-1 items-center gap-2"
                            // Indent by depth when listing the whole tree, capped so deep
                            // paths still fit on narrow screens
                            style={
                              isFiltering
                                ? undefined
                                : { paddingLeft: `${Math.min(option.depth, 4) * 0.75}rem` }
                            }
                          >
                            {isRoot ? (
                              <FaHome className="shrink-0 text-neutral-500" />
                            ) : selected ? (
                              <FaFolderOpen className="shrink-0 text-amber-500" />
                            ) : (
                              <FaFolder className="shrink-0 text-amber-500" />
                            )}
                            <span className="truncate font-mono text-xs" title={option.path}>
                              {isRoot ? (
                                <span className="text-neutral-500">/ (root)</span>
                              ) : isFiltering ? (
                                <>
                                  <span className="text-neutral-500">{parent}</span>
                                  {option.name}
                                </>
                              ) : (
                                option.name
                              )}
                            </span>
                            {selected && <FaCheck className="shrink-0 text-emerald-500 text-2xs" />}
                          </div>

                          <PathCounts option={option} />

                          <div className="flex items-center gap-1 shrink-0">
                            {href && (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Open ${option.path} in a new tab`}
                                aria-label={`Open ${option.path} in a new tab`}
                                tabIndex={-1}
                                // Open the link without picking the path
                                onClick={(event) => event.stopPropagation()}
                                onMouseDown={(event) => event.stopPropagation()}
                                className="p-1 rounded text-neutral-500 hover:text-emerald-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 sm:opacity-0 sm:group-hover:opacity-100 sm:group-data-[focus]:opacity-100 transition-opacity"
                              >
                                <FaExternalLinkAlt className="text-2xs" />
                              </a>
                            )}
                            <span className="hidden sm:group-data-[focus]:inline-flex">
                              <Kbd>
                                <FaLevelDownAlt className="rotate-90" />
                              </Kbd>
                            </span>
                          </div>
                        </>
                      )}
                    </ComboboxOption>
                  )
                })}

                {customPath && (
                  <ComboboxOption
                    value={customPath}
                    className="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer data-[focus]:bg-zinc-300 dark:data-[focus]:bg-zinc-700"
                  >
                    <FaPlus className="shrink-0 text-neutral-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs">
                        Use <span className="font-mono">{customPath}</span>
                      </div>
                      <div className="text-2xs text-neutral-500">
                        No folder at this path in <span className="capitalize">{envName}</span> yet
                      </div>
                    </div>
                    <span className="hidden sm:group-data-[focus]:inline-flex">
                      <Kbd>
                        <FaLevelDownAlt className="rotate-90" />
                      </Kbd>
                    </span>
                  </ComboboxOption>
                )}

                {hasLoaded && options.length === 0 && !customPath && (
                  <div className="px-2 py-3 text-xs text-neutral-500">No matching folders</div>
                )}

                {hiddenCount > 0 && (
                  <div className="px-2 py-2 text-2xs text-neutral-500">
                    {pluralize(hiddenCount, 'more folder')}. Type to filter.
                  </div>
                )}
              </div>

              <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 border-t border-neutral-500/20 text-2xs text-neutral-500">
                <span className="flex items-center gap-1">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> navigate
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>
                    <FaLevelDownAlt className="rotate-90" />
                  </Kbd>{' '}
                  select
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>esc</Kbd> close
                </span>
              </div>
            </ComboboxOptions>
          </div>
        )}
      </Combobox>

      {env && (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-2xs">
          <div className="min-w-0 flex-1 text-neutral-500">
            {!hasLoaded ? (
              loading ? (
                'Loading folders…'
              ) : null
            ) : !selectedOption ? (
              <span className="flex items-start gap-1.5 text-amber-600 dark:text-amber-500">
                <FaExclamationTriangle className="shrink-0 mt-px" />
                <span>
                  There&apos;s no folder at <code className="font-mono">{selectedPath}</code> in{' '}
                  <span className="capitalize">{envName}</span>. Nothing will be synced until it
                  exists.
                </span>
              </span>
            ) : selectedOption.secretCount === 0 ? (
              <span className="flex items-start gap-1.5 text-amber-600 dark:text-amber-500">
                <FaExclamationTriangle className="shrink-0 mt-px" />
                <span>
                  No secrets at <code className="font-mono">{selectedPath}</code> yet. Nothing will
                  be synced until you add some.
                </span>
              </span>
            ) : (
              <span className="flex items-start gap-1.5">
                <FaKey className="shrink-0 mt-px" />
                <span>
                  {selectedOption.secretCount === null ? (
                    <>Syncs the secrets</>
                  ) : (
                    <>
                      Syncs{' '}
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {pluralize(selectedOption.secretCount, 'secret')}
                      </span>
                    </>
                  )}{' '}
                  from <code className="font-mono">{selectedPath}</code> in{' '}
                  <span className="capitalize">{envName}</span>
                  {selectedOption.folderCount > 0 &&
                    `. Secrets in its ${pluralize(
                      selectedOption.folderCount,
                      'subfolder'
                    )} aren't included`}
                  .
                </span>
              </span>
            )}
          </div>
          {viewHref && (
            <a
              href={viewHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 shrink-0 text-emerald-600 dark:text-emerald-500 hover:underline"
            >
              View {selectedOption && selectedPath !== '/' ? 'folder' : 'environment'}
              <FaExternalLinkAlt className="text-[9px]" />
            </a>
          )}
        </div>
      )}
    </div>
  )
}
