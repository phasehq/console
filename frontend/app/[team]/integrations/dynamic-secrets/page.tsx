'use client'

import { EmptyState } from '@/components/common/EmptyState'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { useContext } from 'react'
import { FaBan } from 'react-icons/fa6'
import { GetDynamicSecrets } from '@/graphql/queries/secrets/dynamic/getDynamicSecrets.gql'
import { useQuery } from '@apollo/client'
import { DynamicSecretType } from '@/apollo/graphql'
import { DynamicSecret } from './_components/DynamicSecret'

export default function DynamicSecrets({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  // permissions
  const userCanReadDynamicSecrets = organisation
    ? userHasPermission(organisation.role?.permissions, 'Secrets', 'read', true)
    : false

  const { data } = useQuery(GetDynamicSecrets, {
    variables: { orgId: organisation?.id },
    skip: !organisation || !userCanReadDynamicSecrets,
  })

  // Group secrets by appId, then environmentId
  const groupedSecrets: Record<
    string,
    {
      appName: string
      environments: Record<
        string,
        {
          envName: string
          secrets: DynamicSecretType[]
        }
      >
    }
  > = {}

  if (data?.dynamicSecrets) {
    data.dynamicSecrets.forEach((secret: DynamicSecretType) => {
      const appId = secret.environment.app.id
      const appName = secret.environment.app.name
      const envId = secret.environment.id
      const envName = secret.environment.name

      if (!groupedSecrets[appId]) {
        groupedSecrets[appId] = {
          appName,
          environments: {},
        }
      }
      if (!groupedSecrets[appId].environments[envId]) {
        groupedSecrets[appId].environments[envId] = {
          envName,
          secrets: [],
        }
      }
      groupedSecrets[appId].environments[envId].secrets.push(secret)
    })
  }

  return (
    <div className="w-full space-y-8 md:space-y-10 text-black dark:text-white">
      {userCanReadDynamicSecrets ? (
        <div className="space-y-4">
          <div className="border-b border-neutral-500/20 pb-2">
            <h2 className="text-black dark:text-white text-xl font-medium">Dynamic Secrets</h2>
            <p className="text-neutral-500">View and manage dynamic secrets</p>
          </div>

          {/* Grouped display */}
          <div className="space-y-8 divide-y divide-neutral-400/20">
            {Object.entries(groupedSecrets).map(([appId, appGroup]) => (
              <div key={appId} className="space-y-1 py-4">
                <div className="font-semibold text-lg">{appGroup.appName}</div>
                <div className="flex flex-row gap-8 flex-1">
                  {Object.entries(appGroup.environments)
                    .sort(
                      ([, aEnv], [, bEnv]) =>
                        (aEnv.secrets[0]?.environment.index ?? 0) -
                        (bEnv.secrets[0]?.environment.index ?? 0)
                    )
                    .map(([envId, envGroup]) => (
                      <div key={envId} className="flex flex-col gap-2 min-w-[160px]">
                        <div className="font-medium text-base text-neutral-700 dark:text-neutral-300 mb-2">
                          {envGroup.envName}
                        </div>
                        {envGroup.secrets.map((secret) => (
                          <DynamicSecret key={secret.id} secret={secret} />
                        ))}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view Dynamic Secrets in this organisation."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      )}
    </div>
  )
}
