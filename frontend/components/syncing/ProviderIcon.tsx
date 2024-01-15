import { FaCube } from 'react-icons/fa'
import { SiAmazonaws, SiCloudflare, SiGithub, SiVault } from 'react-icons/si'

export const ProviderIcon = (props: { providerId: string }) => {
  const { providerId } = props

  if (providerId.toLowerCase().includes('cloudflare'))
    return <SiCloudflare className="shrink-0 text-[#F38020]" />

  if (providerId.toLowerCase().includes('aws'))
    return <SiAmazonaws className="shrink-0 text-[#FF9900]" />

  if (providerId.toLowerCase().includes('github'))
    return <SiGithub className="shrink-0 text-black dark:text-white" />

  if (providerId.toLowerCase().includes('hashicorp_vault'))
    return <SiVault className="shrink-0 text-[#FFEC6E]" />
  else return <FaCube />
}
