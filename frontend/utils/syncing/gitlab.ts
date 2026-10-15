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

// Most scopes the picker lists at once. Projects with review apps can have thousands
// of environments, and the combobox re-sorts all of its options each time one is
// added or removed, which froze the page. Typing searches all of them.
export const GITLAB_ENVIRONMENT_SCOPE_OPTIONS_LIMIT = 50

/**
 * Scopes offered by the environment scope picker: all environments, the project's
 * environments, and the typed query as a custom scope (e.g. a wildcard like review/*)
 * if it is valid and not already listed. At most `limit` scopes are returned, with an
 * exact match first, and `hiddenCount` is the number of other matching scopes.
 */
export const gitLabEnvironmentScopeOptions = (
  environments: string[],
  query: string,
  limit = GITLAB_ENVIRONMENT_SCOPE_OPTIONS_LIMIT
) => {
  const scopes = [
    GITLAB_ALL_ENVIRONMENTS_SCOPE,
    ...environments.filter((environment) => environment !== GITLAB_ALL_ENVIRONMENTS_SCOPE),
  ]
  const trimmedQuery = query.trim()

  let matchingScopes = scopes
  let customScope = null

  if (trimmedQuery) {
    const queryLower = trimmedQuery.toLowerCase()
    matchingScopes = scopes.filter(
      (scope) =>
        scope.toLowerCase().includes(queryLower) ||
        gitLabEnvironmentScopeLabel(scope).toLowerCase().includes(queryLower)
    )
    // A typed environment name stays selectable, however many other scopes match
    const exactMatch = matchingScopes.find((scope) => scope.toLowerCase() === queryLower)
    if (exactMatch) {
      matchingScopes = [exactMatch, ...matchingScopes.filter((scope) => scope !== exactMatch)]
    }
    customScope =
      !scopes.includes(trimmedQuery) && isValidGitLabEnvironmentScope(trimmedQuery)
        ? trimmedQuery
        : null
  }

  return {
    scopes: matchingScopes.slice(0, limit),
    customScope,
    hiddenCount: Math.max(matchingScopes.length - limit, 0),
  }
}
