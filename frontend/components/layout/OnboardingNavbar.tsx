import Link from 'next/link'
import { AnimatedLogo } from '../common/AnimatedLogo'
import { ModeToggle } from '../common/ModeToggle'
import UserMenu from '../UserMenu'

const OnboardingNavbar = () => {
  return (
    <header className="fixed z-20 w-full" data-testid="navbar">
      <nav className="mx-auto flex w-full items-center justify-between p-4">
        <Link
          href="/"
          className="flex items-center gap-1 border-none text-sm font-light text-white"
        >
          <div>
            <AnimatedLogo boxSize={24} />
          </div>
          phase.dev
        </Link>
        <div className="flex gap-4 items-center">
          <ModeToggle />
          <UserMenu />
        </div>
      </nav>
    </header>
  )
}

export default OnboardingNavbar
