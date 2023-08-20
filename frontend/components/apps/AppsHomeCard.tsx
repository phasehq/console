'use client'

import { useQuery } from '@apollo/client'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { AppType } from '@/apollo/graphql'
import Spinner from '../common/Spinner'
import { FaCubes } from 'react-icons/fa'
import { Card } from '../common/Card'

export default function AppsHomeCard(props: { organisationId: string }) {
  const { organisationId } = props
  const { data, loading } = useQuery(GetApps, {
    variables: {
      organisationId,
      appId: '',
    },
  })

  const apps = data?.apps as AppType[]

  return (
    <Card>
      <div className="p-8 flex flex-col gap-y-20 justify-between">
        <FaCubes
          size={'32'}
          className="text-neutral-800 dark:text-neutral-300 group-hover:text-emerald-500 transition-colors duration-300"
        />
        <div className="flex w-full justify-between text-4xl ">
          <h2 className="font-semibold group-hover:text-emerald-500 transition-colors duration-300">
            Apps
          </h2>
          {loading && <Spinner size="md" />}
          {!loading && <span className="font-extralight">{apps?.length}</span>}
        </div>
      </div>
    </Card>
  )
}
