import { Metadata } from 'next'
import { formatTitle } from '@/utils/meta'
import { AppSecrets } from './_components/AppSecrets'
import { AppEnvironments } from './_components/AppEnvironments'
import { AppDescription } from './_components/AppDescription'

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
    <div className="max-h-screen overflow-y-auto w-full text-black dark:text-white relative space-y-8 px-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch w-full">
        <AppDescription appId={app} />
        <div className="lg:col-span-2">
          <AppEnvironments appId={app} />
        </div>
      </div>
      <hr className="border-neutral-500/40" />
      <AppSecrets team={team} app={app} />
    </div>
  )
}
