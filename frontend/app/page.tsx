'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useContext, useEffect, useState } from 'react'
import Loading from './loading'
import { OrganisationMemberInviteType, OrganisationType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { useUser } from '@/contexts/userContext'
import { Button } from '@/components/common/Button'
import { FaArrowRight, FaEnvelope, FaLock, FaPlus, FaSignOutAlt, FaUsers } from 'react-icons/fa'

import { RoleLabel } from '@/components/users/RoleLabel'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'
import { GetLicenseData } from '@/graphql/queries/organisation/getLicense.gql'
import { GetPendingInvitesForUser } from '@/graphql/queries/organisation/getPendingInvitesForUser.gql'
import { useQuery } from '@apollo/client'
import { Alert } from '@/components/common/Alert'
import { Card } from '@/components/common/Card'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'
import { FaCubes } from 'react-icons/fa6'
import { handleSignout } from '@/apollo/client'

export default function Home() {
  const router = useRouter()

  useQuery(GetLicenseData)

  const { organisations, setActiveOrganisation, loading } = useContext(organisationContext)
  const { user } = useUser()

  const { data: invitesData, loading: invitesLoading } = useQuery(GetPendingInvitesForUser, {
    fetchPolicy: 'cache-and-network',
  })
  const pendingInvites: OrganisationMemberInviteType[] =
    (invitesData?.pendingInvitesForUser ?? []).filter(Boolean) as OrganisationMemberInviteType[]

  const [showOrgCards, setShowOrgCards] = useState<boolean>(false)

  const canAccessOrg = (org: OrganisationType) => {
    // SCIM-managed members must auth via the org's SSO — the IdP is the
    // source of truth for their access. Same enforcement as require_sso,
    // applied per-member rather than per-org.
    const ssoRequired = org.requireSso || org.memberScimManaged
    if (!ssoRequired) return true
    return user?.authMethod === 'sso' && user?.authSsoOrgId === org.id
  }

  const getActiveProviderName = (org: OrganisationType) => {
    const active = org.ssoProviders?.find((p) => p?.enabled)
    return active?.name || 'SSO'
  }

  const handleRouteToOrg = (org: OrganisationType) => {
    if (!canAccessOrg(org)) return
    router.push(`/${org!.name}`)
  }

  const getInviterLabel = (invite: OrganisationMemberInviteType) => {
    if (invite.invitedBy?.fullName) return invite.invitedBy.fullName
    if (invite.invitedBy?.email) return invite.invitedBy.email
    if (invite.invitedByServiceAccount?.name) return invite.invitedByServiceAccount.name
    return 'an organisation admin'
  }

  useEffect(() => {
    if (!loading && !invitesLoading && organisations !== null && user !== null) {
      const orgCount = organisations.length
      const inviteCount = pendingInvites.length

      // No orgs, no invites — first-time user. Send to onboarding.
      if (orgCount === 0 && inviteCount === 0) {
        router.push('/onboard')
      }
      // Exactly one org and no pending invites — go straight in.
      else if (orgCount === 1 && inviteCount === 0) {
        const organisation = organisations[0]
        if (canAccessOrg(organisation)) {
          setActiveOrganisation(organisation)
          router.push(`/${organisation!.name}`)
        } else {
          // Single org but can't access (SSO required) — show card so user sees the message
          setActiveOrganisation(null)
          setShowOrgCards(true)
        }
      }
      // Otherwise (multiple orgs OR any pending invites) — show the lobby.
      else {
        setActiveOrganisation(null)
        setShowOrgCards(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisations, pendingInvites.length, router, loading, invitesLoading, user])

  const hasOrgs = (organisations?.length ?? 0) > 0
  const hasInvites = pendingInvites.length > 0

  return (
    <main className="w-full flex flex-col h-screen">
      {(loading || invitesLoading) && <Loading />}
      {showOrgCards && (
        <>
          <OnboardingNavbar />

          <div className="mx-auto my-auto w-full px-8 py-12 space-y-10 max-w-6xl">
            <div className="space-y-1 text-center">
              <h1 className="text-2xl font-bold text-black dark:text-white">
                {hasOrgs ? 'Welcome back' : 'Welcome to Phase'}
              </h1>
              <p className="text-neutral-500">
                {hasInvites && !hasOrgs
                  ? 'You have a pending invite. Accept it to join, or set up a new organisation.'
                  : hasInvites
                    ? 'Choose an organisation, or accept a pending invite.'
                    : 'Choose an organisation'}
              </p>
            </div>

            {hasInvites && (
              <div className="space-y-3">
                <h2 className="text-xs font-medium uppercase tracking-widest text-neutral-500">
                  Pending invites
                </h2>
                <div className="space-y-2">
                  {pendingInvites.map((invite) => (
                    <Alert key={invite.id} variant="success" customIcon={<FaEnvelope className="shrink-0" />}>
                      <div className="flex items-center justify-between w-full">
                        <div>
                          <span className="font-semibold">{invite.organisation.name}</span>
                          <span className="opacity-70"> · Invited by {getInviterLabel(invite)}</span>
                        </div>
                        <Link href={`/invite/${btoa(invite.id)}`}>
                          <Button variant="primary" classString="text-xs py-1 px-3">
                            Accept invite <FaArrowRight />
                          </Button>
                        </Link>
                      </div>
                    </Alert>
                  ))}
                </div>
              </div>
            )}

            {hasOrgs && (
              <div className="space-y-3">
                {hasInvites && (
                  <h2 className="text-xs font-medium uppercase tracking-widest text-neutral-500">
                    Your organisations
                  </h2>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {organisations!.map((org: OrganisationType) => {
                const accessible = canAccessOrg(org)
                return (
                <div key={org.id} className={accessible ? 'cursor-pointer' : 'cursor-not-allowed'} onClick={() => handleRouteToOrg(org)}>
                  <Card>
                    <div className={`flex flex-col gap-6 justify-between w-full ${!accessible ? 'opacity-50' : ''}`}>
                      <div className="flex justify-between items-start">
                        <div className="space-y-0.5">
                          <h2 className="text-xl font-semibold text-zinc-700 dark:text-zinc-100 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition ease">
                            {org.name}
                          </h2>
                          <div className="text-2xs text-neutral-500">
                            <RoleLabel role={org.role!} />
                          </div>
                        </div>
                        <PlanLabel plan={org.plan} />
                      </div>

                      <div className="flex items-center gap-4">
                        {org.planDetail?.seatsUsed && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xl text-zinc-700 dark:text-zinc-100">
                              <FaUsers />
                              <span className="font-light">{org.planDetail.seatsUsed.total}</span>
                            </div>
                            <span className="text-neutral-500 font-medium text-[0.6rem] uppercase tracking-widest">
                              {org.planDetail.seatsUsed.total === 1 ? 'Member' : 'Members'}
                            </span>
                          </div>
                        )}

                        {org.planDetail?.appCount != null && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xl text-zinc-700 dark:text-zinc-100">
                              <FaCubes />
                              <span className="font-light">{org.planDetail.appCount}</span>
                            </div>
                            <span className="text-neutral-500 font-medium text-[0.6rem] uppercase tracking-widest">
                              {org.planDetail.appCount === 1 ? 'App' : 'Apps'}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex justify-end items-end">
                        {accessible ? (
                          <Button variant="primary" onClick={() => handleRouteToOrg(org)}>
                            Open <FaArrowRight />
                          </Button>
                        ) : (
                          <div className="flex flex-col gap-2 items-end text-right">
                            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs">
                              <FaLock className="shrink-0" />
                              <span>
                                Sign in with {getActiveProviderName(org)} to access
                                {org.memberScimManaged && ' (provisioned via SCIM)'}
                              </span>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSignout() }}
                              className="flex items-center gap-1.5 text-2xs text-neutral-500 hover:text-red-500 dark:hover:text-red-400 transition ease"
                            >
                              <FaSignOutAlt />
                              Log out and sign in with SSO
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </div>
              )})}
                </div>
              </div>
            )}

            {!hasOrgs && hasInvites && (
              <div className="flex justify-center">
                <Link href="/onboard">
                  <Button variant="secondary" icon={FaPlus}>
                    Set up a new organisation
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  )
}
