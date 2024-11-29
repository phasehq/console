'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { getHealth, isCloudHosted } from '@/utils/appConfig'
import clsx from 'clsx'
import { relativeTimeFromDates } from '@/utils/time'
import { Popover, Transition } from '@headlessui/react'

const GITHUB_REPO = 'phasehq/console'

interface HealthData {
  version: string
}

interface GithubRelease {
  id: number
  name: string
  tag_name: string
  html_url: string
  published_at: string
}

const fetchGithubReleases = async (): Promise<GithubRelease[]> => {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=3`)
  if (!res.ok) {
    throw new Error('Failed to fetch GitHub releases')
  }
  return res.json()
}

export const ReleaseInfo = () => {
  const [healthData, setHealthData] = useState<HealthData | null>(null)
  const [releases, setReleases] = useState<GithubRelease[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const health = await getHealth(process.env.NEXT_PUBLIC_BACKEND_API_BASE!)
        setHealthData(health)

        const githubReleases = await fetchGithubReleases()
        setReleases(githubReleases)
      } catch (err) {
        setError((err as Error).message)
      }
    }

    fetchData()
  }, [])

  if (error) {
    return <div className="text-red-500">Error: {error}</div>
  }

  if (!healthData || releases.length === 0) {
    return <div className="text-gray-500">Loading...</div>
  }

  const latestRelease = releases[0]
  const isUpdateAvailable = latestRelease.tag_name !== healthData.version

  return (
    <div className="flex items-center gap-2">
      <span className="font-medium">Console version:</span>

      {isCloudHosted() ? (
        <span className="font-mono">{healthData.version}</span>
      ) : (
        <Popover className="relative inline-block text-left">
          {({ open }) => (
            <>
              <Popover.Button
                className="flex items-center gap-2 focus:outline-none"
                title={
                  isUpdateAvailable
                    ? 'New version of the Phase Console is available.'
                    : 'You are running the latest version of the Phase Console'
                }
              >
                <div
                  className={clsx(
                    'font-mono text-sm font-semibold transition ease',
                    isUpdateAvailable
                      ? 'text-amber-500 hover:text-amber-400'
                      : 'text-emerald-500 hover:text-emerald-400'
                  )}
                >
                  {healthData.version}
                </div>
                {isUpdateAvailable && (
                  <span className="text-xs bg-amber-500 text-black px-2 py-0.5 rounded-full">
                    Update available
                  </span>
                )}
              </Popover.Button>
              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <Popover.Panel className="absolute z-50 left-0 mt-2 w-60 p-4 origin-top-right divide-y divide-neutral-500/20 rounded-md bg-neutral-200 dark:bg-neutral-800 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
                  <div className="flex flex-col space-y-4 border-l border-neutral-500/40">
                    {releases.map((release, index) => (
                      <div key={release.id} className="flex gap-2 items-start">
                        <div
                          className={clsx(
                            'h-2 w-2 rounded-full -ml-1 mt-2',
                            release.tag_name === healthData.version
                              ? 'bg-emerald-500'
                              : index === 0
                                ? 'bg-amber-500'
                                : 'bg-neutral-500'
                          )}
                        ></div>
                        <div className="flex flex-col">
                          <Link
                            href={release.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className={clsx(
                              'transition ease text-sm',
                              release.tag_name === healthData.version
                                ? 'text-emerald-500 font-bold'
                                : index === 0
                                  ? 'text-amber-500 font-bold'
                                  : 'text-neutral-500 hover:text-neutral-400'
                            )}
                          >
                            {release.tag_name === healthData.version ? (
                              <strong>
                                Current:{' '}
                                <span className="font-mono">
                                  {release.name} ({release.tag_name})
                                </span>
                              </strong>
                            ) : (
                              <>
                                {index === 0 && <strong>Latest:</strong>}{' '}
                                <span className="font-mono">
                                  {release.name} ({release.tag_name})
                                </span>
                              </>
                            )}
                          </Link>
                          <p className="text-neutral-400 text-xs">
                            {relativeTimeFromDates(new Date(release.published_at))}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Popover.Panel>
              </Transition>
            </>
          )}
        </Popover>
      )}
    </div>
  )
}
