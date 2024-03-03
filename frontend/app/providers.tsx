'use client'

import { ThemeProvider } from '@/contexts/themeContext'
import { SessionProvider } from 'next-auth/react'
import { ApolloProvider } from '@apollo/client'
import { graphQlClient } from '@/apollo/client'
import { KeyringProvider } from '@/contexts/keyringContext'
import { OrganisationProvider } from '@/contexts/organisationContext'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { initializePostHog } from '@/utils/posthog'
import { isCloudHosted } from '@/utils/appConfig'

if (isCloudHosted()) initializePostHog()

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <ApolloProvider client={graphQlClient}>
          <OrganisationProvider>
            <KeyringProvider>
              <PostHogProvider client={posthog}>{children}</PostHogProvider>
            </KeyringProvider>
          </OrganisationProvider>
        </ApolloProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
