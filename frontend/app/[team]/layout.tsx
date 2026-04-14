'use client'

import '@/app/globals.css'
import { NavBar } from '@/components/layout/Navbar'
import Sidebar from '@/components/layout/Sidebar'
import { organisationContext } from '@/contexts/organisationContext'
import clsx from 'clsx'
import { usePathname, useRouter } from 'next/navigation'
import { useContext, useEffect, useMemo } from 'react'
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

  const path = usePathname()
  const isAccountInit = path?.split('/').includes('account-init')

  useEffect(() => {
    if (!loading && organisations !== null) {
      // if there are no organisations for this user, send to onboarding
      if (organisations.length === 0) {
        router.push('/signup')
      }

      // try and get org being accessed from route params in the list of organisations for this user
      const org = organisations.find((org) => org.name === params.team)

      // update active organisation if it exists
      if (org) {
        setActiveOrganisation(org)

        // SCIM-provisioned users with no keyring need to complete key ceremony
        if (!org.keyring && !isAccountInit) {
          router.push(`/${org.name}/account-init`)
        }
      }
      // if there's only one available organisation
      else if (organisations.length === 1) {
        const singleOrg = organisations[0]
        setActiveOrganisation(singleOrg)

        if (!singleOrg.keyring && !isAccountInit) {
          router.push(`/${singleOrg.name}/account-init`)
        }
      }
      // else send to home
      else router.push(`/`)
    }
  }, [organisations, params.team, router, loading, setActiveOrganisation, isAccountInit])

  // Detect if we need to redirect to account-init (SCIM user with no keyring)
  const needsKeyringInit = useMemo(() => {
    if (!organisations || loading) return false
    const org = organisations.find((o) => o.name === params.team) || (organisations.length === 1 ? organisations[0] : null)
    return org ? !org.keyring && !isAccountInit : false
  }, [organisations, loading, params.team, isAccountInit])

  const showNav = !path?.split('/').includes('recovery') && !isAccountInit

  // Don't show the unlock keyring dialog during account-init or if user has no keyring
  const showUnlockDialog = activeOrganisation && !isAccountInit && !!activeOrganisation.keyring

  // Suppress rendering while redirecting to account-init to prevent flash of content
  if (needsKeyringInit) {
    return null
  }

  return (
    <div
      className={clsx(
        'w-full h-screen overflow-hidden grid  divide-x divide-neutral-300 dark:divide-neutral-800',
        showNav && 'grid-cols-[max-content_1fr]'
      )}
    >
      {showUnlockDialog && <UnlockKeyringDialog organisation={activeOrganisation} />}
      {showNav && <NavBar />}
      {showNav && <Sidebar />}
      <div className="grid h-screen">
        <div></div>
        <div className={clsx('overflow-auto', showNav && 'mt-12 min-h-[calc(100vh-48px)]')}>
          {children}
        </div>
      </div>
    </div>
  )
}
