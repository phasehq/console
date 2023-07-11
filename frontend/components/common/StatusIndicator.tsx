'use client'

import Link from 'next/link'
import { Button } from './Button'
import axios from 'axios'
import { useEffect, useState } from 'react'
import clsx from 'clsx'

type Status = {
  indicator: 'none' | 'minor' | 'major' | 'critical' | 'error'
  description: string
}

export const StatusIndicator = () => {
  const [status, setStatus] = useState<Status | null>(null)
  const [isLoading, setLoading] = useState<boolean>(false)

  
  useEffect(() => {
    const getStatus = async () => {
      setLoading(true)
      try {
        const response = await axios.get(process.env.NEXT_PUBLIC_STATUSPAGE_API_URL!)
        if (response) setStatus(response.data.status)
        setLoading(false)
      } catch (e) {
        console.log(`Error getting system status: ${e}`)
        setLoading(false)
        setStatus({
          indicator: 'error',
          description: 'Error fetching status'
        })
      }
    }

    getStatus()
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
