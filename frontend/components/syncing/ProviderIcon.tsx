import { FaCube } from 'react-icons/fa'
import {
  SiCloudflarepages,
  SiCloudflareworkers,
  SiGithub,
  SiGitlab,
  SiNomad,
  SiRailway,
  SiVault,
  SiVercel,
  SiCloudflare,
  SiRender,
} from 'react-icons/si'
import { LiaAws } from 'react-icons/lia'

export const ProviderIcon = (props: { providerId: string }) => {
  const { providerId } = props
  const id = providerId.toLowerCase()

  if (id.includes('cloudflare_workers'))
    return <SiCloudflareworkers className="shrink-0 text-[#F38020]" />

  if (id.includes('cloudflare_pages'))
    return <SiCloudflarepages className="shrink-0 text-[#F38020]" />

  if (id === 'cloudflare') return <SiCloudflare className="shrink-0 text-[#F38020]" />

  if (id.includes('aws')) return <LiaAws className="shrink-0 text-[#FF9900]" />

  if (id.includes('github')) return <SiGithub className="shrink-0 text-black dark:text-white" />

  if (id.includes('gitlab')) return <SiGitlab className="shrink-0 text-[#FC6D26]" />

  if (id.includes('hashicorp_vault')) return <SiVault className="shrink-0 text-[#FFEC6E]" />

  if (id.includes('hashicorp_nomad')) return <SiNomad className="shrink-0 text-[#00CA8E]" />

  if (id.includes('railway'))
    return <SiRailway className="shrink-0 text-[#0B0D0E] dark:text-white" />

  if (id.includes('vercel')) return <SiVercel className="shrink-0 text-[#000000] dark:text-white" />

  if (id.includes('render')) return <SiRender className="shrink-0 text-[#000000] dark:text-white" />
  else return <FaCube />
}
