'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getHealth } from '@/utils/appConfig'
import clsx from 'clsx'
import { relativeTimeFromDates } from '@/utils/time'

const GITHUB_REPO = 'phasehq/console' // Update with your GitHub repo

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

  return (
    <div className="flex flex-col space-y-4 border-l border-neutral-500/40">
      {releases.map((release, index) => (
        <div key={release.id} className="flex gap-2 items-start">
          <div
            className={clsx(
              'h-2 w-2 rounded-full -ml-1 mt-2',
              release.tag_name === healthData.version
                ? latestRelease.tag_name === healthData.version
                  ? 'bg-emerald-500 font-bold'
                  : 'bg-amber-500 font-bold'
                : 'bg-neutral-500 hover:bg-neutral-400'
            )}
          ></div>
          <div className="flex flex-col">
            <Link
              href={release.html_url}
              target="_blank"
              rel="noreferrer"
              className={`transition ease text-sm ${
                release.tag_name === healthData.version
                  ? latestRelease.tag_name === healthData.version
                    ? 'text-emerald-500 font-bold'
                    : 'text-amber-500 font-bold'
                  : 'text-neutral-500 hover:text-neutral-400'
              }`}
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
  )
}
