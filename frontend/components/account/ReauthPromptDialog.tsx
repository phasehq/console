'use client'

import { useEffect, useRef, useState } from 'react'
import { FaArrowRight, FaTimes, FaUserClock } from 'react-icons/fa'
import { registerReauthPromptListener } from '@/utils/accountErrors'
import { Button } from '../common/Button'
import GenericDialog from '../common/GenericDialog'

type DialogHandle = { openModal: () => void; closeModal: () => void }

// Mounted once on the account page. When a sensitive action hits the
// fresh-session gate (or a pre-check sees a stale session), this asks the
// user before navigating to /login instead of yanking them there. Cancel
// leaves the interrupted dialog and its state untouched — the gated
// mutation was rejected server-side with no side effects.
export default function ReauthPromptDialog() {
  const dialogRef = useRef<DialogHandle>(null)
  const [loginUrl, setLoginUrl] = useState<string | null>(null)
  const [navigating, setNavigating] = useState(false)

  useEffect(
    () =>
      registerReauthPromptListener((url) => {
        setLoginUrl(url)
        setNavigating(false)
        dialogRef.current?.openModal()
      }),
    []
  )

  const handleSignIn = () => {
    if (!loginUrl) return
    setNavigating(true)
    window.location.href = loginUrl
  }

  return (
    <GenericDialog ref={dialogRef} title="Confirm it's you" size="sm">
      <div className="space-y-6 pt-2">
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          {/* The medallion carries the staleness cue the copy used to spell out. */}
          <div className="rounded-full bg-amber-300/40 dark:bg-amber-400/10 ring-1 ring-inset ring-amber-500/40 p-4">
            <FaUserClock className="size-7 text-amber-500" />
          </div>
          <p className="text-sm text-neutral-500 max-w-xs">
            This is a sensitive change, please sign in again to confirm it&apos;s you.
          </p>
        </div>
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            type="button"
            icon={FaTimes}
            onClick={() => dialogRef.current?.closeModal()}
            disabled={navigating}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={FaArrowRight}
            iconPosition="right"
            onClick={handleSignIn}
            isLoading={navigating}
            disabled={navigating}
          >
            Sign in again
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
