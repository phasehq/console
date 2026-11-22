/** App id → the ids of its environments a team has access to. */
export type TeamEnvScopes = Record<string, Set<string>>

export type TeamAppScope = { appId: string; envIds: string[] }

export type TeamAppAccessChanges = {
  /** Apps the team has no access to yet: their environments are added. */
  toAdd: TeamAppScope[]
  /** Apps the team already has: their environment scope is replaced. */
  toUpdate: TeamAppScope[]
  /** Apps the team loses. */
  toRemove: string[]
}

/**
 * What saving a team's app access has to change.
 *
 * `assignedAppIds` are the apps the team has access to. One of them can be
 * missing from `initial`: the team reaches it only through an environment that
 * is scheduled for deletion, which the dialog doesn't show. Its scope is
 * replaced, not added to. Adding would keep the hidden environment, and the
 * team would get it back when it is restored.
 */
export const teamAppAccessChanges = (
  initial: TeamEnvScopes,
  selected: TeamEnvScopes,
  assignedAppIds: Set<string>
): TeamAppAccessChanges => {
  const toAdd: TeamAppScope[] = []
  const toUpdate: TeamAppScope[] = []
  const toRemove: string[] = []

  for (const [appId, envIds] of Object.entries(selected)) {
    const scope = { appId, envIds: Array.from(envIds) }
    const before = initial[appId]

    if (!before) {
      if (assignedAppIds.has(appId)) toUpdate.push(scope)
      else toAdd.push(scope)
    } else if (envIds.size !== before.size || scope.envIds.some((id) => !before.has(id))) {
      toUpdate.push(scope)
    }
  }

  // All of an app's environments were deselected.
  for (const appId of Object.keys(initial)) {
    if (!selected[appId]) toRemove.push(appId)
  }

  return { toAdd, toUpdate, toRemove }
}
