'use client'

import { Button } from '@/components/common/Button'
import { HeroPattern } from '@/components/common/HeroPattern'
import { useEffect } from 'react'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'
import { isChunkLoadError } from '@/utils/chunkLoadErrors'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  // Re-rendering can't recover a missing chunk: the bundler runtime caches the failed load for
  // the life of the page, so reload to pick up the current build instead.
  const chunkLoadError = isChunkLoadError(error)

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="w-full h-screen" role="alert" aria-live="assertive">
      <HeroPattern />
      <OnboardingNavbar />
      <div className="flex flex-col gap-4 justify-center items-center w-full h-full">
        <div className="text-center max-w-md px-4">
          <h2 className="text-zinc-900 dark:text-zinc-100 font-semibold text-lg">
            Something went wrong!
          </h2>
          <p className="text-zinc-500 dark:text-zinc-400 font-mono text-sm mt-2">
            {error.name}: {error.message || 'An unexpected error occurred'}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => (chunkLoadError ? window.location.reload() : reset())}
        >
          {chunkLoadError ? 'Reload' : 'Try again'}
        </Button>
      </div>
    </main>
  )
}
