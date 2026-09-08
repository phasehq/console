import { userHasGlobalAccess, userHasPermission } from './permissions'

type AgentTeam = {
  owner?: { id: string } | null
  memberRole?: { permissions?: string | null } | null
  members?: Array<{ orgMember?: { id: string } | null } | null> | null
}

type AgentTarget = {
  team?: AgentTeam | null
}

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

export const userCanCreateAgent = (
  organisation: OrganisationAccess | null | undefined,
  eligibleTeamCount: number
) => userHasOrganisationAgentPermission(organisation, 'create') || eligibleTeamCount > 0

/** Mirror backend Team-effective Agent access for per-Agent UI actions. */
export const userHasTeamEffectiveAgentPermissionForTeam = (
  organisation: OrganisationAccess | null | undefined,
  team: AgentTeam | null | undefined,
  action: string
) => {
  const organisationPermissions = organisation?.role?.permissions
  if (!organisationPermissions) return false

  // Organisation-owned Agents use the member's organisation role directly.
  // A Team role only enters the calculation when the Agent is Team-owned.
  if (!team) return userHasOrganisationAgentPermission(organisation, action)

  if (!organisation?.memberId) return false

  if (userHasGlobalAccess(organisationPermissions)) {
    return userHasPermission(organisationPermissions, 'Agents', action)
  }

  const isTeamMember =
    team.owner?.id === organisation.memberId ||
    !!team.members?.some((membership) => membership?.orgMember?.id === organisation.memberId)
  if (!isTeamMember) return false

  const effectivePermissions = team.memberRole?.permissions || organisationPermissions
  return userHasPermission(effectivePermissions, 'Agents', action)
}

/** Mirror backend Team-effective Agent access for per-Agent UI actions. */
export const userHasTeamEffectiveAgentPermission = (
  organisation: OrganisationAccess | null | undefined,
  agent: AgentTarget | null | undefined,
  action: string
) => userHasTeamEffectiveAgentPermissionForTeam(organisation, agent?.team, action)

export const agentOwnershipLabel = (team?: { name: string } | null) =>
  team?.name || 'Organisation-owned'

export const agentTeamIdInput = (teamId: string) => teamId || null
