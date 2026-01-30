'use client'

import { LockboxType } from '@/apollo/graphql'
import { boxExpiryString, updateBoxViewCount } from '@/utils/lockbox'
import { useEffect, useState } from 'react'
import { Button } from '../common/Button'
import CopyButton from '../common/CopyButton'
import { Alert } from '../common/Alert'
import { Card } from '../common/Card'
import { toast } from 'react-toastify'
import { decryptBox } from '@/utils/crypto'
import clsx from 'clsx'

export const LockboxViewer = (props: { box: LockboxType }) => {
  const { box } = props

  const expiryDescription = boxExpiryString(
    box.expiresAt,
    box.allowedViews ? box.allowedViews - box.views : undefined
  )

  const [key, setKey] = useState('')

  const [secret, setSecret] = useState('')

  useEffect(() => {
    if (window.location.hash) {
      setKey(window.location.hash.replace('#', ''))
    }
  }, [])

  const handleOpenBox = async () => {
    try {
      const boxData: { text: string } = JSON.parse(await decryptBox(box.data.data, key))
      setSecret(boxData.text)
    } catch (err) {
      toast.error('Something wrong opening this box. Please check the link and try again!')
    }

    updateBoxViewCount(box.id)
  }

  return (
    <div className="flex flex-col flex-1">
      <div className="w-full flex-1 min-h-0 flex flex-col justify-center">
        {/* Header - compact when secret is shown */}
        <div className={clsx('text-center flex-shrink-0', secret ? 'py-4' : 'py-8 md:py-16')}>
          <h1 className={clsx('font-semibold', secret ? 'text-2xl' : 'text-3xl md:text-4xl')}>
            Lockbox
          </h1>
          {!secret && (
            <p className="text-neutral-500 text-base md:text-lg mt-2 max-w-lg mx-auto">
              You&apos;ve received a secret via Phase Lockbox, secured with Zero-Trust encryption.
            </p>
          )}
        </div>

        {/* Content */}
        {secret ? (
          <div className="flex-shrink min-h-0 flex flex-col p-4 relative group font-mono text-sm break-all ring-1 ring-inset ring-neutral-500/40 bg-zinc-200 dark:bg-zinc-800 rounded-lg ph-no-capture shadow-2xl">
            <div className="absolute right-2 top-3.5 z-10 bg-zinc-200 dark:bg-zinc-800 rounded-bl-lg pl-2 pb-2">
              <CopyButton value={secret} />
            </div>
            <div className="flex-1 overflow-y-auto pt-8 px-2 whitespace-pre-wrap">{secret}</div>
          </div>
        ) : (
          <div className="space-y-4 max-w-md mx-auto w-full">
            <Card>
              <div className="p-12 md:p-16 rounded-lg flex items-center justify-center">
                <Button variant="primary" onClick={handleOpenBox}>
                  View Secret
                </Button>
              </div>
            </Card>

            <Alert variant="info" icon={true} size="sm">
              {expiryDescription}
            </Alert>
          </div>
        )}
      </div>
    </div>
  )
}
