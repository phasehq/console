import '@/app/globals.css'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'
import { SsoProvidersProvider } from '@/components/account/SsoProvidersContext'

export const dynamic = 'force-dynamic'

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  // Same parsing as the login page so the account page offers the same set.
  const ssoProviders =
    process.env.SSO_PROVIDERS?.split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean) ?? []

  return (
    <div className={`w-full min-h-screen`}>
      <OnboardingNavbar />
      <SsoProvidersProvider value={ssoProviders}>{children}</SsoProvidersProvider>
    </div>
  )
}
