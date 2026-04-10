import type { OAuthConfig, OAuthUserConfig } from 'next-auth/providers'

export interface AutheliaProfile extends Record<string, any> {
  sub: string
  name: string
  preferred_username: string
  email: string
  email_verified: boolean
  picture?: string
}

type AutheliaProviderConfig = Omit<OAuthUserConfig<AutheliaProfile>, 'clientId'> & {
  clientId: string
  clientSecret: string
  issuer: string
}

export function AutheliaProvider(options: AutheliaProviderConfig): OAuthConfig<AutheliaProfile> {
  const issuer = options.issuer

  if (!issuer) {
    throw new Error('AUTHELIA_URL must be set')
  }

  const config: OAuthConfig<AutheliaProfile> = {
    id: options.id || 'authelia',
    name: options.name || 'Authelia',
    type: 'oauth',
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    wellKnown: `${issuer}/.well-known/openid-configuration`,
    authorization: {
      params: { scope: 'openid email profile' },
    },
    idToken: true,
    checks: ['pkce', 'state', 'nonce'],
    client: {
      token_endpoint_auth_method: 'client_secret_post',
    },
    // Authelia's id_token only contains minimal claims (sub, aud, iss, etc.)
    // Full user info (email, name) must be fetched from the userinfo endpoint
    profile: async (_profile, tokens) => {
      const res = await fetch(`${issuer}/api/oidc/userinfo`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      const userinfo = await res.json()
      return {
        id: userinfo.sub,
        name: userinfo.name || userinfo.preferred_username || '',
        email: userinfo.email || '',
        image: userinfo.picture || '',
      }
    },
  }

  return config
}
