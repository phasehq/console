'use client'

import Link from 'next/link'
import { Button } from './Button'
import { useEffect, useState } from 'react'
import clsx from 'clsx'

type Status = {
  indicator: 'none' | 'minor' | 'major' | 'critical' | 'error'
  description: string
}

export const StatusIndicator = () => {
  const [mounted, setMounted] = useState<boolean>(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [isLoading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const getStatus = async () => {
      setLoading(true)
      try {
        await fetch(process.env.NEXT_PUBLIC_STATUSPAGE_API_URL!).then(res => {
          setLoading(false)
          if (!res.ok) throw ('Fetch error')
          else {
            res.json().then(json => {
              setStatus(json.status)
            })
          }
        })
      } catch (e) {
        console.log(`Error getting system status: ${e}`)
        setLoading(false)
        setStatus({
          indicator: 'error',
          description: 'Error fetching status'
        })
      }
    }

    if (mounted) getStatus()
  }, [mounted])

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

  if (!mounted) return null

  return (
    <>
    <Link href="https://phase.statuspage.io/" target="_blank">
      <Button variant="secondary">
        <span
          className={clsx(
            'h-2 w-2 mr-1 rounded-full',
            statusColor(),
            isLoading && 'animate-pulse'
          )}
        ></span>
        {status?.description || 'Loading'}
      </Button>
    </Link>
    </>
  )
}
