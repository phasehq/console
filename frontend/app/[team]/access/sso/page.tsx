'use client'

import { redirect } from 'next/navigation'

export default function SSOPage({ params }: { params: { team: string } }) {
  redirect(`/${params.team}/access/sso/oidc`)
}
