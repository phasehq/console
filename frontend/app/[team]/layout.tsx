'use client'

import '@/app/globals.css'
import { HeroPattern } from '@/components/common/HeroPattern'
import { NavBar } from '@/components/layout/Navbar'
import Sidebar from '@/components/layout/Sidebar'
import { OrganisationProvider, organisationContext } from '@/contexts/organisationContext'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { useContext, useEffect } from 'react'
import { notFound } from 'next/navigation'

export default function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { team: string }
}) {
  const { activeOrganisation, setActiveOrganisation, organisations } =
    useContext(organisationContext)

  useEffect(() => {
    if (organisations.length > 0 && activeOrganisation!.name !== params.team) {
      const altOrg = organisations.find((org) => org.name === params.team)

      if (altOrg !== undefined) {
        setActiveOrganisation(altOrg)
      } else {
        return notFound()
      }
    }
  }, [activeOrganisation, organisations, params.team])

  const path = usePathname()

  const showNav = !path?.split('/').includes('newdevice')

  return (
    <OrganisationProvider>
      <div
        className={clsx(
          'w-full h-screen overflow-hidden grid  divide-x divide-neutral-300 dark:divide-neutral-800',
          showNav && 'grid-cols-[max-content_1fr]'
        )}
      >
        <HeroPattern />
        {showNav && <NavBar team={params.team} />}
        {showNav && <Sidebar />}
        <div className={clsx(showNav && 'pt-16')}>{children}</div>
      </div>
    </OrganisationProvider>
  )
}
