import '@/app/globals.css'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full min-h-screen">
      <OnboardingNavbar />
      {children}
    </div>
  )
}
