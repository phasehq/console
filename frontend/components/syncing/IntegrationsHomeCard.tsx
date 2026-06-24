'use client'

import { useQuery } from '@apollo/client'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import { OrganisationType, ProviderCredentialsType } from '@/apollo/graphql'
import Spinner from '../common/Spinner'
import { FaProjectDiagram } from 'react-icons/fa'
import { Card } from '../common/Card'
import { userHasPermission } from '@/utils/access/permissions'

export default function IntegrationsHomeCard(props: { organisation: OrganisationType }) {
  const { organisation } = props

  const userCanReadIntegrations = userHasPermission(
    organisation?.role?.permissions,
    'IntegrationCredentials',
    'read'
  )

  const { data, loading } = useQuery(GetSavedCredentials, {
    variables: {
      orgId: organisation.id,
    },
    skip: !userCanReadIntegrations,
  })

  const integrations = data?.savedCredentials as ProviderCredentialsType[]

  return (
    <Card>
      <div className="p-3 sm:p-4 lg:p-6 flex flex-col gap-y-6 sm:gap-y-8 lg:gap-y-10 justify-between">
        <FaProjectDiagram
          size={'24'}
          className="text-neutral-800 dark:text-neutral-300 group-hover:text-emerald-500 transition-colors duration-300"
        />
        <div className="flex w-full justify-between text-lg sm:text-xl lg:text-2xl">
          <h2 className="font-semibold group-hover:text-emerald-500 transition-colors duration-300">
            Integrations
          </h2>
          {loading && <Spinner size="md" />}
          {!loading && <span className="font-extralight">{integrations?.length}</span>}
        </div>
      </div>
    </Card>
  )
}
