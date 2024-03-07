'use client'

import { LockboxType } from '@/apollo/graphql'
import { boxExpiryString, decryptBox, updateBoxViewCount } from '@/utils/lockbox'
import { useEffect, useState } from 'react'
import { Button } from '../common/Button'
import CopyButton from '../common/CopyButton'
import { Alert } from '../common/Alert'
import { Card } from '../common/Card'
import { toast } from 'react-toastify'

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
    <div className="space-y-4">
      {secret ? (
        <div className="p-4 relative group font-mono text-sm break-all ring-1 ring-inset ring-neutral-500/40 bg-zinc-200 dark:bg-zinc-800 rounded-lg">
          <div className="absolute right-2 top-3.5 z-20 ">
            <CopyButton value={secret} />
          </div>
          {secret}
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <div className="p-20  rounded-lg flex items-center justify-center">
              <Button variant="primary" onClick={handleOpenBox}>
                Decrypt and Open
              </Button>
            </div>
          </Card>

          <div>
            <Alert variant="info" icon={true} size="sm">
              {expiryDescription}
            </Alert>
          </div>
        </div>
      )}
    </div>
  )
}
