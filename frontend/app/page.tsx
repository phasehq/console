'use client'

import { useRouter } from 'next/navigation'
import { useContext, useEffect, useState } from 'react'
import Loading from './loading'
import { OrganisationType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { Button } from '@/components/common/Button'
import { FaArrowRight, FaUsers } from 'react-icons/fa'

import { RoleLabel } from '@/components/users/RoleLabel'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'
import { GetLicenseData } from '@/graphql/queries/organisation/getLicense.gql'
import { useQuery } from '@apollo/client'
import { Card } from '@/components/common/Card'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'
import { FaCubes } from 'react-icons/fa6'

export default function Home() {
  const router = useRouter()

  useQuery(GetLicenseData)

  const { organisations, setActiveOrganisation, loading } = useContext(organisationContext)

  const [showOrgCards, setShowOrgCards] = useState<boolean>(false)

  const handleRouteToOrg = (org: OrganisationType) => {
    router.push(`/${org!.name}`)
  }

  useEffect(() => {
    if (!loading && organisations !== null) {
      // if there is no org membership, send to onboarding
      if (organisations.length === 0) router.push('/signup')
      // if there is a single org membership, send to org home
      else if (organisations.length === 1) {
        const organisation = organisations[0]
        setActiveOrganisation(organisation)
        router.push(`/${organisation!.name}`)
      }

      // if there are multiple memberships, show orgs
      else {
        setActiveOrganisation(null)
        setShowOrgCards(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisations, router, loading])

  return (
    <main className="w-full flex flex-col h-screen">
      {loading && <Loading />}
      {showOrgCards && (
        <>
          <OnboardingNavbar />

          <div className="mx-auto my-auto w-full px-8 space-y-8">
            <div className="space-y-1 text-center">
              <h1 className="text-2xl font-bold text-black dark:text-white">Welcome back</h1>
              <p className="text-neutral-500">Choose a workspace</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {organisations!.map((org: OrganisationType) => (
                <div key={org.id} className="cursor-pointer" onClick={() => handleRouteToOrg(org)}>
                  <Card>
                    <div className="flex flex-col gap-6 justify-between w-full">
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

                      <div className="flex justify-end">
                        <Button variant="primary" onClick={() => handleRouteToOrg(org)}>
                          Open <FaArrowRight />
                        </Button>
                      </div>
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </main>
  )
}
