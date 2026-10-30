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
    // Flex column: only the grid scrolls; the chrome above it stays pinned
    <div className="h-full w-full flex flex-col overflow-y-auto text-black dark:text-white relative space-y-4 py-4 px-3 sm:px-4 lg:px-6">
      {/* Keyed by folder: each path starts from its own snapshot, never a rebase of another's edits */}
      <AppSecrets key={(path ?? []).join('/')} team={team} app={app} pathSegments={path ?? []} />
    </div>
  )
}
