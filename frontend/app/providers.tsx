'use client'

import { ThemeProvider } from '@/contexts/themeContext'
import { SessionProvider } from 'next-auth/react'
import { ApolloProvider } from '@apollo/client'
import { graphQlClient } from '@/apollo/client'
import { KeyringProvider } from '@/contexts/keyringContext'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <KeyringProvider>
          <ApolloProvider client={graphQlClient}>{children}</ApolloProvider>
        </KeyringProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
