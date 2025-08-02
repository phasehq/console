'use client'

import { ToggleFavoriteEnvironmentMutation, ToggleFavoriteEnvironmentMutationVariables, EnvironmentType } from '@/apollo/graphql'
import { GetFavoritedEnvironments } from '@/graphql/queries/GetFavoritedEnvironments.gql'
import { ToggleFavoriteEnvironment } from '@/graphql/mutations/ToggleFavoriteEnvironment.gql'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { organisationContext } from '@/contexts/organisationContext'
import { useMutation } from '@apollo/client'
import Link from 'next/link'
import { useContext } from 'react'
import { FaArrowRight, FaFolder, FaKey, FaStar, FaRegStar } from 'react-icons/fa'
import { BsListColumnsReverse } from 'react-icons/bs'
import { userHasPermission } from '@/utils/access/permissions'
import Spinner from '@/components/common/Spinner'

export interface FavoritedEnvironment {
  id: string;
  name: string;
  envType: string;
  isFavorited: boolean | null | undefined;
  secretCount: number | null | undefined;
  folderCount: number | null | undefined;
  app: {
    __typename?: 'AppType';
    id: string;
    name: string;
  };
  __typename?: 'EnvironmentType';
}

interface FavoritedEnvironmentCardProps {
  environment: FavoritedEnvironment;
  teamSlug: string 
}

export const FavoritedEnvironmentCard = ({ environment, teamSlug }: FavoritedEnvironmentCardProps) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanUpdateEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'update',
    true
  )

  const [toggleFavorite, { loading: favoriteLoading }] = useMutation<
    ToggleFavoriteEnvironmentMutation,
    ToggleFavoriteEnvironmentMutationVariables
  >(ToggleFavoriteEnvironment)

  const handleToggleFavorite = async () => {
    if (!organisation) return

    await toggleFavorite({
      variables: { environmentId: environment.id },
      refetchQueries: [
        { query: GetFavoritedEnvironments, variables: { orgId: organisation.id } },
      ],
      optimisticResponse: {
        toggleFavoriteEnvironment: {
          __typename: 'ToggleFavoriteEnvironment', 
          success: true,
          environment: {
            __typename: 'EnvironmentType',
            id: environment.id,
            isFavorited: !environment.isFavorited,
          },
        },
      },
    })
  }

  return (
    <Card key={environment.id}>
      <div className="group">
        <div className="flex gap-2 xl:gap-4">
          <div className="pt-1.5">
            <BsListColumnsReverse className="text-black dark:text-white text-lg xl:text-xl" />
          </div>
          <div className="space-y-6 w-full min-w-0">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/${teamSlug}/apps/${environment.app.id}/environments/${environment.id}`} className="group min-w-0">
                <div className="font-semibold text-base xl:text-lg truncate">{environment.name}</div>
                <div className="text-neutral-500 text-xs xl:text-sm">
                  From: {environment.app.name}
                </div>
              </Link>
              {userCanUpdateEnvironments && (
                  <Button
                    variant="ghost"
                    onClick={handleToggleFavorite}
                    disabled={favoriteLoading}
                    title={environment.isFavorited ? 'Unfavorite' : 'Favorite'}
                    className="text-neutral-500 hover:text-amber-500 p-1.5 rounded-full"
                  >
                    {favoriteLoading ? (
                      <Spinner size="xs" color="amber" />
                    ) : environment.isFavorited ? (
                      <FaStar className="text-amber-500" />
                    ) : (
                      <FaRegStar />
                    )}
                  </Button>
              )}
            </div>

            <div className="text-neutral-500 text-xs xl:text-sm">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5" title={`${environment.secretCount || 0} secrets`}>
                        <FaKey className="text-sm" />
                        <span>{environment.secretCount || 0}</span>
                    </div>
                    <div className="flex items-center gap-1.5" title={`${environment.folderCount || 0} folders`}>
                        <FaFolder className="text-sm" />
                        <span>{environment.folderCount || 0}</span>
                    </div>
                </div>
            </div>

            <div className="flex items-center">
              <Link href={`/${teamSlug}/apps/${environment.app.id}/environments/${environment.id}`}>
                <Button variant="primary">
                  <div className="flex items-center gap-1 xl:gap-2 text-2xs xl:text-xs">
                    Explore <FaArrowRight />
                  </div>
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
