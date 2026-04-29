'use client'

import { useRouter } from 'next/navigation'
import { useContext, useEffect, useState } from 'react'
import Loading from './loading'
import { OrganisationType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { useUser } from '@/contexts/userContext'
import { Button } from '@/components/common/Button'
import { FaArrowRight, FaLock, FaSignOutAlt, FaUsers } from 'react-icons/fa'

import { RoleLabel } from '@/components/users/RoleLabel'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'
import { GetLicenseData } from '@/graphql/queries/organisation/getLicense.gql'
import { useQuery } from '@apollo/client'
import { Card } from '@/components/common/Card'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'
import { FaCubes } from 'react-icons/fa6'
import { handleSignout } from '@/apollo/client'

export default function Home() {
  const router = useRouter()

  useQuery(GetLicenseData)

  const { organisations, setActiveOrganisation, loading } = useContext(organisationContext)
  const { user } = useUser()

  const [showOrgCards, setShowOrgCards] = useState<boolean>(false)

  const canAccessOrg = (org: OrganisationType) => {
    if (!org.requireSso) return true
    if (user?.authMethod === 'sso' && user?.authSsoOrgId === org.id) return true
    return false
  }

  const getActiveProviderName = (org: OrganisationType) => {
    const active = org.ssoProviders?.find((p) => p?.enabled)
    return active?.name || 'SSO'
  }

  const handleRouteToOrg = (org: OrganisationType) => {
    if (!canAccessOrg(org)) return
    router.push(`/${org!.name}`)
  }

  useEffect(() => {
    if (!loading && organisations !== null && user !== null) {
      // if there is no org membership, send to onboarding
      if (organisations.length === 0) router.push('/onboard')
      // if there is a single org membership, send to org home
      else if (organisations.length === 1) {
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

      // if there are multiple memberships, show orgs
      else {
        setActiveOrganisation(null)
        setShowOrgCards(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisations, router, loading, user])

  return (
    <main className="w-full flex flex-col h-screen">
      {loading && <Loading />}
      {showOrgCards && (
        <>
          <OnboardingNavbar />

          <div className="mx-auto my-auto w-full px-8 space-y-8">
            <div className="space-y-1 text-center">
              <h1 className="text-2xl font-bold text-black dark:text-white">Welcome back</h1>
              <p className="text-neutral-500">Choose an organisation</p>
            </div>
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
                              <span>Sign in with {getActiveProviderName(org)} to access</span>
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
        </>
      )}
    </main>
  )
}
