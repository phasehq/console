'use client'

import { useQuery } from '@apollo/client'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { OrganisationMemberType, OrganisationType } from '@/apollo/graphql'
import Spinner from '../common/Spinner'
import { FaUsers } from 'react-icons/fa'
import { Card } from '../common/Card'
import { userHasPermission } from '@/utils/access/permissions'

export default function MembersHomeCard(props: { organisation: OrganisationType }) {
  const { organisation } = props

  const userCanReadMembers = userHasPermission(organisation?.role?.permissions, 'Members', 'read')

  const { data, loading } = useQuery(GetOrganisationMembers, {
    variables: {
      organisationId: organisation.id,
      role: null,
    },
    skip: !userCanReadMembers,
  })

  const members = data?.organisationMembers as OrganisationMemberType[]

  return (
    <Card>
      <div className="p-8 flex flex-col gap-y-20 justify-between">
        <FaUsers
          size={'32'}
          className="text-neutral-800 dark:text-neutral-300 group-hover:text-emerald-500 transition-colors duration-300"
        />
        <div className="flex w-full justify-between text-4xl ">
          <h2 className="font-semibold group-hover:text-emerald-500 transition-colors duration-300">
            Members
          </h2>
          {loading && <Spinner size="md" />}
          {!loading && <span className="font-extralight">{members?.length}</span>}
        </div>
      </div>
    </Card>
  )
}
