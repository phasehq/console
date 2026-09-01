'use client'

import { use } from 'react'

// Side-nav commented out — only one section (OIDC) for now.
// Uncomment and add tabs when SAML/LDAP sections are added.

export default function SSOLayout({
  children,
  params,
}: {
  params: Promise<{ team: string }>
  children: React.ReactNode
}) {
  use(params)

  return <div className="h-full px-3 sm:px-4 lg:px-6">{children}</div>
}
