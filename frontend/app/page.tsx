'use client'

import { useRouter } from 'next/navigation'
import { useContext, useEffect, useState } from 'react'
import Loading from './loading'
import { OrganisationType } from '@/apollo/graphql'
import { getLocalKeyrings } from '@/utils/localStorage'
import { organisationContext } from '@/contexts/organisationContext'
import { Button } from '@/components/common/Button'
import { FaArrowRight } from 'react-icons/fa'
import { useSession } from 'next-auth/react'
import { HeroPattern } from '@/components/common/HeroPattern'
import { Logo } from '@/components/common/Logo'
import { RoleLabel } from '@/components/users/RoleLabel'

export default function Home() {
  const router = useRouter()
  const { data: session } = useSession()

  const { organisations, activeOrganisation, setActiveOrganisation, loading } =
    useContext(organisationContext)

  const [showOrgCards, setShowOrgCards] = useState<boolean>(false)

  const handleRouteToOrg = (org: OrganisationType) => {
    const localOrgs = getLocalKeyrings()

    if (
      localOrgs?.find(
        (localOrg) => localOrg.org.id === org!.id && localOrg.email === session?.user?.email
      )
    ) {
      router.push(`/${org!.name}`)
    } else {
      router.push(`${org!.name}/newdevice`)
    }
  }

  useEffect(() => {
    if (!loading && organisations !== null) {
      const localOrgs = getLocalKeyrings()

      // if there is no org setup on the server, send to onboarding page
      if (organisations.length === 0) router.push('/onboard')
      else if (organisations.length === 1) {
        const organisation = organisations[0]
        setActiveOrganisation(organisation)
        // if local keyring exists on device for active organisation
        if (
          localOrgs?.find(
            (localOrg) =>
              localOrg.org.id === organisation!.id && localOrg.email === session?.user?.email
          )
        ) {
          router.push(`/${organisation!.name}`)
        }
        // if no keyring on device, send to new device login page
        else {
          router.push(`${organisation!.name}/newdevice`)
        }
      } else {
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

          <div className="mx-auto my-auto space-y-6 divide-y divide-neutral-500/40 rounded-md bg-zinc-200 dark:bg-zinc-800 text-center">
            <div className="space-y-2 p-8">
              <div className="flex justify-center">
                <Logo boxSize={80} />
              </div>
              <p className="text-xl font-semibold text-neutral-500">Choose a workspace</p>
            </div>
            <div className="divide-y divide-neutral-500/40">
              {organisations!.map((org: OrganisationType) => (
                <div
                  key={org.id}
                  className="p-8 bg-zinc-200 dark:bg-zinc-800 flex flex-col gap-2 text-center"
                >
                  <h2 className="text-3xl font-bold">{org.name}</h2>
                  <div className="text-neutral-500">
                    You are {org.role!.toLowerCase() === 'dev' ? 'a' : 'an'}{' '}
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
