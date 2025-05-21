'use client'

import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import Spinner from '@/components/common/Spinner'
import { organisationContext } from '@/contexts/organisationContext'
import { isCloudHosted } from '@/utils/appConfig'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { Fragment, useContext, useEffect, useState } from 'react'
import { FaExternalLinkAlt } from 'react-icons/fa'

export const SetupGhAuth = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const path = usePathname()

  const DEFAULT_NAME = 'GitHub OAuth credentials'
  const DEFAULT_ENTERPRISE_NAME = 'GitHub Enterprise OAuth credentials'

  const [tabIndex, setTabIndex] = useState(0)
  const [name, setName] = useState<string>(DEFAULT_NAME)
  const [hostUrl, setHostUrl] = useState<string>('https://github.com')
  const [apiUrl, setApiUrl] = useState<string>('https://api.github.com')
  const [isPending, setIsPending] = useState(false)

  const isEnterprise = tabIndex === 1

  const clientId = isEnterprise
    ? process.env.NEXT_PUBLIC_GITHUB_ENTERPRISE_INTEGRATION_CLIENT_ID
    : process.env.NEXT_PUBLIC_GITHUB_INTEGRATION_CLIENT_ID

  const initiateOAuth = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setIsPending(true)

    const hostname = `${window.location.protocol}//${window.location.host}`
    const redirectUri = `${hostname}/service/oauth/github/callback`
    const scope = 'user,repo,admin:repo_hook,read:org'

    const statePayload = {
      returnUrl: path,
      orgId: organisation!.id,
      hostUrl,
      apiUrl,
      isEnterprise,
      name,
    }

    const state = btoa(JSON.stringify(statePayload))

    const authUrl = `${hostUrl}/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}&prompt=consent`

    window.open(authUrl, '_self')
  }

  useEffect(() => {
    if (tabIndex === 0) {
      setHostUrl('https://github.com')
      setApiUrl('https://api.github.com')

      setName(DEFAULT_NAME)
    } else setName(DEFAULT_ENTERPRISE_NAME)
  }, [tabIndex])

  const disabled = !clientId || clientId?.includes('BAKED')

  const docsLink =
    'https://docs.phase.dev/self-hosting/configuration/envars#git-hub-enterprise-self-hosted-integration'

  return (
    <form className="space-y-6" onSubmit={initiateOAuth}>
      {isPending ? (
        <div className="flex items-center justify-center gap-2">
          <Spinner size="md" />
          <span className="font-medium text-black dark:text-white">Setting up GitHub...</span>
        </div>
      ) : (
        <>
          {!isCloudHosted() && (
            <Tab.Group selectedIndex={tabIndex} onChange={(index) => setTabIndex(index)}>
              <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20">
                <Tab as={Fragment}>
                  {({ selected }) => (
                    <div
                      className={clsx(
                        'p-3 font-medium border-b focus:outline-none text-black dark:text-white',
                        selected
                          ? 'border-emerald-500 font-semibold text-emerald-500'
                          : ' border-transparent cursor-pointer'
                      )}
                    >
                      GitHub
                    </div>
                  )}
                </Tab>

                <Tab as={Fragment}>
                  {({ selected }) => (
                    <div
                      className={clsx(
                        'p-3 font-medium border-b focus:outline-none text-black dark:text-white',
                        selected
                          ? 'border-emerald-500 font-semibold'
                          : ' border-transparent cursor-pointer'
                      )}
                    >
                      GitHub Enterprise Server
                    </div>
                  )}
                </Tab>
              </Tab.List>
            </Tab.Group>
          )}

          {tabIndex === 0 ? (
            <div className="text-neutral-500 space-y-4">
              {!isCloudHosted() && (
                <p className="pb-4">Use OAuth to generate authentication credentials on GitHub.com</p>
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
                    <a className="underline" href={githubComDocsLink} target="_blank" rel="noreferrer">
                      Docs
                    </a>{' '}
                    to configure this integration, or contact your admin.
                  </p>
                </Alert>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-neutral-500">
                <p>
                  Use OAuth to generate authentication credentials on GitHub Enterprise Server.
                </p>
              </div>

              {disabled && (
                <Alert variant="danger" size="sm" icon={true}>
                  <p>
                    This integration has not been set up. Please supply the{' '}
                    <span className="font-mono">
                      GITHUB_ENTERPRISE_INTEGRATION_CLIENT_ID
                    </span>{' '}
                    and{' '}
                    <span className="font-mono">
                      GITHUB_ENTERPRISE_INTEGRATION_CLIENT_SECRET
                    </span>
                    . Please refer to the{' '}
                    <a className="underline" href={docsLink} target="_blank" rel="noreferrer">
                      Docs
                    </a>{' '}
                    to configure this integration, or contact your admin.
                  </p>
                </Alert>
              )}

              <Input
                value={name}
                setValue={setName}
                label="Name"
                placeholder="GitHub OAuth credentials"
                required
                disabled={disabled}
              />
              <Input
                value={hostUrl}
                setValue={setHostUrl}
                label="GitHub Host"
                readOnly={tabIndex === 0}
                placeholder="https://github.yourdomain.com"
                required
                type="url"
                disabled={disabled}
              />
              <Input
                value={apiUrl}
                setValue={setApiUrl}
                label="GitHub API URL"
                readOnly={tabIndex === 0}
                placeholder="https://github.yourdomain.com/api"
                required
                type="url"
                disabled={disabled}
              />
            </div>
          )}
        </>
      )}

      <div className="flex justify-end">
        <Button disabled={disabled} type="submit" isLoading={isPending} variant="primary">
          <FaExternalLinkAlt /> Authenticate with GitHub
        </Button>
      </div>
    </form>
  )
}
