import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { UpgradeRequestForm } from '@/components/forms/UpgradeRequestForm'
import { organisationContext } from '@/contexts/organisationContext'
import { ProUpgradeDialog } from '@/ee/billing/ProUpgradeDialog'
import { GetOrganisationPlan } from '@/graphql/queries/organisation/getOrganisationPlan.gql'
import { isCloudHosted } from '@/utils/appConfig'
import { useQuery } from '@apollo/client'
import { ReactNode, useContext } from 'react'

export const UpsellDialog = ({
  title,
  buttonLabel,
  buttonVariant,
}: {
  title?: string
  buttonLabel?: ReactNode
  buttonVariant?: 'primary' | 'secondary' | 'outline' | 'danger'
}) => {
  const { activeOrganisation } = useContext(organisationContext)

  const { data, loading } = useQuery(GetOrganisationPlan, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !activeOrganisation,
    fetchPolicy: 'cache-and-network',
  })

  if (!activeOrganisation || loading) return <></>

  return (
    <GenericDialog
      title={
        title ||
        `Upgrade to ${activeOrganisation.plan === ApiOrganisationPlanChoices.Fr ? 'Pro' : 'Enterprise'}`
      }
      buttonVariant={buttonVariant || 'primary'}
      buttonContent={buttonLabel || 'Upgrade'}
      size="sm"
      onClose={() => {}}
    >
      <div className="space-y-4">
        <div className="text-neutral-500">
          Get access to all the features in Phase{' '}
          {activeOrganisation.plan === ApiOrganisationPlanChoices.Fr ? 'Pro' : 'Enterprise'}
        </div>
        {isCloudHosted() ? (
          activeOrganisation.plan === ApiOrganisationPlanChoices.Pr ? (
            <UpgradeRequestForm onSuccess={() => {}} />
          ) : (
            <ProUpgradeDialog userCount={data.organisationPlan.userCount} />
          )
        ) : (
          <div>
            Please contact us at{' '}
            <a href="mailto:info@phase.dev" className="text-emerald-500">
              info@phase.dev
            </a>{' '}
            to request an upgrade.
          </div>
        )}
      </div>
    </GenericDialog>
  )
}
