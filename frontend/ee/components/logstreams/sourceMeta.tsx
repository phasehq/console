import { FaCubes, FaSitemap, FaStream } from 'react-icons/fa'

/**
 * Icons for the log stream event sources, keyed by registry id (org =
 * sitemap, apps = cubes). Names and descriptions come from the backend source
 * registry (logStreamSources / sourceLags.name) — only the visual identity
 * lives client-side.
 */
export const SourceIcon = (props: { sourceId: string; className?: string }) => {
  const { sourceId, className } = props

  if (sourceId === 'org_audit') return <FaSitemap className={className} />
  if (sourceId === 'secrets') return <FaCubes className={className} />
  return <FaStream className={className} />
}
