import clsx from 'clsx'
import Link from 'next/link'
import { ReactNode } from 'react'
import {
  FaCheckCircle,
  FaCubes,
  FaProjectDiagram,
  FaRobot,
  FaTimesCircle,
  FaUsers,
} from 'react-icons/fa'
import { BsListColumnsReverse } from 'react-icons/bs'
import { FaPeopleGroup } from 'react-icons/fa6'
import { OrgSummary } from '@/utils/dashboard'

const StatTile = (props: {
  label: string
  /** undefined while loading, null when the viewer can't read it */
  value?: number | null
  detail?: ReactNode
  href: string
  icon: ReactNode
  alert?: boolean
}) => {
  const { label, value, detail, href, icon, alert } = props

  return (
    <Link
      href={href}
      className={clsx(
        'group flex min-w-0 flex-col gap-1 rounded-lg bg-zinc-100 p-3 ring-1 ring-inset transition-colors dark:bg-zinc-800/40 sm:p-4',
        alert
          ? 'ring-red-500/40 hover:ring-red-500/60'
          : 'ring-neutral-500/20 hover:ring-neutral-500/40'
      )}
    >
      <div className="flex items-center justify-between gap-2 text-2xs font-medium text-neutral-500">
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-sm transition-colors group-hover:text-emerald-500">
          {icon}
        </span>
      </div>
      <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
        {value === undefined ? (
          <span className="inline-block h-7 w-10 animate-pulse rounded bg-neutral-500/10 align-middle" />
        ) : value === null ? (
          <span className="text-neutral-500">–</span>
        ) : (
          value.toLocaleString()
        )}
      </div>
      <div className="truncate text-2xs text-neutral-500">{detail ?? '\u00a0'}</div>
    </Link>
  )
}

export const StatTiles = (props: {
  team: string
  summary?: OrgSummary | null
  members?: number | null
  pendingInvites?: number
  serviceAccounts?: number | null
  serviceAccountsWithAccess?: number
  teams?: number
  teamMembers?: number
}) => {
  const {
    team,
    summary,
    members,
    pendingInvites,
    serviceAccounts,
    serviceAccountsWithAccess,
    teams,
    teamMembers,
  } = props
  const syncs = summary?.syncs

  return (
    <div
      className={clsx(
        'grid grid-cols-2 gap-3 sm:grid-cols-3',
        teams === undefined ? 'min-[1360px]:grid-cols-5' : 'min-[1360px]:grid-cols-6'
      )}
    >
      <StatTile
        label="Apps"
        value={summary === null ? null : summary?.apps}
        icon={<FaCubes />}
        href={`/${team}/apps`}
        detail={summary && `${summary.appsWithSyncs} with syncs`}
      />
      <StatTile
        label="Environments"
        value={summary === null ? null : summary?.environments}
        icon={<BsListColumnsReverse />}
        href={`/${team}/apps`}
        detail={summary && `Across ${summary.apps} ${summary.apps === 1 ? 'app' : 'apps'}`}
      />
      <StatTile
        label="Syncs"
        value={summary === null ? null : syncs?.total}
        icon={<FaProjectDiagram />}
        href={`/${team}/integrations/syncs`}
        alert={!!syncs?.failing}
        detail={
          syncs &&
          (syncs.total === 0 ? (
            'No syncs set up yet'
          ) : syncs.failing > 0 ? (
            <span className="inline-flex items-center gap-1 text-red-500">
              <FaTimesCircle /> {syncs.failing} failing
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <FaCheckCircle className="text-emerald-500" /> All synced
            </span>
          ))
        }
      />
      <StatTile
        label="Members"
        value={members}
        icon={<FaUsers />}
        href={`/${team}/access/members`}
        detail={
          pendingInvites
            ? `${pendingInvites} pending ${pendingInvites === 1 ? 'invite' : 'invites'}`
            : undefined
        }
      />
      <StatTile
        label="Service accounts"
        value={serviceAccounts}
        icon={<FaRobot />}
        href={`/${team}/access/service-accounts`}
        detail={
          serviceAccountsWithAccess !== undefined
            ? `${serviceAccountsWithAccess} with app access`
            : undefined
        }
      />
      {teams !== undefined && (
        <StatTile
          label="Teams"
          value={teams}
          icon={<FaPeopleGroup />}
          href={`/${team}/access/teams`}
          detail={teamMembers !== undefined ? `${teamMembers} members` : undefined}
        />
      )}
    </div>
  )
}
