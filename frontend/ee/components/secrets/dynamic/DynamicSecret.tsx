import { DynamicSecretType } from '@/apollo/graphql'
import { DeleteDynamicSecretDialog } from '@/ee/components/secrets/dynamic/DeleteDynamicSecretDialog'
import { ManageLeasesDialog } from '@/ee/components/secrets/dynamic/ManageLeasesDialog'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import Link from 'next/link'
import { useContext } from 'react'
import { FaExternalLinkAlt } from 'react-icons/fa'

export const DynamicSecret = ({ secret }: { secret: DynamicSecretType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  return (
    <div className="p-2 ring-1 ring-inset ring-neutral-400/20 flex flex-col gap-4 w-full rounded-lg group justify-between bg-zinc-100 dark:bg-zinc-800">
      <div>
        <div className="font-mono text-neutral-500 text-xs">{secret.path}</div>
        <div>
          <div className="text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-1 px-1">
            <ProviderIcon providerId={secret.provider} /> {secret.name}
          </div>
          <div className="text-sm text-neutral-500 px-1">{secret.description}</div>
        </div>
      </div>

      <div className="relative group flex items-center justify-between w-full">
        <div className="flex h-full items-center justify-start gap-4 opacity-0 group-hover:opacity-100 transition ease">
          {/* <CreateLeaseDialog secret={secret} /> */}
          <ManageLeasesDialog secret={secret} />
        </div>
        <div className="flex h-full items-center justify-end gap-4 opacity-0 group-hover:opacity-100 transition ease">
          {/* <DeleteDynamicSecretDialog secret={secret} /> */}
          <Link
            href={`/${organisation?.name}/apps/${secret.environment.app.id}/environments/${secret.environment.id}${secret.path}?secret=${secret.id}`}
            title="View this secret"
          >
            <Button variant="ghost">
              <span className="py-1">
                <FaExternalLinkAlt />
              </span>
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
