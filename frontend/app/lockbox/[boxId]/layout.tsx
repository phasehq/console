import { Metadata } from 'next'
import { HeroPattern } from '@/components/common/HeroPattern'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'

export const metadata: Metadata = {
  title: 'Phase Lockbox',
  description:
    "You've recieved a secret via Phase Lockbox, secured with zero-trust encryption.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <HeroPattern />
      <OnboardingNavbar />
      {children}
    </>
  )
}
