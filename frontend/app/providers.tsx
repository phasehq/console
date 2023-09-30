'use client'

import { ThemeProvider } from '@/contexts/themeContext'
import { SessionProvider } from 'next-auth/react'
import { ApolloProvider } from '@apollo/client'
import { graphQlClient } from '@/apollo/client'
import { KeyringProvider } from '@/contexts/keyringContext'
import { OrganisationProvider } from '@/contexts/organisationContext'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <ApolloProvider client={graphQlClient}>
          <OrganisationProvider>
            <KeyringProvider>{children}</KeyringProvider>
          </OrganisationProvider>
        </ApolloProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
