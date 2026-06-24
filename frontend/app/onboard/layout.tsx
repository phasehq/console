import '@/app/globals.css'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'
import UserMenu from '@/components/UserMenu'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`w-full min-h-screen`}>
      <OnboardingNavbar />
      {children}
    </div>
  )
}
