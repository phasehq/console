import Link from 'next/link'
import { AnimatedLogo } from '../common/AnimatedLogo'
import { ModeToggle } from '../common/ModeToggle'
import UserMenu from '../UserMenu'
import { FaSun, FaMoon } from 'react-icons/fa'

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
          <div className="flex gap-2 items-center">
            <FaSun className="text-neutral-500" />
            <ModeToggle />
            <FaMoon className="text-neutral-500" />
          </div>
          <UserMenu />
        </div>
      </nav>
    </header>
  )
}

export default OnboardingNavbar
