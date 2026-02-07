'use client'

import { useContext } from 'react'
import { FaBan } from 'react-icons/fa'
import { SecretTokens } from '@/components/apps/tokens/SecretTokens'
import { organisationContext } from '@/contexts/organisationContext'
import { KeyringContext } from '@/contexts/keyringContext'
import { userHasPermission } from '@/utils/access/permissions'
import { EmptyState } from '@/components/common/EmptyState'

export default function Tokens({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadTokens = userHasPermission(
    organisation?.role?.permissions,
    'Tokens',
    'read',
    true
  )

  const { keyring } = useContext(KeyringContext)

  return (
    <div className="w-full overflow-y-auto relative text-black dark:text-white space-y-16">
      {userCanReadTokens ? (
        <section className="max-w-screen-xl">
          {keyring !== null && (
            <div className="mt-6 px-4">
              <SecretTokens organisationId={organisation!.id} appId={params.app} />
            </div>
          )}
        </section>
      ) : (
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view Tokens in this app."
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
