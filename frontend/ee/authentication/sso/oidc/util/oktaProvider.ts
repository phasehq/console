import type { OAuthConfig, OAuthUserConfig } from 'next-auth/providers'

export interface OktaProfile extends Record<string, any> {
  sub: string
  name: string
  nickname: string
  preferred_username: string
  given_name: string
  middle_name: string
  family_name: string
  email: string
  email_verified: boolean
  picture: string
  zoneinfo: string
  locale: string
  updated_at: string
}

type OktaProviderConfig = Omit<OAuthUserConfig<OktaProfile>, 'clientId'> & {
  clientId: string
  clientSecret: string
  issuer: string
}

export function OktaProvider(options: OktaProviderConfig): OAuthConfig<OktaProfile> {
  const issuer = options.issuer

  if (!issuer) {
    throw new Error('OKTA_OIDC_ISSUER must be set')
  }

  const config: OAuthConfig<OktaProfile> = {
    id: options.id || 'okta-oidc',
    name: options.name || 'Okta',
    type: 'oauth',
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    wellKnown: `${issuer}/.well-known/openid-configuration`,
    authorization: {
      params: { scope: 'openid email profile offline_access' },
    },
    idToken: true,
    checks: ['pkce', 'state', 'nonce'],
    profile(profile) {
      if (!profile.email) throw new Error('User does not have a valid email')

      return {
        id: profile.sub,
        name: profile.name ?? profile.preferred_username ?? '',
        email: profile.email,
        image: profile.picture ?? '',
      }
    },
  }

  return config
}
