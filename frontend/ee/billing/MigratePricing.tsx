import { useRef, useContext } from 'react'
import GenericDialog from '@/components/common/GenericDialog'
import { useMutation } from '@apollo/client'
import { MigratePricing } from '@/graphql/mutations/billing/migratePricing.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { FaExchangeAlt, FaExternalLinkAlt } from 'react-icons/fa'
import { Alert } from '@/components/common/Alert'

export const MigratePricingDialog = () => {
  const { activeOrganisation } = useContext(organisationContext)
  const [migratePricing, { loading }] = useMutation(MigratePricing)
  const dialogRef = useRef<any>(null)

  // Only show for V1 pricing orgs
  if (activeOrganisation?.pricingVersion !== 1) return null

  const handleMigration = async () => {
    try {
      const { data } = await migratePricing({
        variables: {
          organisationId: activeOrganisation.id,
        },
        refetchQueries: [{ query: GetOrganisations }],
      })

      if (data?.migratePricing?.success) {
        toast.success('Successfully migrated to new pricing model')
        dialogRef.current?.closeModal()
      } else {
        toast.error(data?.migratePricing?.message || 'Migration failed')
      }
    } catch (error) {
      toast.error('An error occurred during migration')
    }
  }

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        title="Migrate Pricing Model"
        buttonVariant="primary"
        buttonContent={
          <div className="flex items-center gap-2">
            <FaExchangeAlt /> Migrate Pricing
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-zinc-600 dark:text-zinc-400 text-sm">
            We have updated our pricing to a simpler, linear model with a flat pricing structure.
            Migrating will switch your organization to the new pricing structure. You can learn more
            on our{' '}
            <a
              href="https://phase.dev/pricing"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-500 hover:text-emerald-400 font-medium underline inline-flex items-center gap-1"
            >
              pricing page <FaExternalLinkAlt className="text-xs" />
            </a>
            .
          </p>

          <ul className="list-disc list-inside space-y-2 text-zinc-600 dark:text-zinc-400 ml-2 text-sm">
            <li>Your organisation will be switched to a flat-price, per-user billing model</li>
            <li>Service Accounts are no longer counted as billable seats</li>
            <li>New per-user prices will apply. Please see our pricing page for more details.</li>
          </ul>

          <Alert variant="warning" icon size="sm">
            This action cannot be undone
          </Alert>

          <div className="pt-4 flex justify-end gap-2">
            <Button variant="primary" isLoading={loading} onClick={handleMigration}>
              <FaExchangeAlt />
              Confirm Migration
            </Button>
          </div>
        </div>
      </GenericDialog>
    </>
  )
}
