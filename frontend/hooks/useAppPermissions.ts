import { useContext, useMemo, useCallback } from 'react'
import { useQuery } from '@apollo/client'
import { TeamType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { userHasPermission, userHasGlobalAccess } from '@/utils/access/permissions'

/**
 * Hook that computes effective app-level permissions using the override role model.
 *
 * For app-level resources (isAppResource=true), the effective permissions depend on
 * how the user accesses the app:
 *
 * - Team with memberRole override → override REPLACES the org role
 * - Team without memberRole override → org role applies (no override)
 * - No team-based access → org role applies (backward compat for direct membership)
 * - Global access (Owner/Admin) → org role always applies (bypasses restrictions)
 *
 * When a user has multiple access paths (e.g. multiple teams), the union of all
 * effective roles applies — most permissive wins across paths.
 *
 * For org-level resources (isAppResource=false), only the org role is checked.
 */
export function useAppPermissions(appId: string) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const isGlobalAccess = organisation
    ? userHasGlobalAccess(organisation.role!.permissions)
    : false

  const userCanReadTeams = organisation
    ? userHasPermission(organisation.role!.permissions, 'Teams', 'read')
    : false

  const { data: teamsData } = useQuery(GetTeams, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !userCanReadTeams,
  })

  // Compute effective permission sources for app-level checks.
  // Each source is a permissions JSON string representing one access path's effective role.
  const appPermissionSources = useMemo(() => {
    const sources: string[] = []

    // Global access users always get their org role (which has all permissions)
    if (isGlobalAccess) {
      if (organisation?.role?.permissions) sources.push(organisation.role.permissions)
      return sources
    }

    if (!teamsData?.teams || !organisation?.memberId) {
      // No teams data loaded yet — fall back to org role for backward compat
      if (organisation?.role?.permissions) sources.push(organisation.role.permissions)
      return sources
    }

    let hasTeamAccess = false

    for (const team of teamsData.teams as TeamType[]) {
      // Does this team include this app?
      const hasApp = team.apps?.some((a) => a.id === appId)
      if (!hasApp) continue

      // Is the current user a member of this team?
      const isMember = team.members?.some(
        (m) => m.orgMember?.id === organisation.memberId
      )
      if (!isMember) continue

      hasTeamAccess = true

      // Team owners retain their full org role for their team's apps —
      // they manage the team and its access grants, so the role override doesn't restrict them.
      const isTeamOwner = team.owner?.id === organisation.memberId

      if (isTeamOwner) {
        sources.push(organisation.role!.permissions!)
      } else if (team.memberRole?.permissions) {
        // Team has a role override → it REPLACES the org role for this access path
        sources.push(team.memberRole.permissions)
      } else {
        // Team has no role override → org role is the effective role for this path
        sources.push(organisation.role!.permissions!)
      }
    }

    if (!hasTeamAccess) {
      // User has no team-based access to this app → must be direct membership
      // Use org role (backward compat)
      if (organisation?.role?.permissions) sources.push(organisation.role.permissions)
    }

    return sources
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsData, appId, organisation?.memberId, organisation?.role?.permissions, isGlobalAccess])

  /**
   * Check if the user has a specific permission, accounting for team role overrides.
   *
   * For app-level resources: checks effective permissions from all access paths (union).
   * For org-level resources: checks org role only.
   */
  const hasPermission = useCallback(
    (resource: string, action: string, isAppResource: boolean = false): boolean => {
      if (isAppResource) {
        // Use computed effective permissions (team-aware)
        return appPermissionSources.some((perms) =>
          userHasPermission(perms, resource, action, true)
        )
      }

      // For org-level resources, always use org role directly
      return userHasPermission(organisation?.role?.permissions, resource, action, false)
    },
    [appPermissionSources, organisation?.role?.permissions]
  )

  return { hasPermission, isGlobalAccess }
}
