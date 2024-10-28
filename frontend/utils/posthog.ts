import posthog from 'posthog-js'

export function initializePostHog() {
  if (
    typeof window !== 'undefined' &&
    !process.env.NEXT_PUBLIC_POSTHOG_KEY?.startsWith('BAKED_') &&
    !process.env.NEXT_PUBLIC_POSTHOG_HOST?.startsWith('BAKED_')
  ) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
      capture_pageview: true,
      // Sanitize properties to remove URL fragments
      sanitize_properties: (properties, event_name) => {
        const sanitized = { ...properties }
        
        // Clean URL fragments from $current_url
        if (sanitized.$current_url) {
          sanitized.$current_url = sanitized.$current_url.split('#')[0]
        }
        
        // Clean URL fragments from $referrer
        if (sanitized.$referrer) {
          sanitized.$referrer = sanitized.$referrer.split('#')[0]
        }

        return sanitized
      },
      // Additional security for session recordings
      session_recording: {
        maskInputOptions: {
          password: true, // Mask password inputs
        },
      },
    })
  }
}
