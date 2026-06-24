'use client'

import { RevokeUserToken } from '@/graphql/mutations/users/deleteUserToken.gql'
import { GetUserTokens } from '@/graphql/queries/users/getUserTokens.gql'
import { ServiceTokenType, UserTokenType } from '@/apollo/graphql'
import { useMutation, useQuery } from '@apollo/client'
import { useContext, useRef } from 'react'
import { Button } from '@/components/common/Button'
import { FaTrashAlt } from 'react-icons/fa'
import { relativeTimeFromDates } from '@/utils/time'

import clsx from 'clsx'
import { organisationContext } from '@/contexts/organisationContext'
import { CreateUserTokenDialog } from '@/components/apps/tokens/CreateUserTokenDialog'
import { FaUserShield } from 'react-icons/fa6'
import GenericDialog from '@/components/common/GenericDialog'

export default function UserTokens({ params }: { params: { team: string } }) {
  const [deleteUserToken] = useMutation(RevokeUserToken)

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const organisationId = organisation?.id

  const { data: userTokensData } = useQuery(GetUserTokens, {
    variables: {
      organisationId,
    },
    skip: !organisation,
    fetchPolicy: 'cache-and-network',
  })

  const handleDeleteUserToken = async (tokenId: string) => {
    await deleteUserToken({
      variables: { tokenId },
      refetchQueries: [
        {
          query: GetUserTokens,
          variables: {
            organisationId,
          },
        },
      ],
    })
  }

  const userTokens =
    [...(userTokensData?.userTokens || [])].sort((a: UserTokenType, b: UserTokenType) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }) || []

  const DeleteConfirmDialog = (props: {
    token: UserTokenType | ServiceTokenType
    onDelete: Function
  }) => {
    const { token, onDelete } = props

    const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

    return (
      <GenericDialog
        ref={dialogRef}
        title={`Delete ${token.name}`}
        buttonVariant="danger"
        buttonContent={
          <>
            <FaTrashAlt /> Delete
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-neutral-500 text-sm py-4">
            Are you sure you want to delete this token?
          </p>
          <div className="flex items-center justify-between gap-4">
            <Button
              variant="secondary"
              type="button"
              onClick={() => dialogRef.current?.closeModal()}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={() => onDelete(token.id)}>
              Delete
            </Button>
          </div>
        </div>
      </GenericDialog>
    )
  }

  const CreatedToken = (props: {
    token: ServiceTokenType | UserTokenType
    deleteHandler: Function
  }) => {
    const { token, deleteHandler } = props

    const isExpired = token.expiresAt === null ? false : new Date(token.expiresAt) < new Date()

    return (
      <div className="flex items-center w-full justify-between py-1.5 px-2 group bg-neutral-100 dark:bg-neutral-800 rounded-lg ring-1 ring-inset ring-neutral-500/20">
        <div className="grid grid-cols-3 gap-4 w-full">
          <div className="flex items-center gap-3">
            <FaUserShield className="text-neutral-500 text-sm" />
            <div className="space-y-0">
              <div className="text-sm font-medium">{token.name}</div>
              <div className="flex items-center gap-4 text-xs text-neutral-500">
                <div className={clsx(isExpired && 'text-red-500')}>
                  {isExpired ? 'Expired' : 'Expires'}{' '}
                  {token.expiresAt ? relativeTimeFromDates(new Date(token.expiresAt)) : 'never'}
                </div>
              </div>
            </div>
          </div>
          <div className="text-neutral-500 text-xs flex items-center">
            Created {relativeTimeFromDates(new Date(token.createdAt))}
          </div>
        </div>

        <div className="opacity-0 group-hover:opacity-100 transition-opacity ease">
          <DeleteConfirmDialog token={token} onDelete={deleteHandler} />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full overflow-y-auto relative text-black dark:text-white space-y-8 px-3 sm:px-4 lg:px-6">
      <section className="overflow-y-auto max-w-screen-xl">
        <div className="w-full space-y-4 text-black dark:text-white">
          <div>
            <h2 className="text-base font-medium">Personal Access Tokens</h2>
            <p className="text-neutral-500 text-sm">
              Tokens used to authenticate your user account with the CLI, SDKs or API from personal
              devices. Used for development and manual configuration.
            </p>
          </div>
          <div className="space-y-4 pb-4 divide-y-2 divide-neutral-500/40">
            <div className="space-y-2">
              <div className="flex justify-end py-2 border-b border-neutral-500/40">
                <CreateUserTokenDialog organisationId={organisationId!} />
              </div>
              {userTokens.length > 0 ? (
                <div className="space-y-2">
                  {userTokens.map((userToken: UserTokenType) => (
                    <CreatedToken
                      key={userToken.id}
                      token={userToken}
                      deleteHandler={handleDeleteUserToken}
                    />
                  ))}
                </div>
              ) : (
                <div className="p-20 flex flex-col items-center justify-center border border-neutral-500/20 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                  <div className="text-black dark:text-white font-medium text-sm">No tokens</div>
                  <div className="text-neutral-500 text-xs">
                    You haven&apos;t created any Personal Access Tokens yet. Create one to get
                    started.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
