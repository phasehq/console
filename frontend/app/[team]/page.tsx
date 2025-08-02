'use client'

import AppsHomeCard from '@/components/apps/AppsHomeCard'
import Link from 'next/link'
import { useContext } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import MembersHomeCard from '@/components/users/MembersHomeCard'
import IntegrationsHomeCard from '@/components/syncing/IntegrationsHomeCard'
import { GetStarted } from '@/components/dashboard/GetStarted'
import { useQuery } from '@apollo/client'
import { GetFavoritedEnvironments } from '@/graphql/queries/GetFavoritedEnvironments.gql'
import { FavoritedEnvironmentCard, FavoritedEnvironment } from '@/components/dashboard/FavoritedEnvironmentCard' 
import AppCardSkeleton from '@/components/apps/AppCardSkeleton'
import { EmptyState } from '@/components/common/EmptyState' 
import { FaStar } from 'react-icons/fa' 

export default function AppsHome({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { 
    data: favoritesData,
    loading: favoritesLoading,
    error: favoritesError 
  } = useQuery(GetFavoritedEnvironments, {
    variables: { orgId: organisation?.id! },
    skip: !organisation?.id,
  })

  const favoritedEnvironments: FavoritedEnvironment[] | undefined = favoritesData?.favoritedEnvironments

  return (
    <>
      <div className="text-black dark:text-white">
        <div className="flex h-full w-full">
          <div className="w-full space-y-12 p-8">
            <h1 className="text-3xl font-bold capitalize text-wrap">{organisation?.name} Home</h1>
            {organisation && (
              <section className="space-y-4">
                <h2 className="text-2xl font-semibold">Your Favorite Environments</h2>
                {favoritesLoading && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 py-4">
                    {[...Array(3)].map((_, i) => <AppCardSkeleton key={i} variant="normal" />)}
                  </div>
                )}
                {favoritesError && (
                  <p className="text-red-500">Error loading your favorite environments. Please try again later.</p>
                )}
                {!favoritesLoading && !favoritesError && favoritedEnvironments && favoritedEnvironments.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4 py-4">
                    {favoritedEnvironments.map((env: FavoritedEnvironment) => (
                      <FavoritedEnvironmentCard 
                        key={env.id} 
                        environment={env}
                        teamSlug={params.team} 
                      />
                    ))}
                  </div>
                )}
                {!favoritesLoading && !favoritesError && (!favoritedEnvironments || favoritedEnvironments.length === 0) && (
                  <EmptyState
                    title="No Favorites Yet"
                    subtitle="Star your most used environments to see them here for quick access."
                    graphic={<FaStar className="text-5xl text-neutral-400 dark:text-neutral-500" />}
                  >
                    <></>
                  </EmptyState>
                )}
              </section>
            )}

            {organisation && (
              <div className="w-full">
                <GetStarted organisation={organisation} />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-8">
              {organisation && (
                <Link href={`/${params.team}/apps`}>
                  <AppsHomeCard organisation={organisation} />
                </Link>
              )}
              {organisation && (
                <Link href={`/${params.team}/access/members`}>
                  <MembersHomeCard organisation={organisation} />
                </Link>
              )}
              {organisation && (
                <Link href={`/${params.team}/integrations/syncs`}>
                  <IntegrationsHomeCard organisation={organisation} />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
