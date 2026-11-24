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
 * how the user accesses the app. Each access path contributes one role:
 *
 * - Direct app membership → org role
 * - Team with memberRole override → the override, in place of the org role for that path
 * - Team without memberRole override, or a team the user owns → org role
 * - Global access (Owner/Admin) → org role always applies (bypasses restrictions)
 *
 * The union of all paths applies — most permissive wins, as in the backend's
 * `_check_app_permission`. A team override never narrows a direct member's org role.
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

  const isDirectMember = organisation?.individualAppIds?.includes(appId) ?? false

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

    // Direct membership keeps the org role, alongside any team access
    if (isDirectMember) sources.push(organisation.role!.permissions!)

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

    if (!hasTeamAccess && !isDirectMember) {
      // No known access path → use org role (backward compat)
      if (organisation?.role?.permissions) sources.push(organisation.role.permissions)
    }

    return Array.from(new Set(sources))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    teamsData,
    appId,
    organisation?.memberId,
    organisation?.role?.permissions,
    isGlobalAccess,
    isDirectMember,
  ])

  /**
   * Check a permission in the context of this app. Always team-aware
   * (union across individual + team access paths). `isAppResource`
   * controls which map within each role is checked — app_permissions
   * for env/secret/etc. resources, top-level permissions for Apps,
   * EncryptionMode, Members.
   */
  const hasPermission = useCallback(
    (resource: string, action: string, isAppResource: boolean = false): boolean => {
      return appPermissionSources.some((perms) =>
        userHasPermission(perms, resource, action, isAppResource)
      )
    },
    [appPermissionSources]
  )

  return { hasPermission, isGlobalAccess }
}
