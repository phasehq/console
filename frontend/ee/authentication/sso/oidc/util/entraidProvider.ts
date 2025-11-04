import type { OAuthConfig, OAuthUserConfig } from 'next-auth/providers'

export interface EntraIDProfile extends Record<string, any> {
  sub: string
  name: string
  email: string
  picture?: string
}

type EntraIDProviderConfig = Omit<OAuthUserConfig<EntraIDProfile>, 'clientId'> & {
  clientId: string
  clientSecret: string
  profilePhotoSize?: 48 | 64 | 96 | 120 | 240 | 360 | 432 | 504 | 648
  tenantId?: string
}

export function EntraIDProvider(options: EntraIDProviderConfig): OAuthConfig<EntraIDProfile> {
  const tenant = options.tenantId || process.env.ENTRA_ID_OIDC_TENANT_ID || 'common'
  //const profilePhotoSize = options.profilePhotoSize || 48

  const config: OAuthConfig<EntraIDProfile> = {
    id: options.id || 'entra-id-oidc',
    name: options.name || 'Entra ID',
    type: 'oauth',
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    wellKnown: `https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration?appid=${options.clientId}`,
    authorization: {
      params: { scope: 'openid email profile User.Read' },
    },
    idToken: true,
    checks: ['pkce', 'state', 'nonce'],
    profile: async (profile, tokens) => {
      if (!profile.email) throw new Error('User does not have a valid email')

      return {
        id: profile.sub,
        name: profile.name || '',
        email: profile.email,
        image: '',
      }
    },
  }

  return config
}
