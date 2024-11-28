import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { UpgradeRequestForm } from '@/components/forms/UpgradeRequestForm'
import { organisationContext } from '@/contexts/organisationContext'
import { GetOrganisationPlan } from '@/graphql/queries/organisation/getOrganisationPlan.gql'
import { isCloudHosted } from '@/utils/appConfig'
import { useQuery } from '@apollo/client'
import { ReactNode, useContext } from 'react'
import dynamic from 'next/dynamic'

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

  // Dynamically import ProUpgradeDialog only if the app is cloud-hosted
  const ProUpgradeDialog = isCloudHosted()
    ? dynamic(() => import('@/ee/billing/ProUpgradeDialog'))
    : null

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
            ProUpgradeDialog && <ProUpgradeDialog userCount={data.organisationPlan.seatsUsed.total} />
          )
        ) : (
          <div className="text-zinc-900 dark:text-zinc-100">
            Please contact us at{' '}
            <a href="mailto:info@phase.dev" className="text-emerald-500 hover:text-emerald-600">
              info@phase.dev
            </a>{' '}
            or get in touch via{' '}
            <a
              href="https://slack.phase.dev"
              className="text-emerald-500 hover:text-emerald-600"
              target="_blank"
              rel="noreferrer"
            >
              Slack
            </a>{' '}
            to request an upgrade.
          </div>
        )}
      </div>
    </GenericDialog>
  )
}
