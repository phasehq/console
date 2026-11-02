import { userHasPermission } from './permissions'

type OrganisationAccess = {
  memberId?: string | null
  role?: { permissions?: string | null } | null
}

export const userHasOrganisationAgentPermission = (
  organisation: OrganisationAccess | null | undefined,
  action: string
) => {
  const organisationPermissions = organisation?.role?.permissions
  return !!organisationPermissions && userHasPermission(organisationPermissions, 'Agents', action)
}

export const userCanCreateAgent = (organisation: OrganisationAccess | null | undefined) =>
  userHasOrganisationAgentPermission(organisation, 'create')
