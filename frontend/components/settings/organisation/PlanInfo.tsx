import ProgressBar from '@/components/common/ProgressBar'
import { organisationContext } from '@/contexts/organisationContext'
import { GetOrganisationPlan } from '@/graphql/queries/organisation/getOrganisationPlan.gql'
import { useQuery } from '@apollo/client'
import { useContext } from 'react'
import { PlanLabel } from './PlanLabel'
import Spinner from '@/components/common/Spinner'
import { calculatePercentage } from '@/utils/dataUnits'
import { Button } from '@/components/common/Button'
import { FaCubes, FaUsersCog } from 'react-icons/fa'
import Link from 'next/link'
import GenericDialog from '@/components/common/GenericDialog'
import { UpgradeRequestForm } from '@/components/forms/UpgradeRequestForm'
import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { isCloudHosted } from '@/utils/appConfig'

export const PlanInfo = () => {
  const { activeOrganisation } = useContext(organisationContext)

  const { loading, data } = useQuery(GetOrganisationPlan, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !activeOrganisation,
    fetchPolicy: 'cache-and-network',
  })

  const appQuotaUsage = data
    ? calculatePercentage(data.apps.length, data.organisationPlan.maxApps)
    : 0

  const memberQuotaUsage = data
    ? calculatePercentage(data.organisationMembers.length, data.organisationPlan.maxUsers)
    : 0

  const progressBarColor = (value: number, maxValue: number) =>
    value >= maxValue ? 'bg-red-500' : value === maxValue - 1 ? 'bg-amber-500' : 'bg-sky-500'

  if (loading || !activeOrganisation)
    return (
      <div className="flex items-center justify-center p-40 mx-auto">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="space-y-6 py-4 divide-y divide-neutral-500/20">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="font-semibold text-4xl">{activeOrganisation.name}</div>
          <PlanLabel plan={activeOrganisation.plan} />
        </div>
        {activeOrganisation.plan !== ApiOrganisationPlanChoices.En && (
          <div className="flex items-center">
            <GenericDialog
              title="Request an Upgrade"
              buttonVariant="secondary"
              buttonContent={'Upgrade'}
              onClose={() => {}}
            >
              <div className="space-y-2">
                <div className="text-neutral-500">Request an upgrade to your account.</div>
                {isCloudHosted() ? (
                  <UpgradeRequestForm onSuccess={() => {}} />
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
          </div>
        )}
      </div>

      <div className="space-y-10 py-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-lg font-medium text-black dark:text-white">Apps</div>
            <div className="text-neutral-500">{`${data.apps.length} of ${data.organisationPlan.maxApps || '∞'} Apps used`}</div>
          </div>
          {activeOrganisation.plan === ApiOrganisationPlanChoices.Fr && (
            <ProgressBar
              percentage={appQuotaUsage}
              color={progressBarColor(data.apps.length, data.organisationPlan.maxApps)}
              size="sm"
            />
          )}
          <div className="flex justify-start">
            <Link href={`/${activeOrganisation.name}/apps`}>
              <Button variant="secondary">
                <FaCubes /> Manage
              </Button>
            </Link>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-lg font-medium text-black dark:text-white">Members</div>
            <div className="text-neutral-500">{`${data.organisationMembers.length} of ${data.organisationPlan.maxUsers || '∞'}  Users added`}</div>
          </div>
          {activeOrganisation.plan === ApiOrganisationPlanChoices.Fr && (
            <ProgressBar
              percentage={memberQuotaUsage}
              color={progressBarColor(
                data.organisationMembers.length,
                data.organisationPlan.maxUsers
              )}
              size="sm"
            />
          )}
          <div className="flex justify-start">
            <Link href={`/${activeOrganisation.name}/members`}>
              <Button variant="secondary">
                <FaUsersCog /> Manage
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
