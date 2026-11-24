'use client'

import { use } from 'react'
import { redirect, useSearchParams } from 'next/navigation'
import { requestsRedirectPath } from '@/utils/agents/routes'

/**
 * Requests moved to the main navigation. Approval links handed to Agents
 * still point here, so this keeps them working, query string included.
 */
export default function AgentRequestsRedirect(props: { params: Promise<{ team: string }> }) {
  const params = use(props.params)
  const searchParams = useSearchParams()
  redirect(requestsRedirectPath(params.team, searchParams))
}
