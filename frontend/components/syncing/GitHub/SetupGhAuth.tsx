'use client'

import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import Spinner from '@/components/common/Spinner'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { organisationContext } from '@/contexts/organisationContext'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { Fragment, useContext, useEffect, useState } from 'react'
import { FaExternalLinkAlt } from 'react-icons/fa'
import { FaGithub } from 'react-icons/fa6'

export const SetupGhAuth = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const path = usePathname()

  const [tabIndex, setTabIndex] = useState(0)
  const [hostUrl, setHostUrl] = useState<string>('https://github.com')
  const [apiUrl, setApiUrl] = useState<string>('https://api.github.com')
  const [isPending, setIsPending] = useState(false)

  const initiateOAuth = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setIsPending(true)
    const clientId = process.env.NEXT_PUBLIC_GITHUB_INTEGRATION_CLIENT_ID
    const hostname = `${window.location.protocol}//${window.location.host}`
    const redirectUri = `${hostname}/service/oauth/github/callback`
    const scope = 'user,repo,admin:repo_hook,read:org'

    const statePayload = {
      returnUrl: path,
      orgId: organisation!.id,
      hostUrl,
      apiUrl,
    }

    const state = btoa(JSON.stringify(statePayload))

    const authUrl = `${hostUrl}/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`

    window.open(authUrl, '_self')
  }

  useEffect(() => {
    if (tabIndex === 0) {
      setHostUrl('https://github.com')
      setApiUrl('https://api.github.com') //api.github.com</|end_of_text|>)
    }
  }, [tabIndex])

  return (
    <form className="space-y-4" onSubmit={initiateOAuth}>
      {isPending ? (
        <div className="flex items-center justify-center gap-2">
          <Spinner size="md" />
          <span className="font-medium text-black dark:text-white">Setting up GitHub...</span>
        </div>
      ) : (
        <>
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
                    GitHub Cloud
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
                    GitHub Enterprise (Self-hosted)
                  </div>
                )}
              </Tab>
            </Tab.List>
          </Tab.Group>

          {tabIndex === 0 ? (
            <div className="text-neutral-500">
              <p>Choose this option to authenticate with GitHub cloud.</p>
              <p>
                Authencation credentials will be created via OAuth 2.0 on{' '}
                <span className="text-xs font-mono font-medium text-zinc-900 dark:text-zinc-100 ring-1 ring-inset ring-neutral-500/40 bg-neutral-500/20 rounded-md px-1">
                  {hostUrl}
                </span>
                , and secrets will be synced via{' '}
                <span className="text-xs font-mono font-medium text-zinc-900 dark:text-zinc-100 ring-1 ring-inset ring-neutral-500/40 bg-neutral-500/20 rounded-md px-1">
                  {apiUrl}
                </span>
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-neutral-500">
                <p>
                  Choose this option to authenticate with a self-hosted GitHub Enterprise instance.
                </p>
                <p>Enter your Host and API URL below.</p>
              </div>

              <Input
                value={hostUrl}
                setValue={setHostUrl}
                label="GitHub Host"
                readOnly={tabIndex === 0}
                placeholder="https://github.yourdomain.com"
                required
                type="url"
              />
              <Input
                value={apiUrl}
                setValue={setApiUrl}
                label="GitHub API URL"
                readOnly={tabIndex === 0}
                placeholder="https://github.yourdomain.com/api"
                required
                type="url"
              />
            </div>
          )}
        </>
      )}
      <div className="flex justify-end">
        <Button type="submit" isLoading={isPending} variant="primary">
          <FaExternalLinkAlt /> Authenticate with GitHub
        </Button>
      </div>
    </form>
  )
}
