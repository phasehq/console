import posthog from 'posthog-js'

export function initializePostHog() {
  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
      capture_pageview: true,
      session_recording: {
        maskInputOptions: {
          password: true, // Mask password inputs
        },
      },
    })
  }
}
