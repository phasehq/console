import clsx from 'clsx'
import Link from 'next/link'
import { agentHarnessMeta } from '@/components/agents/AgentBrandIcons'
import { agentsPath } from '@/utils/agents/routes'

export type SecretEventAgent = {
  id: string
  name: string
  harnessType: string
  deleted: boolean
}

/**
 * An Agent as the actor of a secret event. A deleted Agent keeps its name, struck through
 * and unlinked, as a deleted service account does.
 */
export function AgentActor({
  agent,
  team,
  className,
}: {
  agent: SecretEventAgent
  /** The organisation's name in the URL; without it the name is not a link. */
  team?: string
  className?: string
}) {
  const { Icon, iconClass } = agentHarnessMeta(agent.harnessType || 'other')
  const name = (
    <span className={clsx('min-w-0 truncate', agent.deleted && 'line-through')}>{agent.name}</span>
  )
  return (
    <span
      className={clsx('flex min-w-0 items-center gap-1', agent.deleted && 'grayscale', className)}
      title={`Agent ${agent.name}`}
    >
      <Icon aria-hidden="true" className={clsx('size-4 shrink-0', iconClass)} />
      {team && !agent.deleted ? (
        <Link
          href={agentsPath(team, agent.id)}
          className="min-w-0 truncate hover:text-emerald-500"
          onClick={(event) => event.stopPropagation()}
        >
          {agent.name}
        </Link>
      ) : (
        name
      )}
      {agent.deleted && (
        <span className="whitespace-nowrap font-normal text-neutral-500">(Deleted)</span>
      )}
    </span>
  )
}
