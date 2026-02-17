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
import { useEffect } from 'react'

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (isCloudHosted()) {
      initializePostHog()
    }

    console.log(
      `%c
          /$$$$$$$  /$$
          | $$__  $$| $$
  /$$$$$$ | $$  \\ $$| $$$$$$$   /$$$$$$   /$$$$$$$  /$$$$$$
 /$$__  $$| $$$$$$$/| $$__  $$ |____  $$ /$$_____/ /$$__  $$
| $$  \\ $$| $$____/ | $$  \\ $$  /$$$$$$$|  $$$$$$ | $$$$$$$$
| $$  | $$| $$      | $$  | $$ /$$__  $$ \\____  $$| $$_____/
| $$$$$$$/| $$      | $$  | $$|  $$$$$$$ /$$$$$$$/|  $$$$$$$
| $$____/ |__/      |__/  |__/ \\_______/|_______/  \\_______/
| $$
|__/`,
      'color: #00ff88; font-family: monospace'
    )
    console.log(
      '%cStop!',
      'color: #ff4444; font-size: 24px; font-weight: bold'
    )
    console.log(
      '%cThis is a browser feature intended for developers. Do not paste any code or scripts here — it could compromise your account.',
      'color: #ffaa00; font-size: 14px'
    )
    console.log(
      '%cFeature requests: %chttps://github.com/phasehq/console/issues',
      'color: #888; font-size: 12px',
      'color: #58a6ff; font-size: 12px'
    )
    console.log(
      '%cNeed help? Join our Slack: %chttps://slack.phase.dev',
      'color: #888; font-size: 12px',
      'color: #58a6ff; font-size: 12px'
    )
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
