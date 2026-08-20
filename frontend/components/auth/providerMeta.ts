import { ReactNode } from 'react'
import {
  GoogleLogo,
  GitHubLogo,
  GitLabLogo,
  JumpCloudLogo,
  EntraIDLogo,
  AuthentikLogo,
  OktaLogo,
} from '../common/logos'
import { SiAuthelia } from 'react-icons/si'
import { LogoProps } from '../common/logos/types'

export type ProviderIcon = ({ className }: LogoProps) => ReactNode

export type ProviderButton = {
  id: string
  name: string
  icon: ProviderIcon
}

// Instance-level providers, keyed by authorize-URL slug
export const providerButtons: ProviderButton[] = [
  { id: 'google', name: 'Google', icon: GoogleLogo },
  { id: 'github', name: 'GitHub', icon: GitHubLogo },
  { id: 'gitlab', name: 'GitLab', icon: GitLabLogo },
  { id: 'google-oidc', name: 'Google OIDC', icon: GoogleLogo },
  { id: 'jumpcloud-oidc', name: 'JumpCloud OIDC', icon: JumpCloudLogo },
  { id: 'entra-id-oidc', name: 'Entra ID OIDC', icon: EntraIDLogo },
  { id: 'github-enterprise', name: 'GitHub Enterprise', icon: GitHubLogo },
  { id: 'authentik', name: 'Authentik', icon: AuthentikLogo },
  { id: 'authelia', name: 'Authelia', icon: SiAuthelia },
  { id: 'okta-oidc', name: 'Okta', icon: OktaLogo },
]

// Map org-level provider_type to the icon used for instance-level buttons
export const orgProviderIcons: Record<string, ProviderIcon> = {
  entra_id: EntraIDLogo,
  okta: OktaLogo,
  google: GoogleLogo,
  jumpcloud: JumpCloudLogo,
}

// Linked identities are keyed by SocialAccount.provider (provider_id
// space) — not the same namespace as authorize-URL slugs
export const providerIdIcons: Record<string, ProviderIcon> = {
  google: GoogleLogo,
  'google-oidc': GoogleLogo,
  github: GitHubLogo,
  'github-enterprise': GitHubLogo,
  gitlab: GitLabLogo,
  microsoft: EntraIDLogo,
  'jumpcloud-oidc': JumpCloudLogo,
  'okta-oidc': OktaLogo,
  authentik: AuthentikLogo,
  authelia: SiAuthelia,
}

export const getProviderName = (id: string) =>
  providerButtons.find((p) => p.id === id)?.name || id

// Display names keyed by SocialAccount.provider (provider_id space) —
// mirrors the backend PROVIDER_DISPLAY_NAMES in api/views/identity.py.
export const providerIdNames: Record<string, string> = {
  google: 'Google',
  'google-oidc': 'Google',
  github: 'GitHub',
  'github-enterprise': 'GitHub Enterprise',
  gitlab: 'GitLab',
  microsoft: 'Microsoft Entra ID',
  'jumpcloud-oidc': 'JumpCloud',
  'okta-oidc': 'Okta',
  authentik: 'Authentik',
  authelia: 'Authelia',
}

export const getProviderIdName = (providerId: string) =>
  providerIdNames[providerId] || providerId
