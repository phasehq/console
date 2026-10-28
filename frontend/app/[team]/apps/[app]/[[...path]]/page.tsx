import { Metadata } from 'next'
import { formatTitle } from '@/utils/meta'
import { AppSecrets } from '../_components/AppSecrets'

export const metadata: Metadata = {
  title: formatTitle(`App Secrets`),
  description: `Manage app secrets and environments`,
}

export default async function AppSecretsView(props: {
  params: Promise<{ team: string; app: string; path?: string[] }>
}) {
  const { team, app, path } = await props.params

  return (
    // Flex column: only the table rows scroll; the chrome stays pinned.
    // pt-4 matches the single-env editor's py-4 so the header labels align across tabs.
    <div className="h-full w-full flex flex-col overflow-y-auto text-black dark:text-white relative space-y-4 pt-4 px-3 sm:px-4 lg:px-6">
      <AppSecrets team={team} app={app} pathSegments={path ?? []} />
    </div>
  )
}
