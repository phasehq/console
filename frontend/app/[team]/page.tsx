'use client'

import { useContext } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { OrgDashboard } from '@/components/dashboard/OrgDashboard'

export default function OrganisationHome() {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  if (!organisation) return null

  return <OrgDashboard organisation={organisation} />
}
