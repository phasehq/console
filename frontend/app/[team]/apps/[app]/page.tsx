import { Metadata } from 'next'
import { formatTitle } from '@/utils/meta'
import { AppSecrets } from './_components/AppSecrets'
import { AppEnvironments } from './_components/AppEnvironments'

export async function generateMetadata({
  params,
}: {
  params: { team: string; app: string }
}): Promise<Metadata> {
  return {
    title: formatTitle(`App Secrets`),
    description: `Manage app secrets and environments`,
  }
}

export default function AppSecretsView({ params }: { params: { team: string; app: string } }) {
  const { team, app } = params

  return (
    <div className="max-h-screen overflow-y-auto w-full text-black dark:text-white relative">
      <AppEnvironments appId={app} />
      <hr className="border-neutral-500/40" />
      <AppSecrets team={team} app={app} />
    </div>
  )
}
