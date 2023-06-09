'use client'

import { useQuery } from '@apollo/client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import Loading from './loading'
import { GetOrganisations } from '@/apollo/queries/getOrganisations.gql'
import { OrganisationType } from '@/apollo/graphql'
import { getLocalOrgs } from '@/utils/localStorage'

export default function Home() {
  const { loading, error, data } = useQuery(GetOrganisations)

  const router = useRouter()

  useEffect(() => {
    if (data?.organisations) {
      const orgs = data.organisations as OrganisationType[]

      // if there is no org setup on the server, send to onboarding page
      if (!orgs.length) router.push('/onboard')
      else {
        const defaultOrg = data.organisations[0].name
        if (orgs.map((org) => org.name).includes(defaultOrg)) {
          const localOrgs = getLocalOrgs()
          // if org data exists on device
          if (localOrgs?.find((localOrg) => localOrg.org.name === defaultOrg)) {
            router.push(`/${defaultOrg}`)
          }
          // if no org data on device, send to new device login page
          else {
            router.push(`${orgs[0].name}/newdevice`)
          }
        }
      }
    }
  }, [data, router])

  useEffect(() => {
    if (error) {
      throw error.message
    }
  }, [error])

  return <main className="w-full flex flex-col h-screen">{loading && <Loading />}</main>
}
