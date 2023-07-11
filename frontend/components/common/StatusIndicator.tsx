'use client'

import Link from 'next/link'
import { Button } from './Button'
import axios from 'axios'
import { useEffect, useState } from 'react'
import clsx from 'clsx'

type Status = {
  indicator: 'none' | 'minor' | 'major' | 'critical' | 'loading' | 'error'
  description: string
}

export const StatusIndicator = () => {
  const [status, setStatus] = useState<Status>({
    indicator: 'loading',
    description: 'Loading',
  })

  
  useEffect(() => {
    const getStatus = async () => {
      console.log(process.env.NEXT_PUBLIC_APP_HOST)
      try {
        const response = await axios.get(process.env.NEXT_PUBLIC_STATUSPAGE_API_URL!)
        if (response) setStatus(response.data.status)
      } catch (e) {
        console.log(`Error getting system status: ${e}`)
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
    switch (status.indicator) {
      case 'loading':
        color = 'bg-neutral-500'
        break
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
            status.indicator === 'loading' && 'animate-pulse'
          )}
        ></span>
        {status.description}
      </Button>
    </Link>
    </>
  )
}
