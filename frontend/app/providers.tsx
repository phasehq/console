'use client'

import { ThemeProvider } from '@/contexts/themeContext'
import { SessionProvider } from 'next-auth/react'
import { ApolloProvider } from '@apollo/client'
import { graphQlClient } from '@/apollo/client'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <ApolloProvider client={graphQlClient}>{children}</ApolloProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
