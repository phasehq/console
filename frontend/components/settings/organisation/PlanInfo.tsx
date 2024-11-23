import ProgressBar from '@/components/common/ProgressBar'
import { organisationContext } from '@/contexts/organisationContext'
import { GetOrganisationPlan } from '@/graphql/queries/organisation/getOrganisationPlan.gql'
import { GetOrgLicense } from '@/graphql/queries/organisation/getOrganisationLicense.gql'
import { useQuery } from '@apollo/client'
import { ReactNode, useContext } from 'react'
import { PlanLabel } from './PlanLabel'
import Spinner from '@/components/common/Spinner'
import { calculatePercentage } from '@/utils/dataUnits'
import { Button } from '@/components/common/Button'
import {
  FaCheckCircle,
  FaChevronDown,
  FaCog,
  FaCube,
  FaCubes,
  FaTimesCircle,
  FaUser,
  FaUsersCog,
} from 'react-icons/fa'
import Link from 'next/link'
import { ActivatedPhaseLicenseType, ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { isCloudHosted } from '@/utils/appConfig'
import { LogoWordMark } from '@/components/common/LogoWordMark'
import { License } from './License'
import { BsListColumnsReverse } from 'react-icons/bs'
import { FaKey } from 'react-icons/fa6'
import { useSearchParams } from 'next/navigation'
import { PostCheckoutScreen } from '@/ee/billing/PostCheckoutScreen'
import { UpsellDialog } from './UpsellDialog'
import { userHasPermission } from '@/utils/access/permissions'
import Accordion from '@/components/common/Accordion'
import clsx from 'clsx'

const plansInfo = {
  FR: {
    id: ApiOrganisationPlanChoices.Fr,
    name: 'Free',
    description: 'Try Phase without any commitments.',
    seats: isCloudHosted() ? '5 Users / Service Accounts' : 'Unlimited Users',
    apps: isCloudHosted() ? '3 Apps' : 'Unlimited Apps',
    featureSummary: [
      'End-to-end Encryption',
      'Google/GitHub/Gitlab SSO',
      'Secret Versioning',
      'Secret Referencing',
      'Basic Access Control',
      isCloudHosted() ? '24-hour audit log retention' : 'Unlimited Audit Log Retention',
      'Community Support',
    ],
    notIncluded: [
      ...(isCloudHosted()
        ? [
            '90-day audit log retention',
            'Unlimited Users',
            'Unlimited Apps',
            'Unlimited Environments',
            'Unlimited Service Tokens',
          ]
        : []),
    ],
  },
  PR: {
    id: ApiOrganisationPlanChoices.Pr,
    name: 'Pro',
    seats: 'Unlimited Users',
    apps: 'Unlimited Apps',
    featureSummary: [
      'End-to-end Encryption',
      'Google/GitHub/Gitlab SSO',
      'Role-based Access Control',
      'Secret Versioning',
      'Secret Referencing',
      isCloudHosted() ? '90-day audit log retention' : 'Unlimited Audit Log Retention',
      'Priority Support',
    ],
    notIncluded: [
      ...(isCloudHosted() ? ['Unlimited audit log retention', 'Unlimited Environments'] : []),
    ],
  },
  EN: {
    id: ApiOrganisationPlanChoices.En,
    name: 'Enterprise',
    description:
      'Secure existing data in your enterprise workload. Get full onboarding and priority technical support.',
    seats: 'Unlimited Users',
    apps: 'Unlimited Apps',
    featureSummary: [
      'End-to-end Encryption',
      'Google/GitHub/Gitlab SSO',
      'Role-based Access Control',
      'Secret Versioning',
      'Secret Referencing',
      'Dedicated support',
      'On-boarding and Migration assistance',
    ],
    notIncluded: [],
  },
}

const PlanFeatureItem = (props: {
  children: ReactNode
  iconColor: string
  iconType: 'check' | 'cross' | 'user' | 'app' | 'env' | 'key'
}) => {
  return (
    <div className="flex items-center gap-2 py-1 text-xs">
      {props.iconType === 'check' && <FaCheckCircle className={props.iconColor} />}
      {props.iconType === 'cross' && <FaTimesCircle className={props.iconColor} />}
      {props.iconType === 'user' && <FaUser className={props.iconColor} />}
      {props.iconType === 'app' && <FaCube className={props.iconColor} />}
      {props.iconType === 'env' && <BsListColumnsReverse className={props.iconColor} />}
      {props.iconType === 'key' && <FaKey className={props.iconColor} />}
      {props.children}
    </div>
  )
}

export const PlanInfo = () => {
  const { activeOrganisation } = useContext(organisationContext)

  const userCanUpdateBilling = activeOrganisation
    ? userHasPermission(activeOrganisation.role?.permissions, 'Billing', 'update')
    : false

  const searchParams = useSearchParams()

  const planInfo = activeOrganisation ? plansInfo[activeOrganisation.plan] : undefined

  const { loading, data } = useQuery(GetOrganisationPlan, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !activeOrganisation,
    fetchPolicy: 'cache-and-network',
  })

  const { data: licenseData } = useQuery(GetOrgLicense, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !activeOrganisation,
    fetchPolicy: 'cache-and-network',
  })

  const license = (): ActivatedPhaseLicenseType | null => licenseData?.organisationLicense || null

  const seatsUsed = data ? data.organisationPlan.seatsUsed.total : 0

  const seatLimit = data ? license()?.seats || data.organisationPlan.maxUsers : undefined

  const appQuotaUsage = data
    ? calculatePercentage(data.organisationPlan.appCount, data.organisationPlan.maxApps)
    : 0

  const seatQuotaUsage = data
    ? calculatePercentage(seatsUsed, license()?.seats || data.organisationPlan.maxUsers)
    : 0

  const memberQuotaUsage = data
    ? calculatePercentage(
        data.organisationPlan.seatsUsed.users,
        license()?.seats || data.organisationPlan.maxUsers
      )
    : 0

  const serviceAccountQuotaUsage = data
    ? calculatePercentage(
        data.organisationPlan.seatsUsed.serviceAccounts,
        license()?.seats || data.organisationPlan.maxUsers
      )
    : 0

  const progressBarColor = (value: number, maxValue: number) =>
    value >= maxValue ? 'bg-red-500' : value === maxValue - 1 ? 'bg-amber-500' : 'bg-emerald-500'

  if (loading || !activeOrganisation)
    return (
      <div className="flex items-center justify-center p-40 mx-auto">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="space-y-6 divide-y divide-neutral-500/40">
      <div className="space-y-4 ">
        <div className="text-lg font-medium py-2 border-b border-neutral-500/20">Current plan</div>

        <div className="py-4">
          <div className="space-y-4 w-full">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <LogoWordMark className="fill-black dark:fill-white h-10" />{' '}
                <PlanLabel plan={activeOrganisation.plan} />
              </div>
              {activeOrganisation.plan !== ApiOrganisationPlanChoices.En && (
                <div className="flex items-center gap-4">
                  <Link href="https://phase.dev/pricing" target="_blank" rel="noreferrer">
                    <Button variant="secondary">
                      <div className="whitespace-nowrap">Compare plans</div>
                    </Button>
                  </Link>
                  {userCanUpdateBilling && <UpsellDialog />}
                </div>
              )}
            </div>
            {license() && <License license={license()!} showExpiry />}
          </div>
        </div>

        {planInfo && isCloudHosted() && (
          <div className="grid grid-cols-2 gap-8">
            <div>
              <PlanFeatureItem iconColor="text-emerald-500" iconType="user">
                {license()?.seats ? `${license()?.seats} Users / Service Accounts` : planInfo.seats}
              </PlanFeatureItem>
              <PlanFeatureItem iconColor="text-emerald-500" iconType="app">
                {planInfo.apps}
              </PlanFeatureItem>

              {planInfo.featureSummary.map((feature) => (
                <PlanFeatureItem key={feature} iconColor="text-emerald-500" iconType="check">
                  {feature}
                </PlanFeatureItem>
              ))}
            </div>

            {planInfo.notIncluded.length > 0 && (
              <div>
                <div className="text-neutral-500 font-medium text-lg py-2">Not included:</div>
                {planInfo.notIncluded.map((feature) => (
                  <PlanFeatureItem key={feature} iconColor="text-red-500" iconType="cross">
                    {feature}
                  </PlanFeatureItem>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-10 py-4">
        <div className="border-b border-neutral-500/20 pb-2">
          <div className="text-lg font-medium py-2 ">Usage</div>
          <div className="text-neutral-500">
            Details of seat and app quota usage for your Organisation plan
          </div>
        </div>

        <Accordion
          buttonContent={(open) => (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-lg font-medium text-black dark:text-white">Seats</div>
                  <FaChevronDown
                    className={clsx(
                      'text-neutral-500 transform transition ease',
                      open ? 'rotate-180' : 'rotate-0'
                    )}
                  />
                </div>
                <div className="text-neutral-500">{`${seatsUsed} ${seatLimit ? `of ${seatLimit}` : ''}  Seats used`}</div>
              </div>
              {seatLimit && (
                <ProgressBar
                  percentage={seatQuotaUsage}
                  color={progressBarColor(seatsUsed, seatLimit)}
                  size="md"
                />
              )}
            </div>
          )}
        >
          <div className="space-y-4 py-8 pl-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm text-black dark:text-white">Members</div>
                  <Link href={`/${activeOrganisation.name}/access/members`}>
                    <Button variant="secondary">
                      <div className="flex items-center gap-1 text-2xs">
                        <FaCog /> Manage
                      </div>
                    </Button>
                  </Link>
                </div>

                <div className="text-neutral-500 text-xs">{`${data.organisationPlan.seatsUsed.users}  Seats used`}</div>
              </div>
              {seatLimit && (
                <ProgressBar
                  percentage={memberQuotaUsage}
                  color={progressBarColor(data.organisationPlan.seatsUsed.users, seatLimit)}
                  size="sm"
                />
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm text-black dark:text-white">
                    Service Accounts
                  </div>
                  <Link href={`/${activeOrganisation.name}/access/service-accounts`}>
                    <Button variant="secondary">
                      <div className="flex items-center gap-1 text-2xs">
                        <FaCog /> Manage
                      </div>
                    </Button>
                  </Link>
                </div>

                <div className="text-neutral-500 text-xs">{`${data.organisationPlan.seatsUsed.serviceAccounts} Seats used`}</div>
              </div>
              {seatLimit && (
                <ProgressBar
                  percentage={serviceAccountQuotaUsage}
                  color={progressBarColor(
                    data.organisationPlan.seatsUsed.serviceAccounts,
                    seatLimit
                  )}
                  size="sm"
                />
              )}
            </div>
          </div>
        </Accordion>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-lg font-medium text-black dark:text-white">Apps</div>
            <div className="text-neutral-500">{`${data.organisationPlan.appCount} ${data.organisationPlan.maxApps ? `of ${data.organisationPlan.maxApps}` : ''}  Apps used`}</div>
          </div>
          {data.organisationPlan.maxApps && (
            <ProgressBar
              percentage={appQuotaUsage}
              color={progressBarColor(
                data.organisationPlan.appCount,
                data.organisationPlan.maxApps
              )}
              size="md"
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
      </div>

      {searchParams?.get('stripe_session_id') && (
        <PostCheckoutScreen stripeSessionId={searchParams.get('stripe_session_id')!} />
      )}
    </div>
  )
}
