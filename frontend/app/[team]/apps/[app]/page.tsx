'use client'

import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { GetAppLogCount } from '@/graphql/queries/getAppLogCount.gql'
import { useLazyQuery, useQuery } from '@apollo/client'
import { AppType } from '@/apollo/graphql'
import { useEffect } from 'react'
import { AppActivityChart } from '@/components/apps/AppActivityChart'
import { FaArrowRight } from 'react-icons/fa'
import { Button } from '@/components/common/Button'
import Spinner from '@/components/common/Spinner'
import { humanReadableNumber } from '@/utils/dataUnits'
import { relativeTimeFromDates } from '@/utils/time'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Count } from 'reaviz'

export default function App({ params }: { params: { team: string; app: string } }) {
  const { data: orgsData } = useQuery(GetOrganisations)
  const [getAppLogCount, { data: countData, loading: countLoading }] = useLazyQuery(GetAppLogCount)
  const [getApp, { data, loading: appDataLoading }] = useLazyQuery(GetAppDetail)

  const app = data?.apps[0] as AppType

  useEffect(() => {
    if (orgsData) {
      const organisationId = orgsData.organisations[0].id
      getApp({
        variables: {
          organisationId,
          appId: params.app,
        },
      })
      getAppLogCount({
        variables: {
          appId: params.app,
        },
        fetchPolicy: 'cache-and-network',
      })
    }
  }, [getApp, getAppLogCount, orgsData, params.app])

  const totalLogCount = countData?.logsCount ?? 0

  const showTotalLogCountSpinner = countLoading && totalLogCount === 0

  return (
    <div className="w-full text-black dark:text-white grid grid-cols-1 md:grid-cols-3 gap-8 py-8 max-h-screen overflow-y-auto">
      {!app && (
        <div className="h-[508px] bg-neutral-100 dark:bg-neutral-800 ring-1 ring-inset ring-neutral-500/20 dark:ring-0 shadow-lg rounded-lg animate-pulse md:col-span-3"></div>
      )}
      {app && (
        <div className="md:col-span-3 bg-neutral-100 dark:bg-neutral-800 p-8 rounded-lg ring-1 ring-inset ring-neutral-500/20 dark:ring-0 shadow-lg">
          <div className="w-full ">
            <AppActivityChart app={app} />
          </div>
        </div>
      )}

      <div className="bg-neutral-100 dark:bg-neutral-800 ring-1 ring-inset ring-neutral-500/20 dark:ring-0 shadow-lg p-8 rounded-lg flex flex-col justify-between gap-20">
        <div className="space-y-2">
          {showTotalLogCountSpinner && <Spinner size="md" />}
          {!showTotalLogCountSpinner && (
            <span className="text-4xl font-extralight">
              <Count from={0} to={totalLogCount} />
            </span>
          )}
          <h2 className="text-2xl font-bold">Total Decrypts</h2>
        </div>
        <div className="flex justify-end">
          <Link href={`${usePathname()}/logs`}>
            <Button variant="primary">
              View logs <FaArrowRight />
            </Button>
          </Link>
        </div>
      </div>

      <div className="bg-neutral-100 dark:bg-neutral-800 ring-1 ring-inset ring-neutral-500/20 dark:ring-0 shadow-lg p-8 rounded-lg flex flex-col justify-between gap-20">
        <div className="flex w-full justify-between">
          <div className="space-y-2">
            <span className="text-4xl font-extralight">1</span>
            <h2 className="text-2xl font-bold">Active key</h2>
          </div>
          <span
            className="h-2 w-2 bg-emerald-500 animate-pulse rounded-full"
            title="App is live"
          ></span>
        </div>
        <div className="flex justify-end">
          <Link href={`${usePathname()}/keys`}>
            <Button variant="primary">
              Manage keys <FaArrowRight />
            </Button>
          </Link>
        </div>
      </div>

      <div className="bg-neutral-100 dark:bg-neutral-800 ring-1 ring-inset ring-neutral-500/20 dark:ring-0 shadow-lg p-8 rounded-lg flex flex-col justify-between gap-20">
        <div className="space-y-2">
          {appDataLoading && <Spinner size="md" />}
          {app && (
            <span className="text-4xl font-extralight">
              {relativeTimeFromDates(new Date(app.createdAt))}
            </span>
          )}
          <h2 className="text-2xl font-bold">App created</h2>
        </div>
        <div className="flex justify-end">
          <Link href={`${usePathname()}/settings`}>
            <Button variant="primary">
              Manage app <FaArrowRight />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
