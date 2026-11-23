'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import UserMenu from '../UserMenu'
import { LogoWordMark } from '../common/LogoWordMark'
import { usePageTitle } from '@/hooks/usePageTitle'
import { generatePageTitle } from '@/utils/navigation'

const OnboardingNavbar = () => {
  const pathname = usePathname()

  // The first two path segments name the page, e.g. /lockbox/[boxId]
  const [route = null, routeParam = null] = (pathname ?? '').split('/').filter(Boolean)
  usePageTitle(generatePageTitle({ route, routeParam }))

  return (
    // z-10: above page content, below dialogs (same z, portaled later in DOM)
    <header
      className="fixed z-10 w-full bg-neutral-100/90 backdrop-blur-md dark:bg-neutral-900/90 md:bg-transparent md:backdrop-blur-none md:dark:bg-transparent"
      data-testid="navbar"
    >
      <nav className="mx-auto flex w-full items-center justify-between p-4">
        <Link href="/" className="flex items-center gap-1 border-none">
          <div>
            <LogoWordMark className="w-16 fill-black dark:fill-white" />
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
