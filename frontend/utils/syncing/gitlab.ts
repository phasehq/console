// GitLab's default environment scope: the variable is available to every environment.
export const GITLAB_ALL_ENVIRONMENTS_SCOPE = '*'

// Mirrors GitLab's validation for CI/CD variable environment scopes.
const GITLAB_ENVIRONMENT_SCOPE_REGEX = /^[a-zA-Z0-9_/${}. *-]+$/
const GITLAB_ENVIRONMENT_SCOPE_MAX_LENGTH = 255

export const isValidGitLabEnvironmentScope = (scope: string) => {
  const trimmed = scope.trim()
  return (
    trimmed.length > 0 &&
    trimmed.length <= GITLAB_ENVIRONMENT_SCOPE_MAX_LENGTH &&
    GITLAB_ENVIRONMENT_SCOPE_REGEX.test(trimmed)
  )
}

export const gitLabEnvironmentScopeLabel = (scope?: string | null) =>
  !scope || scope === GITLAB_ALL_ENVIRONMENTS_SCOPE ? 'All environments' : scope

/**
 * Scopes offered by the environment scope picker: all environments, the project's
 * environments, and the typed query as a custom scope (e.g. a wildcard like review/*)
 * if it is valid and not already listed.
 */
export const gitLabEnvironmentScopeOptions = (environments: string[], query: string) => {
  const scopes = [
    GITLAB_ALL_ENVIRONMENTS_SCOPE,
    ...environments.filter((environment) => environment !== GITLAB_ALL_ENVIRONMENTS_SCOPE),
  ]
  const trimmedQuery = query.trim()

  if (!trimmedQuery) return { scopes, customScope: null }

  const queryLower = trimmedQuery.toLowerCase()
  const matchingScopes = scopes.filter(
    (scope) =>
      scope.toLowerCase().includes(queryLower) ||
      gitLabEnvironmentScopeLabel(scope).toLowerCase().includes(queryLower)
  )
  const customScope =
    !scopes.includes(trimmedQuery) && isValidGitLabEnvironmentScope(trimmedQuery)
      ? trimmedQuery
      : null

  return { scopes: matchingScopes, customScope }
}
