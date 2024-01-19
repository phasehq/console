'use client'

import { useQuery } from '@apollo/client'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { OrganisationMemberType } from '@/apollo/graphql'
import Spinner from '../common/Spinner'
import { FaCubes, FaUsers } from 'react-icons/fa'
import { Card } from '../common/Card'

export default function MembersHomeCard(props: { organisationId: string }) {
  const { organisationId } = props
  const { data, loading } = useQuery(GetOrganisationMembers, {
    variables: {
      organisationId,
      role: null,
    },
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
