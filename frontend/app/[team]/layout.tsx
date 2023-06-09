'use client'

import '@/app/globals.css'
import { HeroPattern } from '@/components/common/HeroPattern'
import { NavBar } from '@/components/layout/Navbar'
import Sidebar from '@/components/layout/Sidebar'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'

export default function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { team: string }
}) {
  const path = usePathname()

  const showNav = !path?.split('/').includes('newdevice')

  return (
    <div
      className={clsx(
        'w-full min-h-screen grid  divide-x divide-neutral-300 dark:divide-neutral-800',
        showNav && 'grid-cols-[max-content_1fr]'
      )}
    >
      <HeroPattern />
      {showNav && <NavBar team={params.team} />}
      {showNav && <Sidebar />}
      <div className={clsx(showNav && 'pt-16')}>{children}</div>
    </div>
  )
}
