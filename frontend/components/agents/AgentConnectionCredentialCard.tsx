import Link from 'next/link'
import { FaArrowRight } from 'react-icons/fa'
import {
  integrationCredentialHref,
  type IntegrationCredentialSummary,
} from '@/utils/integrationCredentials'

const CredentialSummary = ({
  credential,
  showAction = false,
}: {
  credential?: IntegrationCredentialSummary | null
  showAction?: boolean
}) => (
  <>
    <div className="min-w-0">
      <p className="text-2xs font-medium uppercase tracking-wider text-neutral-500">
        Integration credentials
      </p>
      <p className="mt-1 truncate text-sm font-medium">
        {credential?.name || 'Credentials needed'}
      </p>
      {credential?.provider?.name && (
        <p className="mt-0.5 truncate text-xs text-neutral-500">{credential.provider.name}</p>
      )}
    </div>
    {credential && showAction && (
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 opacity-100 transition-opacity dark:text-emerald-400 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">
        View credential
        <FaArrowRight aria-hidden="true" />
      </span>
    )}
  </>
)

export const AgentConnectionCredentialCard = ({
  credential,
  team,
  canView,
}: {
  credential?: IntegrationCredentialSummary | null
  team: string
  canView: boolean
}) => {
  if (credential && canView)
    return (
      <Link
        href={integrationCredentialHref(team, credential)}
        aria-label={`View credential ${credential.name}`}
        className="group mt-3 flex items-center justify-between gap-3 rounded-lg border border-neutral-500/20 p-3 transition hover:border-emerald-500/40 hover:bg-emerald-500/[0.035] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <CredentialSummary credential={credential} showAction />
      </Link>
    )

  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-neutral-500/20 p-3">
      <CredentialSummary credential={credential} />
    </div>
  )
}
