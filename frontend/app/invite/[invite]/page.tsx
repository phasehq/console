'use client'

import { cryptoUtils } from '@/utils/auth'
import VerifyInvite from '@/graphql/queries/organisation/validateOrganisationInvite.gql'
import { useQuery } from '@apollo/client'
import { HeroPattern } from '@/components/common/HeroPattern'
import { Button } from '@/components/common/Button'
import { FaArrowRight } from 'react-icons/fa'
import Loading from '@/app/loading'

export default function Invite({ params }: { params: { invite: string } }) {
  const { data, loading } = useQuery(VerifyInvite, {
    variables: { inviteId: cryptoUtils.decodeInvite(params.invite) },
  })

  const invite = data?.validateInvite

  return (
    <>
      <div>
        <HeroPattern />

        <div className="flex w-full h-screen">
          {loading ? (
            <Loading />
          ) : invite ? (
            <div className="mx-auto my-auto max-w-2xl space-y-8 p-16 bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white rounded-md shadow-2xl text-center">
              <div className="space-y-2">
                <h1 className="font-bold text-3xl">Welcome to Phase</h1>
                <p className="text-lg text-neutral-500">
                  You have been invited by {invite.invitedBy.email} to join the{' '}
                  {invite.organisation.name} organisation.
                </p>
              </div>
              <Button variant="primary">
                Get started <FaArrowRight />
              </Button>
            </div>
          ) : (
            <div className="mx-auto my-auto max-w-xl space-y-8 p-16 bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white rounded-md shadow-2xl text-center">
              <div className="space-y-2">
                <h1 className="font-bold text-3xl">Something went wrong</h1>
                <p className="text-lg text-neutral-500">
                  This invite cannot be used by you. Please check that you are logged in to the
                  correct account, or contact the organisation owner to create a new invite.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
