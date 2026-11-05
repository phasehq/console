'use client'

// Connectors are SVG curves between anchor points measured from the DOM.

import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CreateConnectionDialog } from '@/components/agents/AgentConnectionDialogs'
import {
  ComponentProps,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { IconType } from 'react-icons'
import {
  FaChevronDown,
  FaChevronRight,
  FaCog,
  FaExclamationTriangle,
  FaKey,
  FaLock,
  FaPlug,
  FaRobot,
  FaSearch,
  FaTimesCircle,
} from 'react-icons/fa'
import { FaArrowRotateLeft } from 'react-icons/fa6'
import { Popover } from '@headlessui/react'
import { agentsPath } from '@/utils/agents/routes'
import {
  GENERIC_MARK,
  MONOCHROME_MARK,
  agentHarnessMeta,
  agentServiceMeta,
} from '@/components/agents/AgentBrandIcons'
import { CreateAgentDialog, MintAgentTokenDialog } from '@/components/agents/AgentDialogs'
import { Button } from '@/components/common/Button'
import { Checkbox } from '@/components/common/Checkbox'
import {
  AgentBadge,
  AgentRequestDeadline,
  AgentRequestKindIcon,
  AgentRequestReviewLink,
  agentCardSurface,
  formatAgentDate,
  humanizeAgentValue,
} from '@/components/agents/AgentUI'
import { agentRequestKindLabel, isAgentActive } from '@/components/agents/AgentEnums'
import {
  byRequestDeadline,
  chipMeshModel,
  filterMeshModel,
  meshEdgePath,
  meshFilterOptions,
  meshFocusKeys,
  meshNodeKey,
  meshPendingRequestCount,
  pendingMeshModel,
  meshRelativeAge,
  type MeshAgentNode,
  type MeshConnectionNode,
  type MeshEdge,
  type MeshModel,
  type MeshPoint,
  type MeshRequestChip,
} from '@/components/agents/AgentMeshUtils'

type ServiceTemplates = ComponentProps<typeof CreateConnectionDialog>['services']

export type AgentMeshPermissions = {
  canCreateAgent: boolean
  canReadConnections: boolean
  canCreateConnection: boolean
}

const edgeStrokeClass = (_edge: MeshEdge) => 'stroke-emerald-500'

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

const edgeTitle = (edge: MeshEdge) => plural(edge.grantCount, 'grant')

type MeasuredEdge = { edge: MeshEdge; path: string; from: MeshPoint; to: MeshPoint }

type MeasuredRequestEdge = {
  requestKey: string
  fromKey: string
  toKey: string
  /** The Workflow already has this grant: drawn solid, not dotted. */
  granted: boolean
  path: string
  from: MeshPoint
  to: MeshPoint
}

type FocusHandler = (nodeKey: string | null) => void

function MeshColumn({
  title,
  count,
  total,
  action,
  width,
  children,
}: {
  title: string
  count: number
  /** All cards in the column, shown while a filter hides some. */
  total: number
  action?: ReactNode
  width: string
  children: ReactNode
}) {
  return (
    <div data-mesh-column className={clsx('shrink-0 space-y-4', width)}>
      <div className="flex min-h-[38px] items-center justify-between gap-2">
        <h3 className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {title}
          <span
            className="ml-1.5 rounded-full bg-neutral-500/10 px-1.5 py-0.5 text-2xs normal-case"
            title={count === total ? undefined : `${count} of ${total} shown`}
          >
            {count === total ? count : `${count}/${total}`}
          </span>
        </h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function MeshPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-500/30 p-4 text-center text-xs text-neutral-500">
      {children}
    </div>
  )
}

function MeshCard({
  nodeKey,
  registerNode,
  dimmed,
  onFocus,
  attention = false,
  className,
  children,
}: {
  nodeKey: string
  registerNode: (key: string) => (element: HTMLElement | null) => void
  dimmed: boolean
  onFocus: FocusHandler
  /** Outline the card in amber when something on it waits on the user. */
  attention?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      ref={registerNode(nodeKey)}
      data-mesh-node={nodeKey}
      onMouseEnter={() => onFocus(nodeKey)}
      onMouseLeave={() => onFocus(null)}
      onFocusCapture={() => onFocus(nodeKey)}
      onBlurCapture={() => onFocus(null)}
      className={clsx(
        agentCardSurface(attention && 'attention'),
        'transition-opacity duration-150',
        dimmed ? 'opacity-30' : 'opacity-100',
        className
      )}
    >
      {children}
    </div>
  )
}

function CardIcon({
  icon: Icon,
  colorClass,
  tone,
  label,
}: {
  icon: IconType
  /** Brand color for the mark itself; the tile stays neutral. */
  colorClass?: string
  tone?: 'amber'
  /** Names the mark for screen readers and on hover when no text repeats it. */
  label?: string
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      title={label}
      className={clsx(
        'grid size-9 shrink-0 place-items-center rounded-lg text-base',
        tone === 'amber'
          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          : 'bg-neutral-500/10 text-zinc-700 dark:text-zinc-300'
      )}
    >
      <Icon aria-hidden="true" className={tone ? undefined : colorClass} />
    </span>
  )
}

function CardCogLink({ href, title }: { href: string; title: string }) {
  return (
    <Link
      href={href}
      title={title}
      className="rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-500/10 hover:text-zinc-900 dark:hover:text-zinc-100"
    >
      <FaCog />
    </Link>
  )
}

/** A Connection's pending request, named by the Agent that asked. */
type ConnectionRequest = MeshRequestChip & { agentName: string }

/** At the top of the card, since each request is actionable and expires. */
function PendingRequests<T extends MeshRequestChip>({
  name,
  requests,
  path,
  homeKey,
  team,
  now,
  onFocus,
  focus,
}: {
  name: string
  requests: T[]
  /** The two names each row shows, either side of a chevron. */
  path: (request: T) => [string, string]
  /** The card's own node, focused again when the pointer leaves a row. */
  homeKey: string
  team: string
  now: number
  onFocus: FocusHandler
  focus: Set<string> | null
}) {
  const visibleRequests = requests.slice(0, 3)
  const hiddenCount = requests.length - visibleRequests.length

  return (
    <section
      aria-label={`Pending requests for ${name}`}
      className="border-t border-amber-500/30 bg-amber-500/10 px-3 py-2.5"
    >
      <h4 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <FaExclamationTriangle aria-hidden="true" />
        {plural(requests.length, 'pending request')}
      </h4>
      <ul className="mt-1.5 divide-y divide-amber-500/25">
        {visibleRequests.map((request) => (
          <li
            key={request.id}
            data-mesh-request={request.id}
            onMouseEnter={() => onFocus(meshNodeKey.request(request.id))}
            onMouseLeave={() => onFocus(homeKey)}
            onFocusCapture={() => onFocus(meshNodeKey.request(request.id))}
            className={clsx(
              'flex items-center justify-between gap-2 py-2 transition-opacity duration-150 first:pt-0 last:pb-0',
              focus && !focus.has(meshNodeKey.request(request.id)) && 'opacity-40'
            )}
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                <AgentRequestKindIcon kind={request.kind} />
                <span className="truncate">
                  {path(request)[0]}
                  <FaChevronRight
                    aria-hidden="true"
                    className="mx-1 inline size-2 text-neutral-500"
                  />
                  {path(request)[1]}
                </span>
              </div>
              <div className="truncate text-2xs text-amber-800 dark:text-amber-300">
                {agentRequestKindLabel(request.kind)} ·{' '}
                <AgentRequestDeadline request={request} now={now} />
              </div>
            </div>
            <AgentRequestReviewLink team={team} requestId={request.id} />
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <Link
          href={agentsPath(team, 'requests')}
          className="mt-2 block text-2xs font-medium text-amber-700 hover:underline dark:text-amber-400"
        >
          View all {requests.length} requests
        </Link>
      )}
    </section>
  )
}

function AgentCard({
  agent,
  team,
  focus,
  onFocus,
  registerNode,
  now,
  requestWorkflowId,
}: {
  agent: MeshAgentNode
  team: string
  focus: Set<string> | null
  onFocus: FocusHandler
  registerNode: (key: string) => (element: HTMLElement | null) => void
  now: number
  requestWorkflowId?: string | null
}) {
  const agentKey = meshNodeKey.agent(agent.id)
  const dimmed = !!focus && !focus.has(agentKey)
  const harness = agentHarnessMeta(agent.harnessType)

  return (
    <MeshCard
      nodeKey={agentKey}
      registerNode={registerNode}
      dimmed={dimmed}
      onFocus={onFocus}
      attention={agent.pendingRequests.length > 0}
    >
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <CardIcon icon={harness.Icon} colorClass={harness.iconClass} />
          <div className="min-w-0">
            <Link
              href={agentsPath(team, agent.id)}
              className="block truncate text-sm font-semibold hover:text-emerald-500"
            >
              {agent.name}
            </Link>
            <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-neutral-500">
              <span
                aria-hidden="true"
                className={clsx(
                  'size-1.5 rounded-full',
                  isAgentActive(agent.status) ? 'bg-emerald-500' : 'bg-red-500'
                )}
              />
              <span className="truncate">{harness.label}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <CardCogLink href={agentsPath(team, agent.id)} title="Manage Agent" />
        </div>
      </div>
      <div className="px-3 pb-2.5 text-2xs text-neutral-500">
        {plural(agent.activeSessionCount, 'active session')} ·{' '}
        {agent.lastSeenAt ? (
          <span title={formatAgentDate(agent.lastSeenAt)}>
            Last active {meshRelativeAge(agent.lastSeenAt, now, 'long')}
          </span>
        ) : (
          'Never active'
        )}
      </div>
      {agent.pendingRequests.length > 0 && (
        <PendingRequests
          name={agent.name}
          requests={agent.pendingRequests}
          path={(request) => [request.workflowName, request.targetLabel]}
          homeKey={meshNodeKey.agent(agent.id)}
          team={team}
          now={now}
          onFocus={onFocus}
          // The whole card already dims when it is out of scope.
          focus={dimmed ? null : focus}
        />
      )}
      <div className="border-t border-neutral-500/10 px-3 pb-3 pt-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h4 className="text-2xs font-medium uppercase tracking-wider text-neutral-500">
            Workflows
          </h4>
          {/* The negative margin keeps the button from adding height to the row. */}
          {agent.canMintToken && agent.workflows.length > 0 && (
            <div className="-my-1.5">
              <MintAgentTokenDialog
                agentId={agent.id}
                workflows={agent.workflows}
                harnessType={agent.harnessType}
                triggerVariant="ghost"
              />
            </div>
          )}
        </div>
        {agent.workflows.length > 0 ? (
          <ul className="divide-y divide-neutral-500/10 rounded-lg border border-neutral-500/15 bg-neutral-500/5">
            {agent.workflows.map((workflow) => {
              const workflowKey = meshNodeKey.workflow(workflow.id)
              const workflowDimmed = !dimmed && !!focus && !focus.has(workflowKey)
              return (
                <li
                  key={workflow.id}
                  ref={registerNode(workflowKey)}
                  data-mesh-node={workflowKey}
                  onMouseEnter={() => onFocus(workflowKey)}
                  onMouseLeave={() => onFocus(agentKey)}
                  className={clsx(
                    'flex items-center justify-between gap-2 px-2.5 py-1 text-xs transition duration-150',
                    workflowDimmed && 'opacity-30',
                    requestWorkflowId === workflow.id && 'bg-amber-500/15'
                  )}
                >
                  <span className="truncate font-medium">{workflow.name}</span>
                  <span className="shrink-0 text-2xs text-neutral-500">
                    {workflow.grantCount ? plural(workflow.grantCount, 'grant') : 'No grants'}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-2xs text-neutral-500">
            No Workflows yet. Manage this Agent to create one.
          </p>
        )}
      </div>
    </MeshCard>
  )
}

function ConnectionCard({
  connection,
  team,
  focus,
  onFocus,
  registerNode,
  canReadConnections,
  requests,
  now,
  requested = false,
}: {
  connection: MeshConnectionNode
  team: string
  focus: Set<string> | null
  onFocus: FocusHandler
  registerNode: (key: string) => (element: HTMLElement | null) => void
  canReadConnections: boolean
  requests: ConnectionRequest[]
  now: number
  /** Named by the request being hovered. */
  requested?: boolean
}) {
  const connectionKey = meshNodeKey.connection(connection.id)
  const dimmed = !!focus && !focus.has(connectionKey)
  const service = agentServiceMeta(connection.serviceType)

  return (
    <MeshCard
      nodeKey={connectionKey}
      registerNode={registerNode}
      dimmed={dimmed}
      onFocus={onFocus}
      attention={requested || requests.length > 0}
    >
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <CardIcon icon={service.Icon} colorClass={service.iconClass} label={service.label} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{connection.name}</div>
            {connection.fromGrantOnly && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <AgentBadge>Limited view</AgentBadge>
              </div>
            )}
          </div>
        </div>
        {canReadConnections && (
          <CardCogLink href={agentsPath(team, 'connections')} title="Manage connections" />
        )}
      </div>
      {requests.length > 0 && (
        <PendingRequests
          name={connection.name}
          requests={requests}
          path={(request) => [request.agentName, request.workflowName]}
          homeKey={connectionKey}
          team={team}
          now={now}
          onFocus={onFocus}
          focus={dimmed ? null : focus}
        />
      )}
      <div className="space-y-1.5 border-t border-neutral-500/10 px-3 py-2.5">
        <div className="text-2xs font-medium uppercase tracking-wider text-neutral-500">
          Integration credentials
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
            <FaKey aria-hidden="true" className="shrink-0 text-neutral-500" />
            <span className="truncate">
              {connection.authentication?.name || 'Credentials needed'}
            </span>
          </span>
          <AgentBadge tone={connection.state?.toLowerCase() === 'active' ? 'green' : 'amber'}>
            {humanizeAgentValue(connection.state || 'pending_credentials')}
          </AgentBadge>
        </div>
        {connection.authentication?.provider?.name && (
          <p className="text-2xs text-neutral-500">{connection.authentication.provider.name}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-500/10 px-3 py-2">
        <span className="whitespace-nowrap text-2xs text-neutral-500">
          {plural(connection.workflowCount, 'workflow')}
        </span>
      </div>
    </MeshCard>
  )
}

/** On a filled chip a black mark would vanish, so marks without a brand colour take the text colour. */
const markOnFill = (iconClass?: string) =>
  iconClass === MONOCHROME_MARK || iconClass === GENERIC_MARK ? undefined : iconClass

/** A filter toggle: the primary Button while on (warning for pending requests), secondary while off. */
function FilterChip({
  label,
  count,
  icon: Icon,
  iconClass,
  active,
  variant = 'primary',
  onToggle,
}: {
  label: string
  count: number
  icon: IconType
  iconClass?: string
  active: boolean
  variant?: 'primary' | 'warning'
  onToggle: () => void
}) {
  return (
    <Button
      variant={active ? variant : 'secondary'}
      aria-pressed={active}
      onClick={onToggle}
      classString="shrink-0"
    >
      <Icon
        aria-hidden="true"
        className={clsx('size-3.5 shrink-0', active ? markOnFill(iconClass) : iconClass)}
      />
      {label}
      <span className="ml-0.5 tabular-nums opacity-70">{count}</span>
    </Button>
  )
}

type FilterGroupOption = {
  value: string
  count: number
  label: string
  Icon: IconType
  iconClass?: string
}

// More options than this fold into one dropdown, so the toolbar stays short.
const CHIP_LIMIT = 3

function FilterGroup({
  title,
  icon: GroupIcon,
  options,
  selected,
  onToggle,
  onReset,
}: {
  title: string
  icon: IconType
  options: FilterGroupOption[]
  selected: Set<string>
  onToggle: (value: string) => void
  onReset: () => void
}) {
  if (options.length <= CHIP_LIMIT)
    return (
      <div className="flex flex-wrap items-center gap-2">
        {options.map((option) => (
          <FilterChip
            key={option.value}
            label={option.label}
            count={option.count}
            icon={option.Icon}
            iconClass={option.iconClass}
            active={selected.has(option.value)}
            onToggle={() => onToggle(option.value)}
          />
        ))}
      </div>
    )

  const chosen = options.filter((option) => selected.has(option.value))
  const TriggerIcon = chosen[0]?.Icon || GroupIcon
  const count = (text: string) => <span className="ml-1.5 tabular-nums opacity-70">{text}</span>
  return (
    <Popover className="relative">
      {/* Headless UI sets data-focus for keyboard focus only, so a click shows no outline. */}
      <Popover.Button
        as={Button}
        variant={chosen.length > 0 ? 'primary' : 'secondary'}
        classString={clsx(
          'shrink-0 outline-none data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-offset-2 data-[focus]:outline-emerald-500',
          // While open with nothing chosen, it keeps the secondary hover colour.
          chosen.length === 0 && 'data-[open]:bg-zinc-200 dark:data-[open]:bg-zinc-800'
        )}
      >
        <TriggerIcon
          aria-hidden="true"
          className={clsx('size-3.5 shrink-0', markOnFill(chosen[0]?.iconClass))}
        />
        {/* Every label it can show sits invisibly in one grid cell, so choosing never resizes it. */}
        <span className="grid text-left">
          {[title, ...options.map((option) => option.label)].map((label, index) => (
            <span key={index} aria-hidden="true" className="invisible col-start-1 row-start-1">
              {label}
              {index > 0 && count(`+${options.length - 1}`)}
            </span>
          ))}
          <span className="col-start-1 row-start-1">
            {chosen[0]?.label || title}
            {chosen.length > 1 && count(`+${chosen.length - 1}`)}
          </span>
        </span>
        <FaChevronDown aria-hidden="true" className="ml-0.5 size-2.5 shrink-0 opacity-70" />
      </Popover.Button>
      {/* The app's menu surface. */}
      <Popover.Panel className="absolute left-0 z-30 mt-1 w-60 rounded-md bg-zinc-100 p-1 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none dark:bg-zinc-800">
        <div role="group" aria-label={title} className="max-h-64 overflow-y-auto">
          {options.map((option) => (
            // A label, so a click anywhere on the row toggles its checkbox.
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-neutral-500/10"
            >
              <option.Icon
                aria-hidden="true"
                className={clsx('size-3.5 shrink-0', option.iconClass)}
              />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{option.label}</span>
              <span className="text-2xs tabular-nums text-neutral-500">{option.count}</span>
              <Checkbox
                size="sm"
                checked={selected.has(option.value)}
                onChange={() => onToggle(option.value)}
              />
            </label>
          ))}
        </div>
        {/* As in the logs filter menu: always shown, so the panel keeps its height. */}
        <div className="mt-1 flex justify-end border-t border-neutral-500/20 pt-1.5">
          <Button
            variant="outline"
            icon={FaArrowRotateLeft}
            disabled={chosen.length === 0}
            onClick={onReset}
          >
            Reset filter
          </Button>
        </div>
      </Popover.Panel>
    </Popover>
  )
}

/** Adds or removes one chip's value. */
const toggled = (values: Set<string>, value: string) => {
  const next = new Set(values)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export function AgentMesh({
  organisationId,
  team,
  model,
  services,
  permissions,
  onGraphChange,
}: {
  organisationId: string
  team: string
  model: MeshModel
  services: ServiceTemplates
  permissions: AgentMeshPermissions
  onGraphChange: () => void
}) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const nodeRefs = useRef(new Map<string, HTMLElement>())
  const refCallbacks = useRef(new Map<string, (element: HTMLElement | null) => void>())
  const [measuredEdges, setMeasuredEdges] = useState<MeasuredEdge[]>([])
  const [measuredRequestEdges, setMeasuredRequestEdges] = useState<MeasuredRequestEdge[]>([])
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pendingOnly, setPendingOnly] = useState(false)
  const [harnessFilter, setHarnessFilter] = useState<Set<string>>(new Set())
  const [serviceFilter, setServiceFilter] = useState<Set<string>>(new Set())
  const harnessOptions = useMemo(
    () => meshFilterOptions(model.agents.map((agent) => agent.harnessType)),
    [model]
  )
  const serviceOptions = useMemo(
    () => meshFilterOptions(model.connections.map((connection) => connection.serviceType)),
    [model]
  )
  // A choice whose chip has gone, as the cards changed, stops filtering.
  const harnessTypes = useMemo(
    () =>
      new Set(harnessOptions.map(({ value }) => value).filter((value) => harnessFilter.has(value))),
    [harnessFilter, harnessOptions]
  )
  const serviceTypes = useMemo(
    () =>
      new Set(serviceOptions.map(({ value }) => value).filter((value) => serviceFilter.has(value))),
    [serviceFilter, serviceOptions]
  )
  const now = Date.now()
  const pendingCount = useMemo(() => meshPendingRequestCount(model), [model])
  const showPendingOnly = pendingOnly && pendingCount > 0

  // Once the last request is resolved, the filter has nothing left to show.
  useEffect(() => {
    if (!pendingCount) setPendingOnly(false)
  }, [pendingCount])

  // Chips count as filters too, so an empty column never reads as "none yet" while filtered.
  const chipsActive = showPendingOnly || harnessTypes.size > 0 || serviceTypes.size > 0
  const resetFilters = () => {
    setQuery('')
    setPendingOnly(false)
    setHarnessFilter(new Set())
    setServiceFilter(new Set())
  }
  const noMatch = (cards: string) => (
    <MeshPlaceholder>
      No {cards} match {chipsActive ? 'these filters' : 'this search'}.
      <div className="mt-1">
        <Button variant="text" icon={FaArrowRotateLeft} onClick={resetFilters}>
          {chipsActive ? 'Reset filters' : 'Clear search'}
        </Button>
      </div>
    </MeshPlaceholder>
  )

  const visibleModel = useMemo(() => {
    const chipped = chipMeshModel(filterMeshModel(model, query), harnessTypes, serviceTypes)
    return showPendingOnly ? pendingMeshModel(chipped) : chipped
  }, [harnessTypes, model, query, serviceTypes, showPendingOnly])

  const focus = useMemo(
    () => (focusKey ? meshFocusKeys(visibleModel, focusKey) : null),
    [focusKey, visibleModel]
  )

  const registerNode = useCallback((key: string) => {
    let callback = refCallbacks.current.get(key)
    if (!callback) {
      callback = (element: HTMLElement | null) => {
        if (element) nodeRefs.current.set(key, element)
        else nodeRefs.current.delete(key)
      }
      refCallbacks.current.set(key, callback)
    }
    return callback
  }, [])

  const measure = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const anchors = (fromKey: string, toKey: string) => {
      const fromElement = nodeRefs.current.get(fromKey)
      const toElement = nodeRefs.current.get(toKey)
      if (!fromElement || !toElement) return null
      const fromRect = fromElement.getBoundingClientRect()
      const toRect = toElement.getBoundingClientRect()
      const from = {
        x: fromRect.right - containerRect.left,
        y: fromRect.top + fromRect.height / 2 - containerRect.top,
      }
      const to = {
        x: toRect.left - containerRect.left,
        y: toRect.top + toRect.height / 2 - containerRect.top,
      }
      return { from, to, path: meshEdgePath(from, to) }
    }
    const next: MeasuredEdge[] = []
    for (const edge of visibleModel.edges) {
      const measured = anchors(edge.fromKey, edge.toKey)
      if (measured) next.push({ edge, ...measured })
    }
    const nextRequests: MeasuredRequestEdge[] = []
    for (const request of visibleModel.agents.flatMap((agent) => agent.pendingRequests)) {
      if (!request.workflowId || !request.connectionId) continue
      const fromKey = meshNodeKey.workflow(request.workflowId)
      const toKey = meshNodeKey.connection(request.connectionId)
      const measured = anchors(fromKey, toKey)
      if (!measured) continue
      nextRequests.push({
        requestKey: meshNodeKey.request(request.id),
        fromKey,
        toKey,
        granted: visibleModel.edges.some(
          (edge) => edge.fromKey === fromKey && edge.toKey === toKey
        ),
        ...measured,
      })
    }
    const samePaths = <T extends { path: string }>(previous: T[], latest: T[]) =>
      previous.length === latest.length &&
      previous.every((entry, index) => entry.path === latest[index].path)
    setMeasuredEdges((previous) => (samePaths(previous, next) ? previous : next))
    setMeasuredRequestEdges((previous) =>
      samePaths(previous, nextRequests) ? previous : nextRequests
    )
  }, [visibleModel])

  // Each Connection lists the requests asking for it, from every Agent.
  const requestsByConnection = useMemo(() => {
    const byConnection = new Map<string, ConnectionRequest[]>()
    for (const agent of model.agents) {
      for (const request of agent.pendingRequests) {
        if (!request.connectionId) continue
        byConnection.set(request.connectionId, [
          ...(byConnection.get(request.connectionId) || []),
          { ...request, agentName: agent.name },
        ])
      }
    }
    for (const requests of byConnection.values()) requests.sort(byRequestDeadline)
    return byConnection
  }, [model])
  const hoveredRequest = useMemo(
    () =>
      focusKey?.startsWith('request:')
        ? visibleModel.agents
            .flatMap((agent) => agent.pendingRequests)
            .find(({ id }) => meshNodeKey.request(id) === focusKey)
        : undefined,
    [focusKey, visibleModel]
  )
  const shownRequestEdges = measuredRequestEdges.filter(
    ({ requestKey }) => showPendingOnly || focus?.has(requestKey)
  )
  // A request on an existing grant is drawn in amber over its green line.
  const reviewedGrants = new Set(
    shownRequestEdges
      .filter(({ granted }) => granted)
      .map(({ fromKey, toKey }) => `${fromKey}>${toKey}`)
  )

  useLayoutEffect(() => {
    measure()
    const container = containerRef.current
    if (!container) return
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
    observer?.observe(container)
    container.querySelectorAll('[data-mesh-column]').forEach((column) => observer?.observe(column))
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  return (
    <div className="space-y-4">
      {/* The chips sit beside the search while they fit, and drop to their own row when not. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex w-full max-w-sm items-center rounded-md bg-zinc-100 px-2 dark:bg-zinc-800">
          <FaSearch className="text-neutral-500" aria-hidden="true" />
          <input
            aria-label="Search the canvas"
            placeholder="Search Agents or Connections"
            className="custom w-full bg-transparent placeholder:text-neutral-500"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            aria-label="Clear canvas search"
            onClick={() => setQuery('')}
            className={clsx(
              'text-neutral-500 transition-opacity',
              query ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
          >
            <FaTimesCircle />
          </button>
        </div>
        {/* Wider gaps set the harness, Connection type and pending groups apart. */}
        <div
          role="group"
          aria-label="Filter the canvas"
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          {harnessOptions.length > 0 && (
            <FilterGroup
              title="Harness"
              icon={FaRobot}
              options={harnessOptions.map(({ value, count }) => {
                const { label, Icon, iconClass } = agentHarnessMeta(value)
                return { value, count, label, Icon, iconClass }
              })}
              selected={harnessTypes}
              onToggle={(value) => setHarnessFilter((current) => toggled(current, value))}
              onReset={() => setHarnessFilter(new Set())}
            />
          )}
          {serviceOptions.length > 0 && (
            <FilterGroup
              title="Connection type"
              icon={FaPlug}
              options={serviceOptions.map(({ value, count }) => {
                const { label, Icon, iconClass } = agentServiceMeta(value)
                return { value, count, label, Icon, iconClass }
              })}
              selected={serviceTypes}
              onToggle={(value) => setServiceFilter((current) => toggled(current, value))}
              onReset={() => setServiceFilter(new Set())}
            />
          )}
          {pendingCount > 0 && (
            <FilterChip
              label="Pending requests"
              count={pendingCount}
              icon={FaExclamationTriangle}
              iconClass={showPendingOnly ? undefined : 'text-amber-500'}
              active={showPendingOnly}
              variant="warning"
              onToggle={() => setPendingOnly((current) => !current)}
            />
          )}
        </div>
      </div>
      <div className="overflow-x-auto pb-4">
        {/* w-max + min-w-full: the pegboard always wraps its columns, so
            horizontal scrolling never lets cards slide off the dotted
            background on narrow screens. */}
        <div
          ref={containerRef}
          className="relative min-h-[480px] w-max min-w-full rounded-xl border border-neutral-500/10 bg-[radial-gradient(circle,rgba(113,113,122,0.18)_1px,transparent_1px)] p-6 [background-size:22px_22px]"
        >
          {/* CSS-sized (not width/height attributes from scrollWidth): an
              attribute-sized svg would inflate the board's scrollable area
              and ratchet it wider/taller than the visible pegboard. */}
          <svg
            aria-hidden="true"
            data-mesh-edges
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {measuredEdges.map(({ edge, path, from, to }) => {
              const inFocus = !focus || (focus.has(edge.fromKey) && focus.has(edge.toKey))
              if (reviewedGrants.has(`${edge.fromKey}>${edge.toKey}`)) return null
              return (
                <g
                  key={edge.key}
                  className={clsx(
                    'transition-opacity duration-150',
                    inFocus ? 'opacity-80' : 'opacity-10'
                  )}
                >
                  <path
                    d={path}
                    fill="none"
                    strokeWidth={focus && inFocus ? 2 : 1.5}
                    strokeDasharray={edge.dashed ? '6 4' : undefined}
                    className={edgeStrokeClass(edge)}
                  >
                    <title>{edgeTitle(edge)}</title>
                  </path>
                  <circle
                    cx={from.x}
                    cy={from.y}
                    r={3}
                    className="fill-neutral-400 dark:fill-neutral-500"
                  />
                  <circle
                    cx={to.x}
                    cy={to.y}
                    r={3}
                    className="fill-neutral-400 dark:fill-neutral-500"
                  />
                </g>
              )
            })}
            {/* Solid: the grant exists. Dotted: approving adds it. */}
            {shownRequestEdges.map(({ requestKey, granted, path, from, to }) => (
              <g
                key={requestKey}
                className={clsx(
                  'transition-opacity duration-150',
                  !focus || focus.has(requestKey) ? 'opacity-90' : 'opacity-10'
                )}
              >
                <path
                  d={path}
                  fill="none"
                  strokeWidth={focusKey === requestKey ? 2.5 : 2}
                  strokeLinecap="round"
                  strokeDasharray={granted ? undefined : '2 6'}
                  className="stroke-amber-500"
                />
                <circle cx={from.x} cy={from.y} r={3.5} className="fill-amber-500" />
                <circle cx={to.x} cy={to.y} r={3.5} className="fill-amber-500" />
              </g>
            ))}
          </svg>
          <div className="relative flex items-start">
            <MeshColumn
              title="Agents"
              count={visibleModel.agents.length}
              total={model.agents.length}
              width="w-[340px]"
              action={
                permissions.canCreateAgent ? (
                  <CreateAgentDialog
                    organisationId={organisationId}
                    onCreated={(agentId) => router.push(agentsPath(team, agentId))}
                  />
                ) : undefined
              }
            >
              {visibleModel.agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  team={team}
                  focus={focus}
                  onFocus={setFocusKey}
                  registerNode={registerNode}
                  now={now}
                  requestWorkflowId={hoveredRequest?.workflowId}
                />
              ))}
              {visibleModel.agents.length === 0 &&
                (model.agents.length === 0 ? (
                  <MeshPlaceholder>
                    No Agents yet. Create an Agent to start building the graph.
                  </MeshPlaceholder>
                ) : (
                  noMatch('Agents')
                ))}
            </MeshColumn>
            {/* Spare width goes to the gutter, so connectors can fan out. */}
            <div aria-hidden="true" className="w-20 max-w-[30rem] shrink-0 grow" />
            <MeshColumn
              title="Connections"
              count={visibleModel.connections.length}
              total={model.connections.length}
              width="w-[320px]"
              action={
                permissions.canCreateConnection ? (
                  <CreateConnectionDialog organisationId={organisationId} services={services} />
                ) : undefined
              }
            >
              {visibleModel.connections.map((connection) => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  team={team}
                  focus={focus}
                  onFocus={setFocusKey}
                  registerNode={registerNode}
                  canReadConnections={permissions.canReadConnections}
                  requests={requestsByConnection.get(connection.id) || []}
                  now={now}
                  requested={hoveredRequest?.connectionId === connection.id}
                />
              ))}
              {visibleModel.connections.length === 0 &&
                (permissions.canReadConnections ? (
                  model.connections.length === 0 ? (
                    <MeshPlaceholder>
                      No Connections yet. Create one to define a trusted service endpoint for your
                      Agents.
                    </MeshPlaceholder>
                  ) : (
                    noMatch('Connections')
                  )
                ) : (
                  <MeshPlaceholder>
                    <FaLock className="mx-auto mb-1" aria-hidden="true" />
                    Connections are restricted for your role.
                  </MeshPlaceholder>
                ))}
            </MeshColumn>
          </div>
        </div>
      </div>
    </div>
  )
}
