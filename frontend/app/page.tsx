'use client'

import { useRouter } from 'next/navigation'
import { useContext, useEffect, useState } from 'react'
import Loading from './loading'
import { OrganisationType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { Button } from '@/components/common/Button'
import { FaArrowRight } from 'react-icons/fa'
import { HeroPattern } from '@/components/common/HeroPattern'
import { LogoWordMark } from '@/components/common/LogoWordMark'
import { RoleLabel } from '@/components/users/RoleLabel'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'
import { GetLicenseData } from '@/graphql/queries/organisation/getLicense.gql'
import { useQuery } from '@apollo/client'

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
          <HeroPattern />

          <OnboardingNavbar />

          <div className="mx-auto my-auto space-y-6 divide-y divide-neutral-500/40 rounded-md bg-zinc-100 dark:bg-zinc-800 text-center">
            <div className="space-y-0 p-4">
              <div className="flex justify-center">
                <LogoWordMark className="w-32 fill-black dark:fill-white" />
              </div>
              <p className="text-xl font-semibold text-neutral-500">Choose a workspace</p>
            </div>
            <div className="divide-y divide-neutral-500/40">
              {organisations!.map((org: OrganisationType) => (
                <div
                  key={org.id}
                  className="p-8 bg-zinc-100 dark:bg-zinc-800 flex flex-col gap-2 text-center"
                >
                  <h2 className="text-3xl font-bold text-black dark:text-white">{org.name}</h2>
                  <div className="text-neutral-500">
                    You are {org.role!.name!.toLowerCase() === 'dev' ? 'a' : 'an'}{' '}
                    <RoleLabel role={org.role!} /> in this organisation
                  </div>
                  <div className="pt-4">
                    <Button variant="primary" onClick={() => handleRouteToOrg(org)}>
                      Go to dashboard <FaArrowRight />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </main>
  )
}
