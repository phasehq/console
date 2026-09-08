'use client'
import { use } from 'react'

import { redirect } from 'next/navigation'

export default function SSOPage(props: { params: Promise<{ team: string }> }) {
  const params = use(props.params)
  redirect(`/${params.team}/access/sso/oidc`)
}
