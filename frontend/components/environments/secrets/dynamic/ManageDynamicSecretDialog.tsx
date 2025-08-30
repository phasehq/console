import { DynamicSecretLeaseType, DynamicSecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { GetDynamicSecretLeases } from '@/graphql/queries/secrets/dynamic/getSecretLeases.gql'
import { useQuery } from '@apollo/client'
import { useContext, useRef, useState } from 'react'
import { FaAngleDoubleDown, FaAngleDoubleUp, FaCog } from 'react-icons/fa'
import { LeaseCard } from './LeaseCard'
import { FiRefreshCw } from 'react-icons/fi'
import { FaListCheck } from 'react-icons/fa6'
import { CreateLeaseDialog } from './CreateLeaseDialog'
import { EmptyState } from '@/components/common/EmptyState'

export const ManageDynamicSecretDialog = ({ secret }: { secret: DynamicSecretType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ closeModal: () => void; isOpen: boolean }>(null)

  const { data, refetch, loading } = useQuery(GetDynamicSecretLeases, {
    variables: { secretId: secret.id, orgId: organisation?.id },
    skip: !organisation,
    notifyOnNetworkStatusChange: true,
  })

  const handleRefetch = async () => await refetch()

  const [viewLimit, setViewLimit] = useState(10)

  const resetViewLimit = () => setViewLimit(10)
  const removeViewLimit = () => setViewLimit(0)

  const leases: DynamicSecretLeaseType[] = data?.dynamicSecrets[0].leases ?? []

  return (
    <GenericDialog
      ref={dialogRef}
      size="lg"
      buttonVariant="secondary"
      buttonContent={
        <>
          <FaListCheck /> Leases
        </>
      }
      title="View and manage leases"
    >
      <div className="space-y-6">
        <div className="text-neutral-500 ">
          Manage leases and configuration for this dynamic secret
        </div>
        <div className="flex items-center justify-between border-b border-neutral-500/40">
          <div>
            <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Leases</div>
            <div className="text-neutral-500 text-sm">Manage leases for this dynamic secret</div>
          </div>
          <Button variant="ghost" onClick={handleRefetch} icon={FiRefreshCw} isLoading={loading}>
            Refresh
          </Button>
        </div>
        <div className="divide-y divide-neutral-500/20 max-h-[80vh] overflow-y-auto">
          {leases.slice(0, viewLimit === 0 ? undefined : viewLimit).map((lease) => (
            <LeaseCard key={lease.id} secret={secret} lease={lease} />
          ))}

          {leases.length > 10 && (
            <div className="flex items-center justify-center py-2">
              <Button
                onClick={viewLimit === 0 ? resetViewLimit : removeViewLimit}
                variant="ghost"
                icon={viewLimit === 0 ? FaAngleDoubleUp : FaAngleDoubleDown}
              >
                {viewLimit === 0 ? 'Show less' : 'Show more'}
              </Button>
            </div>
          )}
        </div>

        {leases.length === 0 && (
          <EmptyState
            title="No leases"
            subtitle="There are no leases for this dynamic secret."
            graphic={
              <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                <FaListCheck />
              </div>
            }
          >
            <CreateLeaseDialog secret={secret} />
          </EmptyState>
        )}
      </div>
    </GenericDialog>
  )
}
