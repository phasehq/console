import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Backward-compatible redirects for legacy NextAuth authentication callback URLs.
 *
 * Old (NextAuth):  /api/auth/callback/{provider}
 * New (backend):   /service/auth/sso/{provider}/callback/
 *
 * Self-hosted instances may still have the old URL registered with their
 * OAuth providers. This route catches those callbacks and redirects to
 * the backend with all query params preserved.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { provider, ...queryParams } = req.query

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(queryParams)) {
    if (typeof value === 'string') {
      params.set(key, value)
    }
  }

  const backendBase = process.env.NEXT_PUBLIC_BACKEND_API_BASE || '/service'
  const target = `${backendBase}/auth/sso/${provider}/callback/?${params.toString()}`

  res.redirect(302, target)
}
