import type { OAuthConfig, OAuthUserConfig } from 'next-auth/providers'

export interface EntraIDProfile extends Record<string, any> {
  sub: string
  name: string
  email: string
  picture?: string
}

type EntraIDProviderConfig = Omit<OAuthUserConfig<EntraIDProfile>, 'clientId'> & {
  clientId: string;
  clientSecret: string;
  profilePhotoSize?: 48 | 64 | 96 | 120 | 240 | 360 | 432 | 504 | 648;
  tenantId?: string;
};

export function EntraIDProvider(options: EntraIDProviderConfig): OAuthConfig<EntraIDProfile> {
  const tenant = options.tenantId || process.env.ENTRA_ID_OIDC_TENANT_ID || 'common'
  const profilePhotoSize = options.profilePhotoSize || 48

  const config: OAuthConfig<EntraIDProfile> = {
    id: options.id || 'entra-id-oidc',
    name: options.name || 'Entra ID',
    type: 'oauth',
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    wellKnown: `https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration?appid=${options.clientId}`,
    authorization: {
      params: { scope: 'openid email profile User.Read' }
    },
    idToken: true,
    checks: ['pkce', 'state', 'nonce'],
    profile: async (profile, tokens) => {
      // Get the profile photo from the Microsoft Graph API
      let image
      try {
        const response = await fetch(
          `https://graph.microsoft.com/v1.0/me/photos/${profilePhotoSize}x${profilePhotoSize}/$value`,
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        )

        // Convert ArrayBuffer to base64 if response is OK
        if (response.ok) {
          const pictureBuffer = await response.arrayBuffer()
          const pictureBase64 = Buffer.from(pictureBuffer).toString('base64')
          image = `data:image/jpeg;base64,${pictureBase64}`
        }
      } catch (error) {
        console.error('Error fetching Entra ID profile photo:', error)
      }

      return {
        id: profile.sub,
        name: profile.name || '',
        email: profile.email || '',
        image: image || profile.picture || ''
      }
    }
  }

  return config
}
