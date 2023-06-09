import { Logo } from '../common/Logo'
import UserMenu from '../UserMenu'
import { useLazyQuery, useQuery } from '@apollo/client'
import GetOrganisations from '@/apollo/queries/getOrganisations.gql'
import { GetApps } from '@/apollo/queries/getApps.gql'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { AppType } from '@/apollo/graphql'
import Link from 'next/link'

export const NavBar = (props: { team: string }) => {
  const { data: orgsData } = useQuery(GetOrganisations)
  const [getApps, { data: appsData }] = useLazyQuery(GetApps)

  useEffect(() => {
    if (orgsData?.organisations) {
      const fetchData = async () => {
        const org = orgsData.organisations[0]

        const organisationId = org.id
        getApps({
          variables: {
            organisationId,
            appId: '',
          },
        })
      }

      fetchData()
    }
  }, [getApps, orgsData])

  const apps = appsData?.apps as AppType[]

  const appId = usePathname()?.split('/')[3]

  const activeApp = apps?.find((app) => app.id === appId)

  return (
    <header className="px-8 w-full h-16 border-b border-neutral-500/20 fixed top-0 flex gap-4 items-center justify-between text-neutral-500 font-medium bg-neutral-100/30 dark:bg-neutral-900/30 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Logo boxSize={40} />
        </Link>
        <span>/</span>
        {!activeApp && <span className="text-black dark:text-white">{props.team}</span>}
        {activeApp && <Link href={`/${props.team}`}>{props.team}</Link>}
        {activeApp && <span>/</span>}
        {activeApp && <span className="text-black dark:text-white">{activeApp.name}</span>}
      </div>
      <UserMenu />
    </header>
  )
}
