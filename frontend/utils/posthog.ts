import posthog from 'posthog-js'

export function initializePostHog() {
  if (
    typeof window !== 'undefined' &&
    !process.env.NEXT_PUBLIC_POSTHOG_KEY?.startsWith('BAKED_') &&
    !process.env.NEXT_PUBLIC_POSTHOG_HOST?.startsWith('BAKED_')
  ) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      capture_pageview: true,
      capture_pageleave: true,
      person_profiles: 'always',
      session_recording: {
        maskInputOptions: {
          password: true, // Mask password inputs
        },
      },
    })
  }
}
