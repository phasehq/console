import type { OAuthConfig } from 'next-auth/providers'

export interface OIDCProviderConfig extends Omit<OAuthConfig<any>, 'clientId'> {
  clientId: string
  clientSecret: string
  issuer: string
  wellKnown?: string
}

export function OIDCProvider(config: OIDCProviderConfig): OAuthConfig<any> {
  return {
    ...config,
    type: 'oauth',
    wellKnown: config.wellKnown,
    authorization: { 
      params: { 
        response_type: 'code',
        scope: 'openid email profile',
        access_type: 'offline',
        //prompt: 'consent',
      } 
    },
    token: {
      params: {
        grant_type: 'authorization_code',
      }
    },
    userinfo: {
      request: false
    },
    profile(profile) {
      if (!profile.sub) {
        throw new Error('No sub claim in OIDC profile')
      }
      return {
        id: profile.sub,
        name: profile.name || '',
        email: profile.email || '',
        image: profile.picture || ''
      }
    },
    idToken: true,
    checks: ['pkce', 'state', 'nonce'],
    client: {
      token_endpoint_auth_method: 'client_secret_post'
    },
  }
}

