'use client'

/**
 * Agents Overview mesh: a connected-cards canvas that shows the whole
 * Agent → Workflow → Connection grant graph at once, with
 * pending Agent requests attached to the agent that raised them.
 *
 * Cards are laid out in two columns; SVG bezier connectors are drawn
 * between DOM-measured anchor points. Hovering a card spotlights it and its
 * direct neighbours. Additive actions (create Agent/Workflow/Connection,
 * mint a workflow token) reuse the existing Agent dialogs in place; management
 * and destructive actions link out to the dedicated tab pages.
 */

import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CreateConnectionDialog } from '@/components/agents/AgentConnectionDialogs'
import {
  ComponentProps,
  ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { IconType } from 'react-icons'
import {
  FaChevronRight,
  FaCog,
  FaExclamationTriangle,
  FaKey,
  FaLock,
  FaPlug,
  FaSearch,
  FaTimesCircle,
} from 'react-icons/fa'
import { agentsPath } from '@/utils/agents/routes'
import { agentHarnessMeta, agentServiceMeta } from '@/components/agents/AgentBrandIcons'
import { CreateAgentDialog, MintAgentTokenDialog } from '@/components/agents/AgentDialogs'
import { Button } from '@/components/common/Button'
import {
  AgentBadge,
  AgentTime,
  agentCardSurface,
  formatAgentDate,
  humanizeAgentValue,
} from '@/components/agents/AgentUI'
import { agentRequestKindLabel, isAgentActive } from '@/components/agents/AgentEnums'
import {
  filterMeshModel,
  meshEdgePath,
  meshFocusKeys,
  meshNodeKey,
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

type FocusHandler = (nodeKey: string | null) => void

function MeshColumn({
  title,
  count,
  action,
  width,
  children,
}: {
  title: string
  count: number
  action?: ReactNode
  width: string
  children: ReactNode
}) {
  return (
    <div data-mesh-column className={clsx('shrink-0 space-y-4', width)}>
      <div className="flex min-h-[38px] items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {title}
          <span className="ml-1.5 rounded-full bg-neutral-500/10 px-1.5 py-0.5 text-2xs">
            {count}
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
}: {
  icon: IconType
  /** Brand color for the mark itself; the tile stays neutral. */
  colorClass?: string
  tone?: 'amber'
}) {
  return (
    <span
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

const HOUR = 60 * 60 * 1000

/** "Expires in 3 days", in red during its last day; a full timestamp on hover. */
function RequestDeadline({ request, now }: { request: MeshRequestChip; now: number }) {
  const deadline = Date.parse(request.expiresAt || '')
  if (Number.isNaN(deadline))
    return (
      <>
        Requested <AgentTime value={request.createdAt} />
      </>
    )
  if (deadline <= now)
    return (
      <>
        Expired <AgentTime value={request.expiresAt} />
      </>
    )
  return (
    <span
      className={clsx(deadline - now < 24 * HOUR && 'font-semibold text-red-600 dark:text-red-400')}
    >
      Expires <AgentTime value={request.expiresAt} />
    </span>
  )
}

/**
 * Pending requests sit at the top of the card, in full: each one is actionable
 * and expires, so it should be seen before the Workflows.
 */
function PendingRequests({
  agent,
  team,
  now,
}: {
  agent: MeshAgentNode
  team: string
  now: number
}) {
  const visibleRequests = agent.pendingRequests.slice(0, 3)
  const hiddenCount = agent.pendingRequests.length - visibleRequests.length

  return (
    <section
      aria-label={`Pending requests for ${agent.name}`}
      className="border-t border-amber-500/30 bg-amber-500/10 px-3 py-2.5"
    >
      <h4 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <FaExclamationTriangle aria-hidden="true" />
        {plural(agent.pendingRequests.length, 'pending request')}
      </h4>
      <ul className="mt-1.5 space-y-2">
        {visibleRequests.map((request) => (
          <li key={request.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                <span className="shrink-0 text-amber-600 dark:text-amber-400">
                  {request.kind === 'CREDENTIAL_UPDATE' ? (
                    <FaKey aria-hidden="true" />
                  ) : (
                    <FaPlug aria-hidden="true" />
                  )}
                </span>
                <span className="truncate">
                  {request.workflowName}
                  <FaChevronRight
                    aria-hidden="true"
                    className="mx-1 inline size-2 text-neutral-500"
                  />
                  {request.targetLabel}
                </span>
              </div>
              <div className="truncate text-2xs text-amber-800 dark:text-amber-300">
                {agentRequestKindLabel(request.kind)} ·{' '}
                <RequestDeadline request={request} now={now} />
              </div>
            </div>
            <Link
              href={`${agentsPath(team, 'requests')}?request=${request.id}`}
              className="shrink-0"
            >
              <Button variant="warning">Review</Button>
            </Link>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <Link
          href={agentsPath(team, 'requests')}
          className="mt-2 block text-2xs font-medium text-amber-700 hover:underline dark:text-amber-400"
        >
          View all {agent.pendingRequests.length} requests
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
}: {
  agent: MeshAgentNode
  team: string
  focus: Set<string> | null
  onFocus: FocusHandler
  registerNode: (key: string) => (element: HTMLElement | null) => void
  now: number
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
      {agent.pendingRequests.length > 0 && <PendingRequests agent={agent} team={team} now={now} />}
      <div className="border-t border-neutral-500/10 px-3 pb-3 pt-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h4 className="text-2xs font-medium uppercase tracking-wider text-neutral-500">
            Workflows
          </h4>
          {/* One token action per Agent; the dialog picks the Workflow, Default first.
              The negative margin keeps the button from adding height to the row. */}
          {agent.canMintToken && agent.workflows.length > 0 && (
            <div className="-my-1.5">
              <MintAgentTokenDialog
                agentId={agent.id}
                workflows={agent.workflows}
                harnessType={agent.harnessType}
                triggerVariant="ghost"
                triggerContent={
                  <>
                    <FaKey aria-hidden="true" /> Generate token
                  </>
                }
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
                    'flex items-center justify-between gap-2 px-2.5 py-1 text-xs transition-opacity duration-150',
                    workflowDimmed && 'opacity-30'
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
}: {
  connection: MeshConnectionNode
  team: string
  focus: Set<string> | null
  onFocus: FocusHandler
  registerNode: (key: string) => (element: HTMLElement | null) => void
  canReadConnections: boolean
}) {
  const connectionKey = meshNodeKey.connection(connection.id)
  const dimmed = !!focus && !focus.has(connectionKey)
  const service = agentServiceMeta(connection.serviceType)

  return (
    <MeshCard nodeKey={connectionKey} registerNode={registerNode} dimmed={dimmed} onFocus={onFocus}>
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <CardIcon icon={service.Icon} colorClass={service.iconClass} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{connection.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <AgentBadge tone="blue">{service.label}</AgentBadge>
              {connection.fromGrantOnly && <AgentBadge>Limited view</AgentBadge>}
            </div>
          </div>
        </div>
        {canReadConnections && (
          <CardCogLink href={agentsPath(team, 'connections')} title="Manage connections" />
        )}
      </div>
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
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const now = Date.now()

  const visibleModel = useMemo(() => filterMeshModel(model, query), [model, query])

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
    const next: MeasuredEdge[] = []
    for (const edge of visibleModel.edges) {
      const fromElement = nodeRefs.current.get(edge.fromKey)
      const toElement = nodeRefs.current.get(edge.toKey)
      if (!fromElement || !toElement) continue
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
      next.push({ edge, from, to, path: meshEdgePath(from, to) })
    }
    setMeasuredEdges((previous) =>
      previous.length === next.length &&
      previous.every((entry, index) => entry.path === next[index].path)
        ? previous
        : next
    )
  }, [visibleModel])

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
          </svg>
          <div className="relative flex items-start">
            <MeshColumn
              title="Agents"
              count={visibleModel.agents.length}
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
                />
              ))}
              {visibleModel.agents.length === 0 && (
                <MeshPlaceholder>
                  {query
                    ? 'No Agents match this search.'
                    : 'No Agents yet. Create an Agent to start building the graph.'}
                </MeshPlaceholder>
              )}
            </MeshColumn>
            {/* The gutter takes the board's spare width, up to a cap, so connectors
                have room to fan out instead of bunching between the columns. */}
            <div aria-hidden="true" className="w-20 max-w-[30rem] shrink-0 grow" />
            <MeshColumn
              title="Connections"
              count={visibleModel.connections.length}
              width="w-[300px]"
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
                />
              ))}
              {visibleModel.connections.length === 0 &&
                (permissions.canReadConnections ? (
                  <MeshPlaceholder>
                    {query
                      ? 'No Connections match this search.'
                      : 'No Connections yet. Create one to define a trusted service endpoint for your Agents.'}
                  </MeshPlaceholder>
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
