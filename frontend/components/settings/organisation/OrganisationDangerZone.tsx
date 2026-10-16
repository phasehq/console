'use client'

import { useContext } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { TransferOwnershipSection } from './TransferOwnershipSection'
import { DeleteOrganisationSection } from './DeleteOrganisationSection'

export const OrganisationDangerZone = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const isOwner = organisation?.role?.name?.toLowerCase() === 'owner'

  if (!isOwner) return null

  return (
    <div className="space-y-6 border-t border-neutral-500/40 pt-6">
      <div className="border-b border-neutral-500/20 pb-2">
        <div className="text-lg font-medium py-2 text-red-500">Danger Zone</div>
        <div className="text-neutral-500">
          Proceed with caution. These actions may have unintended consequences.
        </div>
      </div>

      <TransferOwnershipSection />
      <DeleteOrganisationSection />
    </div>
  )
}
