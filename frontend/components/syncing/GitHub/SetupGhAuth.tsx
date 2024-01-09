'use client'

import Spinner from '@/components/common/Spinner'
import { organisationContext } from '@/contexts/organisationContext'
import { usePathname } from 'next/navigation'
import { useContext, useEffect } from 'react'

export const SetupGhAuth = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const path = usePathname()

  useEffect(() => {
    const initiateOAuth = () => {
      const clientId = process.env.NEXT_PUBLIC_GITHUB_INTEGRATION_CLIENT_ID
      const hostname = `${window.location.protocol}//${window.location.host}`
      const redirectUri = `${hostname}/service/oauth/github/callback`
      const scope = 'repo,admin:repo_hook,public_repo'

      const statePayload = {
        returnUrl: path,
        orgId: organisation!.id,
      }

      const state = btoa(JSON.stringify(statePayload))

      const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`

      window.open(authUrl, '_self')
    }

    initiateOAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex items-center justify-center gap-2">
      <Spinner size="md" />
      <span className="font-medium text-black dark:text-white">Setting up GitHub...</span>
    </div>
  )
}
