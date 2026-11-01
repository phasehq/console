'use client'

import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import Spinner from '@/components/common/Spinner'
import { organisationContext } from '@/contexts/organisationContext'
import { isCloudHosted } from '@/utils/appConfig'
import { refreshCsrfToken } from '@/apollo/client'
import { toast } from 'react-toastify'
import { usePathname } from 'next/navigation'
import { useContext, useState } from 'react'
import { FaExternalLinkAlt } from 'react-icons/fa'

export const SetupGhAuth = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const path = usePathname()

  const [name, setName] = useState<string>('GitHub OAuth credentials')
  const [isPending, setIsPending] = useState(false)

  const clientId = process.env.NEXT_PUBLIC_GITHUB_INTEGRATION_CLIENT_ID

  const initiateOAuth = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setIsPending(true)

    // Real form POST (not fetch) so the backend's 302 to GitHub drives a
    // top-level navigation; the CSRF token rides in a form field since
    // form POSTs can't set headers. Always fetch fresh — a top-level
    // navigation can't retry a stale token.
    const csrfToken = await refreshCsrfToken()
    if (!csrfToken) {
      // A token-less submit would land on the backend's raw 403 page
      toast.error('Could not initialize the request. Please check your connection and try again.')
      setIsPending(false)
      return
    }

    const hostname = `${window.location.protocol}//${window.location.host}`

    const fields: Record<string, string> = {
      csrfmiddlewaretoken: csrfToken,
      orgId: organisation!.id,
      returnUrl: path ?? '/',
      name,
    }

    const form = document.createElement('form')
    form.method = 'POST'
    form.action = `${hostname}/service/oauth/github/authorize`
    for (const [key, value] of Object.entries(fields)) {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = key
      input.value = value
      form.appendChild(input)
    }
    document.body.appendChild(form)
    form.submit()
  }

  const disabled = !clientId || clientId?.includes('BAKED')

  const docsLink =
    'https://docs.phase.dev/self-hosting/configuration/envars#git-hub-integration'

  return (
    <form className="space-y-6" onSubmit={initiateOAuth}>
      {isPending ? (
        <div className="flex items-center justify-center gap-2">
          <Spinner size="md" />
          <span className="font-medium text-black dark:text-white">Setting up GitHub...</span>
        </div>
      ) : (
        <div className="text-neutral-500 space-y-4">
          {!isCloudHosted() && (
            <div className="space-y-2">
              <p>Use OAuth to generate authentication credentials on GitHub.com.</p>
              <p>For GitHub Enterprise Server, use the Access Token tab.</p>
            </div>
          )}

          <Input
            value={name}
            setValue={setName}
            label="Name"
            placeholder="GitHub OAuth credentials"
            required
            disabled={disabled}
          />

          {disabled && (
            <Alert variant="danger" size="sm" icon={true}>
              <p>
                This integration has not been set up. Please supply the{' '}
                <span className="font-mono">GITHUB_INTEGRATION_CLIENT_ID</span> and{' '}
                <span className="font-mono">GITHUB_INTEGRATION_CLIENT_SECRET</span>.
                Please refer to the{' '}
                <a className="underline" href={docsLink} target="_blank" rel="noreferrer">
                  Docs
                </a>{' '}
                to configure this integration, or contact your admin.
              </p>
            </Alert>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button disabled={disabled} type="submit" isLoading={isPending} variant="primary">
          <FaExternalLinkAlt /> Authenticate with GitHub
        </Button>
      </div>
    </form>
  )
}
