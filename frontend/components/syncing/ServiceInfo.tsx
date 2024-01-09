import { EnvironmentSyncType } from '@/apollo/graphql'

export const ServiceInfo = (props: { sync: EnvironmentSyncType }) => {
  const { sync } = props

  if (sync.serviceInfo?.id?.includes('cloudflare')) {
    return (
      <div className="flex gap-2">
        {JSON.parse(sync.options)['project_name']}
        <span className="text-neutral-500 font-normal">
          ({JSON.parse(sync.options)['environment']})
        </span>
      </div>
    )
  } else if (sync.serviceInfo?.id?.includes('aws')) {
    const secretName = JSON.parse(sync.options)['secret_name']

    return <div className="flex gap-2">{secretName}</div>
  } else if (sync.serviceInfo?.id?.includes('github')) {
    const repoName = JSON.parse(sync.options)['repo_name']
    const owner = JSON.parse(sync.options)['owner']

    return (
      <div className="flex gap-2">
        {owner}/{repoName}
      </div>
    )
  } else return <>{sync.serviceInfo?.id}</>
}
