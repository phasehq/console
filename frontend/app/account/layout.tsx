import '@/app/globals.css'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'

export const dynamic = 'force-dynamic'

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`w-full min-h-screen`}>
      <OnboardingNavbar />
      {children}
    </div>
  )
}
