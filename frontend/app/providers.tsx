'use client'

import { ThemeProvider } from '@/contexts/themeContext'
import { SessionProvider } from 'next-auth/react'
import { ApolloProvider } from '@apollo/client'
import { graphQlClient } from '@/apollo/client'
import { KeyringProvider } from '@/contexts/keyringContext'
import { OrganisationProvider } from '@/contexts/organisationContext'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'

if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
    capture_pageview: true,
    session_recording: {
      maskTextSelector: '.ph-mask', // Masks all text elements with the ph-mask class
      maskInputOptions: {
        password: true, //mask password inputs
      },
    },
  })
}

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
