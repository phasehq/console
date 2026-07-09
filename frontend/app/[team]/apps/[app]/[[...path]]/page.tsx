import { Metadata } from 'next'
import { formatTitle } from '@/utils/meta'
import { AppSecrets } from '../_components/AppSecrets'
import { AppDescription } from '../_components/AppDescription'

export async function generateMetadata({
  params,
}: {
  params: { team: string; app: string; path?: string[] }
}): Promise<Metadata> {
  return {
    title: formatTitle(`App Secrets`),
    description: `Manage app secrets and environments`,
  }
}

export default function AppSecretsView({
  params,
}: {
  params: { team: string; app: string; path?: string[] }
}) {
  const { team, app, path } = params

  return (
    // Flex column: the chrome (readme, search, deploy, toolbar, table header)
    // stays in place and only the table rows scroll, inside AppSecrets. The
    // page-level scroll only engages if the pinned chrome itself can't fit.
    <div className="h-full w-full flex flex-col overflow-y-auto text-black dark:text-white relative space-y-4 px-3 sm:px-4 lg:px-6">
      {(!path || path.length === 0) && <AppDescription appId={app} />}
      <AppSecrets team={team} app={app} pathSegments={path ?? []} />
    </div>
  )
}
