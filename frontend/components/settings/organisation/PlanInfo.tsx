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
} from 'react-icons/fa'
import Link from 'next/link'
import { ActivatedPhaseLicenseType, ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { isCloudHosted } from '@/utils/appConfig'
import { LogoWordMark } from '@/components/common/LogoWordMark'
import { License } from '../../../ee/billing/License'
import { BsListColumnsReverse } from 'react-icons/bs'
import { FaKey } from 'react-icons/fa6'
import { useSearchParams } from 'next/navigation'
import { PostCheckoutScreen } from '@/ee/billing/PostCheckoutScreen'
import { UpsellDialog } from './UpsellDialog'
import { MigratePricingDialog } from '../../../ee/billing/MigratePricing'
import { userHasPermission } from '@/utils/access/permissions'
import Accordion from '@/components/common/Accordion'
import clsx from 'clsx'
import { StripeBillingInfo } from '../../../ee/billing/StripeBillingInfo'

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

  const seatsUsed = data?.organisationPlan?.seatsUsed?.total || 0

  const seatLimit = data?.organisationPlan
    ? license()?.seats || data.organisationPlan.maxUsers
    : undefined

  const appQuotaUsage = data?.organisationPlan
    ? calculatePercentage(data.organisationPlan.appCount, data.organisationPlan.maxApps)
    : 0

  const seatQuotaUsage = data?.organisationPlan
    ? calculatePercentage(seatsUsed, license()?.seats || data.organisationPlan.maxUsers)
    : 0

  const memberQuotaUsage = data?.organisationPlan?.seatsUsed
    ? calculatePercentage(
        data.organisationPlan.seatsUsed.users,
        license()?.seats || data.organisationPlan.maxUsers
      )
    : 0

  const serviceAccountQuotaUsage = data?.organisationPlan?.seatsUsed
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
              {activeOrganisation.plan === ApiOrganisationPlanChoices.En &&
                activeOrganisation.pricingVersion === 1 && <MigratePricingDialog />}
              {activeOrganisation.plan !== ApiOrganisationPlanChoices.En && (
                <div className="flex items-center gap-4">
                  <Link href="https://phase.dev/pricing" target="_blank" rel="noreferrer">
                    <Button variant="secondary">
                      <div className="whitespace-nowrap">Compare plans</div>
                    </Button>
                  </Link>
                  {userCanUpdateBilling && <UpsellDialog buttonLabel="Upgrade" />}
                </div>
              )}
            </div>
            {license() && <License license={license()!} showExpiry />}
            {isCloudHosted() && <StripeBillingInfo />}
          </div>
        </div>
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

            {(activeOrganisation.pricingVersion !== 2 ||
              activeOrganisation.plan === ApiOrganisationPlanChoices.Fr) && (
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

                  <div className="text-neutral-500 text-xs">
                    {`${data.organisationPlan.seatsUsed.serviceAccounts} Seats used`}
                  </div>
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
            )}
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
