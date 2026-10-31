'use client'

import { useContext, useEffect } from 'react'
import { useQuery } from '@apollo/client'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { GetPendingAgentRequestIds } from '@/graphql/queries/agents/getPendingAgentRequestIds.gql'

// Hidden tabs poll too, so a request that arrives while the console sits in a
// background tab still marks its title. Browsers throttle hidden timers to about
// once a minute anyway.
const PENDING_REQUEST_POLL_MS = 60_000

// Under /assets so it loads without a session check, like /favicon.svg.
const ATTENTION_FAVICON = '/assets/images/favicon-attention.svg'

/**
 * How many Agent requests are waiting, for the app-wide cues: the sidebar badge,
 * the tab title and the favicon. One caller polls (the navbar); the rest read the
 * same cache entry, which the Agents pages also refresh.
 */
export function usePendingAgentRequestCount({ poll = false }: { poll?: boolean } = {}) {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const permissions = organisation?.role?.permissions
  const canRead = !!permissions && userHasPermission(permissions, 'AgentRequests', 'read')
  const { data } = useQuery(GetPendingAgentRequestIds, {
    variables: { organisationId: organisation?.id },
    skip: !organisation?.id || !canRead,
    fetchPolicy: poll ? 'cache-and-network' : 'cache-only',
    pollInterval: poll ? PENDING_REQUEST_POLL_MS : undefined,
  })
  return canRead ? (data?.agentRequests || []).filter(Boolean).length : 0
}

/** "(2) Apps · acme | Phase Console" while requests are pending. */
export const withPendingRequestCount = (title: string, count: number) =>
  count > 0 ? `(${count}) ${title}` : title

/** Shows the favicon with an amber dot while requests are pending. */
export function usePendingRequestFavicon(pending: boolean) {
  useEffect(() => {
    if (!pending) return
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')
    const original = icon?.getAttribute('href')
    if (!icon || !original) return
    icon.setAttribute('href', ATTENTION_FAVICON)
    return () => icon.setAttribute('href', original)
  }, [pending])
}
