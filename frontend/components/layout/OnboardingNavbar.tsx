'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import UserMenu from '../UserMenu'
import { LogoWordMark } from '../common/LogoWordMark'
import { generatePageTitle } from '@/utils/navigation'

const OnboardingNavbar = () => {
  const pathname = usePathname()

  useEffect(() => {
    // Parse the current route to determine page title
    const pathSegments = (pathname ?? '').split('/').filter(Boolean)
    let route = null
    let routeParam = null

    if (pathSegments.length > 0) {
      route = pathSegments[0]
      if (pathSegments.length > 1) {
        routeParam = pathSegments[1]
      }
    }

    // Set page title based on route
    const title = generatePageTitle({ route, routeParam })
    document.title = title
  }, [pathname])

  return (
    <header className="fixed z-20 w-full" data-testid="navbar">
      <nav className="mx-auto flex w-full items-center justify-between p-4">
        <Link href="/" className="flex items-center gap-1 border-none">
          <div>
            <LogoWordMark className="w-24 fill-black dark:fill-white" />
          </div>
        </Link>
        <div className="flex gap-4 items-center">
          <UserMenu />
        </div>
      </nav>
    </header>
  )
}

export default OnboardingNavbar
