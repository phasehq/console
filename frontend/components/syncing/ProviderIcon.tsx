import { FaCube } from 'react-icons/fa'
import {
  SiAmazonaws,
  SiCloudflare,
  SiGithub,
  SiGitlab,
  SiNomad,
  SiRailway,
  SiVault,
} from 'react-icons/si'

export const ProviderIcon = (props: { providerId: string }) => {
  const { providerId } = props

  if (providerId.toLowerCase().includes('cloudflare'))
    return <SiCloudflare className="shrink-0 text-[#F38020]" />

  if (providerId.toLowerCase().includes('aws'))
    return <SiAmazonaws className="shrink-0 text-[#FF9900]" />

  if (providerId.toLowerCase().includes('github'))
    return <SiGithub className="shrink-0 text-black dark:text-white" />

  if (providerId.toLowerCase().includes('gitlab'))
    return <SiGitlab className="shrink-0 text-[#FC6D26]" />

  if (providerId.toLowerCase().includes('hashicorp_vault'))
    return <SiVault className="shrink-0 text-[#FFEC6E]" />

  if (providerId.toLowerCase().includes('hashicorp_nomad'))
    return <SiNomad className="shrink-0 text-[#00CA8E]" />

  if (providerId.toLowerCase().includes('railway'))
    return <SiRailway className="shrink-0 text-[#0B0D0E] dark:text-white" />
  else return <FaCube />
}
