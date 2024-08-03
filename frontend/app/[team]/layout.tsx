'use client'

import '@/app/globals.css'
import { NavBar } from '@/components/layout/Navbar'
import Sidebar from '@/components/layout/Sidebar'
import { organisationContext } from '@/contexts/organisationContext'
import clsx from 'clsx'
import { usePathname, useRouter } from 'next/navigation'
import { useContext, useEffect } from 'react'

import UnlockKeyringDialog from '@/components/auth/UnlockKeyringDialog'

export default function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { team: string }
}) {
  const { activeOrganisation, setActiveOrganisation, organisations, loading } =
    useContext(organisationContext)

  const router = useRouter()

  useEffect(() => {
    if (!loading && organisations !== null) {
      // if there are no organisations for this user, send to onboarding
      if (organisations.length === 0) {
        router.push('/signup')
      }

      // try and get org being accessed from route params in the list of organisations for this user
      const org = organisations.find((org) => org.name === params.team)

      // update active organisation if it exists
      if (org) setActiveOrganisation(org)
      // if there's only one available organisation
      else if (organisations.length === 1) setActiveOrganisation(organisations[0])
      // else send to home
      else router.push(`/`)
    }
  }, [organisations, params.team, router, loading, setActiveOrganisation])

  const path = usePathname()

  const showNav = !path?.split('/').includes('recovery')

  return (
    <div
      className={clsx(
        'w-full h-screen overflow-hidden grid  divide-x divide-neutral-300 dark:divide-neutral-800',
        showNav && 'grid-cols-[max-content_1fr]'
      )}
    >
      {activeOrganisation && <UnlockKeyringDialog organisation={activeOrganisation} />}
      {showNav && <NavBar team={params.team} />}
      {showNav && <Sidebar />}
      <div className="grid h-screen">
        <div></div>
        <div className={clsx('overflow-auto', showNav && 'mt-16')}>{children}</div>
      </div>
    </div>
  )
}
