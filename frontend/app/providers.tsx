'use client'

import { ThemeProvider } from '@/contexts/themeContext'
import { SessionProvider } from 'next-auth/react'
import { ApolloProvider } from '@apollo/client'
import { graphQlClient } from '@/apollo/client'
import { KeyringProvider } from '@/contexts/keyringContext'
import { SidebarProvider } from '@/contexts/sidebarContext'
import { OrganisationProvider } from '@/contexts/organisationContext'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { initializePostHog } from '@/utils/posthog'
import { isCloudHosted } from '@/utils/appConfig'
import { printConsoleBranding } from '@/utils/console'
import { useEffect } from 'react'

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (isCloudHosted()) {
      initializePostHog()
    }

    printConsoleBranding()
  }, [])

  return (
    <ThemeProvider>
      <SidebarProvider>
        <SessionProvider>
          <ApolloProvider client={graphQlClient}>
            <OrganisationProvider>
              <KeyringProvider>
                <PostHogProvider client={posthog}>{children}</PostHogProvider>
              </KeyringProvider>
            </OrganisationProvider>
          </ApolloProvider>
        </SessionProvider>
      </SidebarProvider>
    </ThemeProvider>
  )
}
