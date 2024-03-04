import ProgressBar from '@/components/common/ProgressBar'
import { organisationContext } from '@/contexts/organisationContext'
import { GetOrganisationPlan } from '@/graphql/queries/organisation/getOrganisationPlan.gql'
import { useQuery } from '@apollo/client'
import { ReactNode, useContext } from 'react'
import { PlanLabel } from '../../../../components/settings/organisation/PlanLabel'
import Spinner from '@/components/common/Spinner'
import { calculatePercentage } from '@/utils/dataUnits'
import { Button } from '@/components/common/Button'
import { FaCheckCircle, FaCubes, FaTimesCircle, FaUsersCog } from 'react-icons/fa'
import Link from 'next/link'
import GenericDialog from '@/components/common/GenericDialog'
import { UpgradeRequestForm } from '@/components/forms/UpgradeRequestForm'
import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { isCloudHosted } from '@/utils/appConfig'
import { LogoWordMark } from '@/components/common/LogoWordMark'

const plansInfo = {
  FR: {
    id: ApiOrganisationPlanChoices.Fr,
    name: 'Free',
    description: 'Try Phase without any commitments.',
    priceMonthly: '$0',
    priceYearly: '$0',
    priceDetail: undefined,
    featureSummary: [
      '5 Users',
      '3 Apps',
      '3 Environments',
      'End-to-end Encryption',
      'Google/GitHub/Gitlab SSO',
      'Unlimited Service Tokens',
      'Secret Versioning',
      'Secret Referencing',
      'Basic Access Control',
      '24-hour audit log retention',
      'Community Support',
    ],
    notIncluded: [
      'Unlimited Users',
      'Unlimited Apps',
      'Unlimited Environments',
      'SAML SSO',
      'Custom RBAC',
      'Point-in-time Recovery',
      'Source IP-based allow listing',
      '90-day audit log retention',
      'Priority Support',
    ],
  },
  PR: {
    id: ApiOrganisationPlanChoices.Pr,
    name: 'Pro',
    description: 'For fast moving teams with production applications.',
    priceMonthly: '$14/mo ',
    priceYearly: '$12/mo',
    priceDetail: 'per user',
    featureSummary: [
      'Everything in Free',
      'Unlimited Users',
      'Unlimited Apps',
      '10 Environments',
      'Role-based Access Control',
      'Point-in-time Recovery',
      'Source IP-based allow listing',
      '90-day audit log retention',
      'Priority Support',
    ],
    notIncluded: [
      'Unlimited Environments',
      'SAML SSO',
      'Custom RBAC',
      'Unlimited audit log retention',
      'Dedicated Support',
    ],
  },
  EN: {
    id: ApiOrganisationPlanChoices.En,
    name: 'Enterprise',
    description:
      'Secure existing data in your enterprise workload. Get full onboarding and priority technical support.',
    priceMonthly: 'Custom pricing',
    priceYearly: 'Custom pricing',
    priceDetail: undefined,
    featureSummary: [
      'Everything in Pro',
      'Unlimited Environments',
      'SAML SSO',
      '99.99% Uptime SLA',
      'Custom RBAC',
      'Dedicated support',
      'On-boarding and Migration assistance',
    ],
    notIncluded: [],
  },
}

const PlanFeatureItem = (props: {
  children: ReactNode
  iconColor: string
  iconType: 'check' | 'cross'
}) => {
  return (
    <div className="flex items-center gap-4 py-2 text-sm">
      {props.iconType === 'check' && <FaCheckCircle className={props.iconColor} />}
      {props.iconType === 'cross' && <FaTimesCircle className={props.iconColor} />}
      {props.children}
    </div>
  )
}

export const PlanInfo = () => {
  const { activeOrganisation } = useContext(organisationContext)

  const planInfo = activeOrganisation ? plansInfo[activeOrganisation.plan] : undefined

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
    <div className="space-y-6 divide-y divide-neutral-500/40">
      <div className="space-y-4">
        <div className="text-lg font-medium py-2 border-b border-neutral-500/20">Current plan</div>

        <div className="flex justify-between items-center py-4">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <LogoWordMark className="fill-black dark:fill-white h-10" />{' '}
              <PlanLabel plan={activeOrganisation.plan} />
            </div>
          </div>

          {activeOrganisation.plan !== ApiOrganisationPlanChoices.En && (
            <div className="flex items-center gap-4">
              <Link href="https://phase.dev/pricing" target="_blank" rel="noreferrer">
                <Button variant="secondary">Compare plans</Button>
              </Link>
              <GenericDialog
                title="Request an Upgrade"
                buttonVariant="primary"
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

        {planInfo && (
          <div className="grid grid-cols-2 gap-8">
            <div>
              {planInfo.featureSummary.map((feature) => (
                <PlanFeatureItem key={feature} iconColor="text-emerald-500" iconType="check">
                  {feature}
                </PlanFeatureItem>
              ))}
            </div>

            <div>
              <div className="text-neutral-500 font-medium text-lg py-2">Not included:</div>
              {planInfo.notIncluded.map((feature) => (
                <PlanFeatureItem key={feature} iconColor="text-red-500" iconType="cross">
                  {feature}
                </PlanFeatureItem>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-10 py-4">
        <div className="text-lg font-medium py-2 border-b border-neutral-500/20">Usage</div>

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
