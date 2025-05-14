// lib/auth/providers/GitHubEnterpriseProvider.ts

import type { OAuthConfig, OAuthUserConfig } from 'next-auth/providers'
import { GithubEmail, GithubProfile } from 'next-auth/providers/github'

export default function GitHubEnterpriseProvider<P extends GithubProfile>(
  options: OAuthUserConfig<P>
): OAuthConfig<P> {
  const baseUrl = process.env.GITHUB_ENTERPRISE_BASE_URL
  const apiUrl = process.env.GITHUB_ENTERPRISE_API_URL

  if (!baseUrl || !apiUrl) {
    throw new Error('GITHUB_ENTERPRISE_BASE_URL and GITHUB_ENTERPRISE_API_URL must be set')
  }

  return {
    id: 'github-enterprise',
    name: 'GitHub Enterprise',
    type: 'oauth',
    authorization: {
      url: `${baseUrl}/login/oauth/authorize`,
      params: { scope: 'read:user user:email' },
    },
    token: `${baseUrl}/login/oauth/access_token`,
    userinfo: {
      url: `${apiUrl}/user`,
      async request({ client, tokens }) {
        const profile = await client.userinfo(tokens.access_token!)

        if (!profile.email) {
          const res = await fetch(`${apiUrl}/user/emails`, {
            headers: { Authorization: `token ${tokens.access_token}` },
          })

          if (res.ok) {
            const emails: GithubEmail[] = await res.json()
            profile.email = (emails.find((e) => e.primary) ?? emails[0])?.email
          }
        }

        return profile
      },
    },
    profile(profile) {
      return {
        id: profile.id.toString(),
        name: profile.name ?? profile.login,
        email: profile.email,
        image: profile.avatar_url,
      }
    },
    style: {
      logo: '/github-enterprise.svg',
      bg: '#8250df',
      text: '#fff',
    },
    options,
  }
}
