import { FaCube } from 'react-icons/fa'
import { SiAmazonaws, SiCloudflare } from 'react-icons/si'

export const ProviderIcon = (props: { providerId: string }) => {
  const { providerId } = props

  if (providerId.toLowerCase().includes('cloudflare'))
    return <SiCloudflare className="shrink-0 text-[#F38020]" />

  if (providerId.includes('aws')) return <SiAmazonaws className="shrink-0 text-[#FF9900]" />
  else return <FaCube />
}
