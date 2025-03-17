// frontend/components/syncing/ProviderIcon.tsx

import { FaCube } from 'react-icons/fa'
import {
  SiAmazonaws,
  SiCloudflarepages,
  SiCloudflareworkers,
  SiGithub,
  SiGitlab,
  SiNomad,
  SiRailway,
  SiVault,
  SiVercel,
  SiCloudflare,
} from 'react-icons/si'

interface IconMapping {
  icon: React.ElementType
  color: string
}

const providerIconMap: Record<string, IconMapping> = {
  cloudflare_workers: { icon: SiCloudflareworkers, color: '#F38020' },
  cloudflare_pages: { icon: SiCloudflarepages, color: '#F38020' },
  cloudflare: { icon: SiCloudflare, color: '#F38020' },
  aws: { icon: SiAmazonaws, color: '#FF9900' },
  github: { icon: SiGithub, color: 'black dark:text-white' },
  gitlab: { icon: SiGitlab, color: '#FC6D26' },
  hashicorp_vault: { icon: SiVault, color: '#FFEC6E' },
  hashicorp_nomad: { icon: SiNomad, color: '#00CA8E' },
  railway: { icon: SiRailway, color: '#0B0D0E dark:text-white' },
  vercel: { icon: SiVercel, color: '#000000 dark:text-white' },
}

export const ProviderIcon = (props: { providerId: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) => {
  const { providerId } = props
  const id = providerId.toLowerCase()

  const sizes = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
    xl: 'h-20 w-20',
  }

  const sizeStyle = sizes[props.size || 'sm']

  const iconData = Object.keys(providerIconMap).find((key) => id.includes(key))
    ? providerIconMap[id]
    : { icon: FaCube, color: '' }

  return <iconData.icon className={`shrink-0 ${sizeStyle} ${iconData.color}`} />
}
