import { useQuery } from '@apollo/client'
import { FaBox, FaBoxes, FaCube, FaUser, FaUsers } from 'react-icons/fa'
import { Card } from '../common/Card'
import GetAppMembers from '@/graphql/queries/apps/getAppMembers.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { AppType } from '@/apollo/graphql'
import { ProviderIcon } from '../syncing/ProviderIcon'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import React from 'react'

interface AppCardProps {
  app: AppType;
}

export const AppCard: React.FC<AppCardProps> = ({ app }) => {
  const { name, id: appId } = app;
  //cleaned up the code look
  const { data: appMembersData } = useQuery(GetAppMembers, { variables: { appId } });
  const { data: appEnvsData } = useQuery(GetAppEnvironments, { variables: { appId } });
  const { data: syncData } = useQuery(GetAppSyncStatus, { variables: { appId }, pollInterval: 10000 });


  //storing number of syncs
  const providerCounts = {
    cloudflare: 0,
    aws: 0,
    github: 0,
    gitlab: 0,
    hashicorp_vault: 0,
    hashicorp_nomad: 0,
    others: 0,
  };

  //Counting number of syncs for each integration
  if (syncData) {
    syncData.syncs.forEach((item:any) => {
      const providerName = item.authentication.name.toLowerCase();
      if (providerName.includes('cloudflare')) providerCounts.cloudflare += 1;
      else if (providerName.includes('aws')) providerCounts.aws += 1;
      else if (providerName.includes('github')) providerCounts.github += 1;
      else if (providerName.includes('gitlab')) providerCounts.gitlab += 1;
      else if (providerName.includes('hashicorp_vault')) providerCounts.hashicorp_vault += 1;
      else if (providerName.includes('hashicorp_nomad')) providerCounts.hashicorp_nomad += 1;
      else providerCounts.others += 1;
      
    });
  }

  //Counting number of values with are greater than 0
  const itemCount = Object.values(providerCounts).filter(value => value > 0).length;
  let noOfIcons = 1

  return (
    <Card>
      <div className="rounded-xl p-8 flex flex-col w-full gap-8 justify-between">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <div className="text-2xl font-bold flex items-center gap-2">
              <FaCube size="28" className="text-neutral-800 dark:text-neutral-300 group-hover:text-emerald-500 transition-colors duration-300" />
              {name}
            </div>
            <div className='text-md flex-row font-bold flex items-center'>
              {/* Added logic to print icons */}
            {syncData?.sseEnabled &&
              Object.entries(providerCounts).map(([provider, count]) => {
                  if(count > 0 && noOfIcons <= 3){
                    noOfIcons++
                  return (
                    <div key={provider} className="text-md flex-row font-bold flex items-center">
                      <ProviderIcon providerId={provider} />
                      <div className='mr-2'>({count})</div>
                    </div>
                  );
                }
                
                return null;
              })}
              {syncData?.sseEnabled && itemCount > 3 &&
                <div className="text-md flex-row font-bold flex items-center">
                  +n
                </div>
              }
              </div>
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
