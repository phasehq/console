'use client'

import { useRouter } from 'next/navigation'
import { useContext, useEffect, useState } from 'react'
import Loading from './loading'
import { OrganisationType } from '@/apollo/graphql'
import { getLocalOrgs } from '@/utils/localStorage'
import { organisationContext } from '@/contexts/organisationContext'
import { Button } from '@/components/common/Button'
import { FaArrowRight } from 'react-icons/fa'
import { useSession } from 'next-auth/react'

export default function Home() {
  const router = useRouter()
  const { data: session } = useSession()

  const { organisations, activeOrganisation, setActiveOrganisation, loading } =
    useContext(organisationContext)

  const [showOrgCards, setShowOrgCards] = useState<boolean>(false)

  const handleRouteToOrg = (org: OrganisationType) => {
    const localOrgs = getLocalOrgs()

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
      const localOrgs = getLocalOrgs()

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
        <div className="mx-auto my-auto space-y-6">
          {organisations!.map((org: OrganisationType) => (
            <div
              key={org.id}
              className="p-8 bg-zinc-200 dark:bg-zinc-800 rounded-md flex flex-col gap-2 text-center"
            >
              <div className="text-3xl font-bold">{org.name}</div>
              <Button variant="primary" onClick={() => handleRouteToOrg(org)}>
                Go to dashboard <FaArrowRight />
              </Button>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
