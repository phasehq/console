'use client'

import { Fragment, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { usePathname, useRouter } from 'next/navigation'
import { Popover, Transition } from '@headlessui/react'
import { Reorder } from 'framer-motion'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { FaChevronUp, FaLayerGroup } from 'react-icons/fa'
import { FaCircle } from 'react-icons/fa6'
import { ApiOrganisationPlanChoices, EnvironmentType } from '@/apollo/graphql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { UpdateEnvOrder } from '@/graphql/mutations/environments/updateEnvironmentOrder.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { getContrastingTextColor, stringToHexColor } from '@/utils/copy'
import { CreateEnvironmentDialog } from '@/components/environments/CreateEnvironmentDialog'
import { ManageEnvironmentDialog } from '@/components/environments/ManageEnvironmentDialog'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { filterEnvSelection, useEnvSelection } from './EnvSelectionProvider'

// transition-colors only: a blanket `transition` would also ease `transform`
// and fight the framer-motion drag transforms. Active and inactive tabs share
// the same font weight so activation never changes the text width.
const TAB_BASE_STYLE =
  'flex items-center gap-2 px-3 h-8 text-xs font-medium cursor-pointer select-none whitespace-nowrap border-r border-neutral-500/20 border-t transition-colors ease'

const tabStyle = (active: boolean) =>
  clsx(
    TAB_BASE_STYLE,
    active
      ? 'bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white border-t-emerald-500'
      : 'text-neutral-500 hover:text-black dark:hover:text-white hover:bg-zinc-100/60 dark:hover:bg-zinc-800/60 border-t-transparent'
  )

/**
 * Multi-select checklist for the envs shown in the cross-env view, attached
 * to the "All Environments" tab. Opens upward from the bottom bar.
 */
const EnvSelectionMenu = ({ environments }: { environments: EnvironmentType[] }) => {
  const { selectedEnvIds, setSelection } = useEnvSelection()

  const shownIds = filterEnvSelection(environments, selectedEnvIds).map((env) => env.id)
  const selectionActive = shownIds.length < environments.length

  const handleToggle = (envId: string) => {
    let next: string[]
    if (shownIds.includes(envId)) {
      if (shownIds.length === 1) return // at least one env stays shown
      next = shownIds.filter((id) => id !== envId)
    } else {
      next = [...shownIds, envId]
    }
    // A full selection means "all" so newly created envs show up automatically
    setSelection(next.length === environments.length ? null : next)
  }

  return (
    <Popover className="relative self-stretch flex items-center" onClick={(e) => e.stopPropagation()}>
      {({ open }) => (
        <>
          <Popover.Button
            className="p-1 -mr-1.5 rounded-md text-neutral-500 hover:text-black dark:hover:text-white hover:bg-zinc-300/50 dark:hover:bg-zinc-700/50 focus:outline-none"
            title="Choose environments to show"
          >
            <FaChevronUp
              className={clsx('text-2xs transition-transform ease', open && 'rotate-180')}
            />
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
            <Popover.Panel className="absolute bottom-9 left-0 z-30 w-max min-w-48 origin-bottom-left rounded-md bg-neutral-200 dark:bg-neutral-800 shadow-lg ring-1 ring-inset ring-neutral-500/40 p-2">
              <div className="flex items-center justify-between gap-6 px-2 pb-2 border-b border-neutral-500/20">
                <span className="text-2xs font-medium uppercase tracking-wide text-neutral-500">
                  Environments shown
                </span>
                <button
                  type="button"
                  className="text-2xs text-emerald-500 hover:text-emerald-400 disabled:opacity-0"
                  disabled={!selectionActive}
                  onClick={() => setSelection(null)}
                >
                  Show all
                </button>
              </div>
              <div className="flex flex-col max-h-64 overflow-y-auto py-1">
                {environments.map((env) => {
                  const isShown = shownIds.includes(env.id)
                  const isLastShown = isShown && shownIds.length === 1
                  return (
                    // A div, not a button: the ToggleSwitch renders its own
                    // button and buttons can't nest
                    <div
                      key={env.id}
                      onClick={() => handleToggle(env.id)}
                      className={clsx(
                        'flex items-center justify-between gap-6 p-2 rounded-md hover:bg-zinc-300/50 dark:hover:bg-zinc-700/50 text-xs text-zinc-900 dark:text-zinc-100 text-left',
                        isLastShown ? 'cursor-not-allowed' : 'cursor-pointer'
                      )}
                      title={
                        isLastShown ? 'At least one environment must be shown' : undefined
                      }
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FaCircle
                          className="text-[8px] shrink-0"
                          style={{ color: env.color || stringToHexColor(env.name) }}
                          aria-hidden="true"
                        />
                        <span className="truncate max-w-[24ch]">{env.name}</span>
                      </div>
                      <ToggleSwitch
                        value={isShown}
                        onToggle={() => handleToggle(env.id)}
                        disabled={isLastShown}
                        size="sm"
                      />
                    </div>
                  )
                })}
              </div>
              <div className="px-2 pt-2 text-2xs text-neutral-500 border-t border-neutral-500/20">
                Tip: Alt + Click an environment tab to toggle it here
              </div>
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  )
}

const EnvTab = memo(function EnvTab({
  env,
  isActive,
  href,
  allowReordering,
  isDragging,
  compareSelected,
  onDragStart,
  onDragEnd,
  onNavigate,
  onToggleCompare,
}: {
  env: EnvironmentType
  isActive: boolean
  href: string
  allowReordering: boolean
  isDragging: boolean
  /** true/false when a manual env selection is active, undefined when all
   *  envs are shown (no indicator) */
  compareSelected?: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onNavigate: (href: string) => void
  onToggleCompare: (envId: string) => void
}) {
  // Explicit env color, or a name-derived default for legacy envs (same scheme as role labels)
  const envColor = env.color || stringToHexColor(env.name)
  const activeTextColor = getContrastingTextColor(envColor)

  return (
    <Reorder.Item
      value={env}
      as="div"
      // Animate layout (position only) while a drag is in progress; otherwise
      // snap. Tab switching changes tab widths (the manage cog mounts on the
      // active tab) and animating that during a route transition stutters.
      layout="position"
      transition={isDragging ? undefined : { duration: 0 }}
      drag={allowReordering ? 'x' : false}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      role="tab"
      aria-selected={isActive}
      className={clsx(tabStyle(isActive), 'bg-clip-padding')}
      // The ACTIVE tab is fully painted in the env's color with contrast-
      // appropriate text (inline styles override the zinc classes from
      // tabStyle); inactive tabs keep the standard style plus the color dot.
      style={
        isActive
          ? {
              borderTopColor: envColor,
              backgroundColor: envColor,
              color: activeTextColor,
            }
          : undefined
      }
      onClick={(e: React.MouseEvent) => {
        if (e.altKey) {
          e.preventDefault()
          onToggleCompare(env.id)
        } else {
          onNavigate(href)
        }
      }}
      title={`${env.name}: ${env.secretCount} secrets, ${env.folderCount} folders — Alt+Click to toggle in the All Environments view`}
    >
      <FaCircle
        className={clsx(
          'text-[6px] shrink-0 transition-opacity ease',
          compareSelected === false && 'opacity-30'
        )}
        // The env-colored dot would vanish on the active tab's solid env
        // color, so it takes the contrasting text color there
        style={{ color: isActive ? activeTextColor : envColor }}
        title={
          compareSelected === undefined
            ? undefined
            : compareSelected
              ? 'Shown in the All Environments view'
              : 'Hidden in the All Environments view'
        }
      />
      <span className="max-w-[16ch] truncate">{env.name}</span>
      <span
        className="text-2xs text-neutral-500 font-normal"
        style={isActive ? { color: activeTextColor, opacity: 0.7 } : undefined}
      >
        {env.secretCount}
      </span>
      {isActive && (
        <div onClick={(e) => e.stopPropagation()} className="-mr-1.5">
          <ManageEnvironmentDialog environment={env} buttonVariant="ghost" />
        </div>
      )}
    </Reorder.Item>
  )
})

/**
 * Excel-style environment tabs pinned to the bottom of the app secrets views.
 * The leftmost tab is the cross-env overview; one tab per environment follows.
 * Tab switching preserves the current folder path across views.
 */
export const EnvTabBar = ({ team, app }: { team: string; app: string }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const pathname = usePathname()
  const router = useRouter()

  const { selectedEnvIds, toggleEnv } = useEnvSelection()

  const userCanReadEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'read',
    true
  )
  const userCanCreateEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'create',
    true
  )
  const userCanUpdateEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'update',
    true
  )

  const { data, loading } = useQuery(GetAppEnvironments, {
    variables: { appId: app },
    skip: !userCanReadEnvironments,
  })
  const environments: EnvironmentType[] = useMemo(() => data?.appEnvironments ?? [], [data])

  const shownIds = useMemo(
    () => filterEnvSelection(environments, selectedEnvIds).map((env) => env.id),
    [environments, selectedEnvIds]
  )
  const selectionActive = environments.length > 0 && shownIds.length < environments.length

  const allowReordering =
    organisation?.plan !== ApiOrganisationPlanChoices.Fr &&
    userCanUpdateEnvironments &&
    environments.length > 1

  const [updateEnvOrder] = useMutation(UpdateEnvOrder)

  // Local order so drag reordering is instant; synced from the server list
  // except mid-drag. `isDragging` drives rendering (layout animations);
  // dragRef holds the event-timing flags that must not trigger renders: the
  // sync-effect guard and the synthetic post-drag click swallow.
  const [localOrder, setLocalOrder] = useState<EnvironmentType[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef({ active: false, suppressClick: false })

  useEffect(() => {
    if (!dragRef.current.active) setLocalOrder(environments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Parse the current route: /[team]/apps/[app]/environments/[envId]/[...path]
  // or /[team]/apps/[app]/[...path] for the cross-env overview.
  const segments = (pathname ?? '').split('/').filter(Boolean).slice(3)
  const activeEnvId = segments[0] === 'environments' ? (segments[1] ?? null) : null
  const pathSegments = segments[0] === 'environments' ? segments.slice(2) : segments
  const pathSuffix = pathSegments.length > 0 ? `/${pathSegments.join('/')}` : ''

  const basePath = `/${team}/apps/${app}`

  const handleNavigate = useCallback(
    (href: string) => {
      // Swallow the synthetic click that fires when a drag ends on a tab
      if (dragRef.current.suppressClick) return
      router.push(href)
    },
    [router]
  )

  const handleDragStart = useCallback(() => {
    dragRef.current = { active: true, suppressClick: true }
    setIsDragging(true)
  }, [])

  const handleDragEnd = useCallback(async () => {
    dragRef.current.active = false
    setIsDragging(false)
    // The post-drag click fires synchronously after pointerup; clear the flag
    // afterwards so subsequent clicks on any tab navigate normally.
    setTimeout(() => {
      dragRef.current.suppressClick = false
    }, 0)

    const serverIds = environments.map((env) => env.id)
    const localIds = localOrder.map((env) => env.id)
    if (serverIds.join() === localIds.join()) return
    try {
      await updateEnvOrder({
        variables: { appId: app, environmentOrder: localIds },
        refetchQueries: [{ query: GetAppEnvironments, variables: { appId: app } }],
        awaitRefetchQueries: true,
      })
    } catch (e) {
      toast.error('Failed to update environment order')
      setLocalOrder(environments)
    }
  }, [app, environments, localOrder, updateEnvOrder])

  if (!userCanReadEnvironments) return null

  return (
    // Auto-height bar: with a content-driven height, a classic horizontal
    // scrollbar on the tab strip ADDS its thickness below the tabs instead of
    // overlaying them — no reserved dead space when there's no overflow.
    // (CSS scrollbar-gutter only applies to vertical scrollbars.)
    <div className="shrink-0 flex items-start border-t border-neutral-500/20 bg-zinc-200 dark:bg-zinc-900 px-3 sm:px-4 lg:px-6 shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.3)] dark:shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.6)]">
      {/* Outside the scrolling strip so it stays visible and its menu can
          escape upward (overflow-x-auto would clip the popover panel) */}
      <div
        role="tab"
        aria-selected={activeEnvId === null}
        className={clsx(tabStyle(activeEnvId === null), 'border-l border-l-neutral-500/20 shrink-0')}
        onClick={() => handleNavigate(`${basePath}${pathSuffix}`)}
        title={
          selectionActive
            ? `Showing ${shownIds.length} of ${environments.length} environments`
            : 'View secrets across all environments'
        }
      >
        <FaLayerGroup className="shrink-0" />
        All Environments
        {selectionActive && (
          <span className="text-2xs text-emerald-500 font-normal">
            {shownIds.length}/{environments.length}
          </span>
        )}
        {environments.length > 1 && <EnvSelectionMenu environments={environments} />}
      </div>

      <div className="flex items-start overflow-x-auto overflow-y-hidden min-w-0 [scrollbar-width:thin]">
        {environments.length === 0 ? (
          loading ? (
            <div className="flex items-center gap-1 px-2">
              {[...Array(3)].map((_, i) => (
                <div
                  key={`env-tab-skeleton-${i}`}
                  className="h-5 w-20 my-2 rounded-sm bg-zinc-300 dark:bg-zinc-700 animate-pulse"
                />
              ))}
            </div>
          ) : null
        ) : (
          <Reorder.Group
            as="div"
            axis="x"
            values={localOrder}
            onReorder={setLocalOrder}
            // framer-motion's Reorder.Group types don't accept className
            style={{ display: 'flex', alignItems: 'flex-start' }}
          >
            {localOrder.map((env) => (
              <EnvTab
                key={env.id}
                env={env}
                isActive={env.id === activeEnvId}
                href={`${basePath}/environments/${env.id}${pathSuffix}`}
                allowReordering={allowReordering}
                isDragging={isDragging}
                compareSelected={selectionActive ? shownIds.includes(env.id) : undefined}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onNavigate={handleNavigate}
                onToggleCompare={toggleEnv}
              />
            ))}
          </Reorder.Group>
        )}
      </div>

      {userCanCreateEnvironments && (
        <div className="pl-1 shrink-0 h-8 flex items-center">
          <CreateEnvironmentDialog appId={app} compact />
        </div>
      )}
    </div>
  )
}
