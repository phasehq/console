'use client'

import Link from 'next/link'
import { Button } from './Button'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { isCloudHosted } from '@/utils/appConfig'

type Status = {
  indicator: 'none' | 'minor' | 'major' | 'critical' | 'error'
  description: string
}

const STATUS_PAGE_BASE_URL = 'https://phase.statuspage.io'

export const StatusIndicator = () => {
  const [status, setStatus] = useState<Status | null>(null)
  const [isLoading, setLoading] = useState<boolean>(false)

  // const [isCloudHosted, setIsCloudHosted] = useState(false)

  // useEffect(() => {

  //   if (appHost === 'cloud') setIsCloudHosted(true)
  // }, [])

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

  const statusColor = () => {
    let color = 'bg-neutral-500'
    switch (status?.indicator) {
      case 'none':
        color = 'bg-emerald-500'
        break
      case 'minor':
        color = 'bg-yellow-500'
        break
      case 'major':
        color = 'bg-orange-500'
        break
      case 'critical':
        color = 'bg-red-500'
        break
      default:
        color = 'bg-neutral-500'
    }
    return color
  }

  if (!isCloudHosted()) return <></>

  return (
    <Link href={STATUS_PAGE_BASE_URL} target="_blank" className="hidden lg:block">
      <Button variant="secondary" className="whitespace-nowrap">
        <span
          className={clsx('h-2 w-2 mr-1 rounded-full', statusColor(), isLoading && 'animate-pulse')}
        ></span>
        <span className="truncate">{status?.description || 'Loading'}</span>
      </Button>
    </Link>
  )
}
