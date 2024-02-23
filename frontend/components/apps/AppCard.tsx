import { useQuery } from '@apollo/client'
import { FaBox, FaBoxes, FaCube, FaUser, FaUsers } from 'react-icons/fa'
import { Card } from '../common/Card'
import GetAppMembers from '@/graphql/queries/apps/getAppMembers.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { AppType } from '@/apollo/graphql'

interface AppCardProps {
  app: AppType
}

export const AppCard = (props: AppCardProps) => {
  const { name, id: appId } = props.app
  const { data: appMembersData } = useQuery(GetAppMembers, { variables: { appId } })
  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })

  return (
    <Card>
      <div className="rounded-xl p-8 flex flex-col w-full gap-8 justify-between">
        <div className="space-y-2">
          <div className="text-2xl font-bold flex items-center gap-2">
            <FaCube
              size="28"
              className="text-neutral-800 dark:text-neutral-300 group-hover:text-emerald-500 transition-colors duration-300"
            />
            {name}
          </div>
          <div className="text-xs font-mono text-neutral-500 w-full break-all">{appId}</div>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-2xl">
              {appMembersData?.appUsers.length > 1 ? <FaUsers /> : <FaUser />}
              <span className="font-light">{appMembersData?.appUsers.length}</span>
            </div>
            <span className="text-neutral-500 font-medium text-xs uppercase tracking-widest">
              {appMembersData?.appUsers.length > 1 ? 'Members' : 'Member'}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-2xl">
              {appEnvsData?.appEnvironments.length > 1 ? <FaBoxes /> : <FaBox />}
              <span className="font-light">{appEnvsData?.appEnvironments.length}</span>
            </div>
            <span className="text-neutral-500 font-medium text-xs uppercase tracking-widest">
              {appEnvsData?.appEnvironments.length > 1 ? 'Environments' : 'Environment'}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}
