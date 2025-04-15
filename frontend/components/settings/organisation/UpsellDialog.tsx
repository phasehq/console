import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { UpgradeRequestForm } from '@/components/forms/UpgradeRequestForm'
import { organisationContext } from '@/contexts/organisationContext'
import { GetOrganisationPlan } from '@/graphql/queries/organisation/getOrganisationPlan.gql'
import { isCloudHosted } from '@/utils/appConfig'
import { useQuery } from '@apollo/client'
import { ReactNode, useContext, useRef, forwardRef, useImperativeHandle } from 'react'
import dynamic from 'next/dynamic'

export const UpsellDialog = forwardRef(
  (
    {
      title,
      buttonLabel,
      buttonVariant,
      showButton = true,
    }: {
      title?: string
      buttonLabel?: ReactNode
      buttonVariant?: 'primary' | 'secondary' | 'outline' | 'danger'
      showButton?: boolean
    },
    ref
  ) => {
    const { activeOrganisation } = useContext(organisationContext)

    const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

    const closeModal = () => dialogRef?.current?.closeModal()

    // Dynamically import ProUpgradeDialog only if the app is cloud-hosted
    const ProUpgradeDialog = isCloudHosted()
      ? dynamic(() => import('@/ee/billing/ProUpgradeDialog'))
      : null

    const { data, loading } = useQuery(GetOrganisationPlan, {
      variables: { organisationId: activeOrganisation?.id },
      skip: !activeOrganisation,
      fetchPolicy: 'cache-and-network',
    })

    useImperativeHandle(ref, () => ({
      openModal: dialogRef.current?.openModal,
    }))

    if (!activeOrganisation || loading) return <></>

    return (
      <>
        <GenericDialog
          title={
            title ||
            `Upgrade to ${activeOrganisation.plan === ApiOrganisationPlanChoices.Fr ? 'Pro' : 'Enterprise'}`
          }
          buttonVariant={buttonVariant || 'primary'}
          buttonContent={showButton ? buttonLabel || 'Upgrade' : undefined}
          size="sm"
          onClose={() => {}}
          ref={dialogRef}
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
                ProUpgradeDialog && (
                  <ProUpgradeDialog
                    userCount={data.organisationPlan?.seatsUsed?.total}
                    onSuccess={closeModal}
                  />
                )
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
      </>
    )
  }
)

UpsellDialog.displayName = 'UpsellDialog'

export default UpsellDialog
