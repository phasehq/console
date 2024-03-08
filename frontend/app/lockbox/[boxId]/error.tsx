'use client' // Error components must be Client components

import { useEffect } from 'react'
import { FaBoxOpen } from 'react-icons/fa'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="h-screen w-full text-black dark:text-white flex flex-col md:gap-16">
      <div className="mx-auto my-auto max-w-6xl p-4 text-center">
        <div className="space-y-2 my-auto">
          <FaBoxOpen className="text-neutral-500/40 size-40 mx-auto" />

          <div className="text-4xl font-semibold">Phase Lockbox</div>
          <div className="text-neutral-500 text-lg">
            This box has either expired or doesn&apos;t exist!
          </div>
        </div>
      </div>
    </div>
  )
}
