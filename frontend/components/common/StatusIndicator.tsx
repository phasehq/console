'use client'

import Link from 'next/link'
import { Button } from './Button'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { isCloudHosted } from '@/utils/appConfig'

export type Status = {
  indicator: 'none' | 'minor' | 'major' | 'critical' | 'error'
  description: string
}

export const STATUS_PAGE_BASE_URL = 'https://phase.statuspage.io'

// Fetches the public status once. `enabled` is false when self-hosted, where there is nothing to show
export const useSystemStatus = () => {
  const [status, setStatus] = useState<Status | null>(null)
  const [isLoading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    const getStatus = async () => {
      setLoading(true)
      try {
        await fetch(`${STATUS_PAGE_BASE_URL}/api/v2/status.json`).then((res) => {
          setLoading(false)
          if (!res.ok) throw 'Fetch error'
          else {
            res.json().then((json) => {
              setStatus(json.status)
            })
          }
        })
      } catch (e) {
        console.log(`Error getting system status: ${e}`)
        setLoading(false)
        setStatus({
          indicator: 'error',
          description: 'Error fetching status',
        })
      }
    }

    if (isCloudHosted()) getStatus()
  }, [])

  return { status, isLoading, enabled: isCloudHosted() }
}

export const statusColor = (status: Status | null) => {
  switch (status?.indicator) {
    case 'none':
      return 'bg-emerald-500'
    case 'minor':
      return 'bg-yellow-500'
    case 'major':
      return 'bg-orange-500'
    case 'critical':
      return 'bg-red-500'
    default:
      return 'bg-neutral-500'
  }
}

export const StatusIndicator = () => {
  const { status, isLoading, enabled } = useSystemStatus()

  if (!enabled) return <></>

  return (
    <Link href={STATUS_PAGE_BASE_URL} target="_blank" className="hidden lg:block">
      <Button variant="secondary">
        <span
          className={clsx(
            'h-2 w-2 mr-1 rounded-full',
            statusColor(status),
            isLoading && 'animate-pulse'
          )}
        ></span>
        <span className="truncate whitespace-nowrap">{status?.description || 'Loading'}</span>
      </Button>
    </Link>
  )
}
