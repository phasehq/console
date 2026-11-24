'use client'

import '@/app/globals.css'
import { PageTitle } from '@/components/layout/PageTitle'
import CommandPalette from '@/components/common/CommandPalette'
import Sidebar from '@/components/layout/Sidebar'
import { organisationContext } from '@/contexts/organisationContext'
import { useUser } from '@/contexts/userContext'
import { OrganisationType } from '@/apollo/graphql'
import clsx from 'clsx'
import { usePathname, useRouter } from 'next/navigation'
import { useContext, useEffect, useMemo, use } from 'react'
import UnlockKeyringDialog from '@/components/auth/UnlockKeyringDialog'

export default function RootLayout(props: {
  children: React.ReactNode
  params: Promise<{ team: string }>
}) {
  const params = use(props.params)

  const { children } = props

  const { activeOrganisation, setActiveOrganisation, organisations, loading } =
    useContext(organisationContext)
  const { user } = useUser()

  const router = useRouter()

  const path = usePathname()
  const isAccountInit = path?.split('/').includes('account-init')

  // Mirrors `canAccessOrg` on the lobby: an org is accessible only when
  // the session is SSO-bound to it if the org requires SSO (either
  // explicitly via require_sso or implicitly because the member is
  // SCIM-managed).
  const canAccessOrg = (org: OrganisationType): boolean => {
    const ssoRequired = org.requireSso || org.memberScimManaged
    if (!ssoRequired) return true
    return user?.authMethod === 'sso' && user?.authSsoOrgId === org.id
  }

  useEffect(() => {
    if (!loading && organisations !== null) {
      // if there are no organisations for this user, send to onboarding
      if (organisations.length === 0) {
        router.push('/onboard')
      }

      // Try to find the organisation from the route parameters in the user's organisations.
      const org = organisations.find((org) => org.name === params.team)

      // update active organisation if it exists
      if (org) {
        // Orgs pending deletion are locked; the lobby offers the restore.
        if (org.deletedAt) {
          router.push(`/`)
          return
        }

        setActiveOrganisation(org)

        // Bounce to the lobby if SSO is required for this org but the
        // session isn't SSO-bound. The lobby renders the org as
        // greyed-out with a "sign in via SSO" hint instead of the
        // user being silently logged out.
        if (!canAccessOrg(org)) {
          router.push(`/`)
          return
        }

        // SCIM-provisioned users with no keyring need to complete key ceremony
        if (!org.keyring && !isAccountInit) {
          router.push(`/${org.name}/account-init`)
        }
      }
      // if there's only one available organisation
      else if (organisations.length === 1) {
        const singleOrg = organisations[0]
        if (singleOrg.deletedAt) {
          router.push(`/`)
          return
        }

        setActiveOrganisation(singleOrg)

        if (!canAccessOrg(singleOrg)) {
          router.push(`/`)
          return
        }

        if (!singleOrg.keyring && !isAccountInit) {
          router.push(`/${singleOrg.name}/account-init`)
        }
      }
      // else send to home
      else router.push(`/`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisations, params.team, router, loading, setActiveOrganisation, isAccountInit, user])

  // The org in the URL. activeOrganisation catches up in the effect above, so right after a
  // switch it is still the previous org.
  const routeOrg = useMemo(() => {
    if (!organisations || loading) return null
    return (
      organisations.find((o) => o.name === params.team) ||
      (organisations.length === 1 ? organisations[0] : null)
    )
  }, [organisations, loading, params.team])

  // Detect if we need to redirect to account-init (SCIM user with no keyring)
  const needsKeyringInit = routeOrg ? !routeOrg.keyring && !isAccountInit : false

  // Hold the page and the unlock dialog while the active org is still the previous one, so they
  // never run with its keyring
  const orgInSync = !routeOrg || !activeOrganisation || routeOrg.id === activeOrganisation.id

  const showNav = !path?.split('/').includes('recovery') && !isAccountInit

  // Don't show the unlock keyring dialog during account-init or if user has no keyring
  const showUnlockDialog =
    orgInSync && activeOrganisation && !isAccountInit && !!activeOrganisation.keyring

  // Suppress rendering while redirecting to account-init to prevent flash of content
  if (needsKeyringInit) {
    return null
  }

  return (
    // The navigation (the sidebar, or the tab bar below md) shares the shell colour with this
    // wrapper, and the page fills the rest as a panel. There is no top bar
    <div
      className={clsx(
        'flex h-dvh w-full overflow-hidden',
        showNav && 'bg-neutral-300/50 dark:bg-neutral-950/50'
      )}
    >
      {showUnlockDialog && <UnlockKeyringDialog organisation={activeOrganisation} />}
      {showNav && (
        <>
          <Sidebar />
          <CommandPalette />
          <PageTitle />
        </>
      )}
      <div
        className={clsx(
          'min-w-0 flex-1 overflow-auto',
          showNav &&
            'mb-[var(--mobile-tabbar-height)] rounded-b-2xl border-b border-neutral-500/20 bg-neutral-200 dark:bg-neutral-900 md:rounded-none md:border-b-0 md:border-l'
        )}
      >
        {orgInSync && children}
      </div>
    </div>
  )
}
