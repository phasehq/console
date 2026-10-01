

export type PermissionPolicy = {
  permissions: Record<string, string[]>; // A dictionary mapping resources to actions
  app_permissions: Record<string, string[]>; // A dictionary mapping app resources to actions
  global_access: boolean
};


/**
 * Parses a JSON string representing permissions into a PermissionPolicy object.
 * Discards any extra keys not defined in PermissionPolicy.
 * @param {string} permissionsJson - The JSON string representing permissions.
 * @returns {PermissionPolicy | null} The parsed and sanitized PermissionPolicy object, or null if the JSON is invalid.
 */
export const parsePermissions = (permissionsJson: string): PermissionPolicy | null => {
  try {
    const parsedJson = JSON.parse(permissionsJson);

    // Explicitly pick the known keys from the parsed JSON
    const filteredPolicy: Partial<PermissionPolicy> = {
      permissions: Object.hasOwn(parsedJson, 'permissions') ? parsedJson.permissions : {},
      app_permissions: Object.hasOwn(parsedJson, 'app_permissions') ? parsedJson.app_permissions : {},
      global_access: Object.hasOwn(parsedJson, 'global_access') ? parsedJson.global_access : false,
    };

    // Return the object with only the valid keys
    return filteredPolicy as PermissionPolicy;
  } catch (error) {
    return null;
  }
};

/**
 * Checks whether a user has a specific permission for a given resource.
 * @param {string} permissionsJson - The JSON string representing the user's permissions.
 * @param {string} resource - The resource to check (e.g., "Organisation", "Billing").
 * @param {string} action - The action to verify (e.g., "create", "read").
 * @param {boolean} [isAppResource=false] - Indicates if the check is for an app-level resource.
 * @returns {boolean} True if the user has the permission, otherwise false.
 */
export const userHasPermission = (
  permissionsJson: string,
  resource: string,
  action: string,
  isAppResource: boolean = false
): boolean => {
  const permissionsData = parsePermissions(permissionsJson);
  if (!permissionsData) {
    return false;
  }

  const permissionKey = isAppResource ? 'app_permissions' : 'permissions';
  const resourcePermissions = permissionsData[permissionKey]?.[resource] ?? [];

  // Check if the action is included in the resource's permissions
  return resourcePermissions.includes(action);
};

export const userHasGlobalAccess = (permissionsJson: string) => {
  const permissionsData = parsePermissions(permissionsJson);
  if (!permissionsData) {
    return false;
  }

  return permissionsData.global_access
}

/**
 * Roles assignable to members who haven't completed their key
 * ceremony (e.g. SCIM-provisioned users pre-first-login). Excludes
 * global-access roles and roles with ServiceAccountTokens.create —
 * both would enrol the member as an SA handler, and key wrapping for
 * an empty identity_key fails. Mirrors the backend safelist in
 * BulkInviteOrganisationMembersMutation and UpdateOrganisationMemberRole.
 */
export const isRoleCryptoSafe = (permissionsJson: string): boolean => {
  if (userHasGlobalAccess(permissionsJson)) return false;
  if (userHasPermission(permissionsJson, 'ServiceAccountTokens', 'create'))
    return false;
  return true;
};

/**
 * Determines if a user is an admin based on their role.
 * @param {string} role - The user's role.
 * @returns {boolean} True if the user is an admin or owner, otherwise false.
 */
export const userIsAdmin = (role: string): boolean =>
  ['admin', 'owner'].includes(role.toLowerCase());

/**
 * Returns the permissions in a target policy that exceed the actor's own policy,
 * as "<scope>:<resource>:<action>" strings (or "global_access"). An empty array
 * means the grant is within the actor's ceiling.
 *
 * Actors with global access are exempt — global_access is the delegation escape
 * hatch, so Owner/Admin can grant permissions they don't individually hold.
 * Mirrors role_grant_violations on the backend, which is the enforcement point;
 * this is for UX (disabling toggles / role options ahead of the server error).
 *
 * @param {PermissionPolicy | null} actorPolicy - The caller's own policy (null fails closed).
 * @param {PermissionPolicy} targetPolicy - The policy being granted via role create/update or assignment.
 * @returns {string[]} The permissions exceeding the actor's ceiling.
 */
export const roleGrantViolations = (
  actorPolicy: PermissionPolicy | null,
  targetPolicy: PermissionPolicy
): string[] => {
  if (actorPolicy?.global_access) return [];

  const violations: string[] = [];
  if (targetPolicy.global_access) violations.push('global_access');

  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  const scopes = ['permissions', 'app_permissions'] as const;
  for (const scope of scopes) {
    const ceilingRaw: unknown = actorPolicy?.[scope];
    const ceiling = isPlainObject(ceilingRaw) ? ceilingRaw : {};

    const targetScope: unknown = targetPolicy[scope] ?? {};
    if (!isPlainObject(targetScope)) {
      // Malformed legacy shapes can still grant at enforcement time, so
      // they must never pass the ceiling — report, don't coerce to empty
      violations.push(`${scope}:invalid`);
      continue;
    }

    for (const [resource, actions] of Object.entries(targetScope)) {
      if (!Array.isArray(actions) || actions.some((action) => typeof action !== 'string')) {
        violations.push(`${scope}:${resource}:invalid`);
        continue;
      }

      const allowedRaw = ceiling[resource];
      const allowed = new Set(
        Array.isArray(allowedRaw)
          ? allowedRaw.filter((action): action is string => typeof action === 'string')
          : []
      );
      for (const action of new Set(actions)) {
        if (!allowed.has(action)) violations.push(`${scope}:${resource}:${action}`);
      }
    }
  }

  return violations;
};

/**
 * Checks whether the actor's policy allows granting a single permission —
 * userHasPermission plus the global-access exemption. Suited to disabling
 * individual toggles in the role dialogs.
 *
 * @param {PermissionPolicy | null} actorPolicy - The caller's own policy (null fails closed).
 * @param {string} resource - The resource being granted (e.g., "Roles", "Secrets").
 * @param {string} action - The action being granted (e.g., "create", "read").
 * @param {boolean} [isAppResource=false] - Indicates if this is an app-level resource.
 * @returns {boolean} True if the actor may grant this permission.
 */
export const userCanGrantPermission = (
  actorPolicy: PermissionPolicy | null,
  resource: string,
  action: string,
  isAppResource: boolean = false
): boolean => {
  if (!actorPolicy) return false;
  if (actorPolicy.global_access) return true;

  const permissionKey = isAppResource ? 'app_permissions' : 'permissions';
  const allowed: unknown = actorPolicy[permissionKey]?.[resource];
  // Guard against malformed legacy shapes — a string here would substring-match
  return Array.isArray(allowed) && allowed.includes(action);
};

/**
 * Checks whether a role assignment is within the caller's ceiling, from the
 * permissions JSON of both roles (default roles arrive pre-resolved from the
 * API). Fails closed if either JSON is invalid.
 *
 * @param {string} actorPermissionsJson - The caller's role permissions JSON.
 * @param {string} targetPermissionsJson - The permissions JSON of the role being assigned.
 * @returns {boolean} True if the caller may assign the role.
 */
export const userCanGrantRole = (
  actorPermissionsJson: string,
  targetPermissionsJson: string
): boolean => {
  const targetPolicy = parsePermissions(targetPermissionsJson);
  if (!targetPolicy) return false;

  return (
    roleGrantViolations(parsePermissions(actorPermissionsJson), targetPolicy).length === 0
  );
};

/**
 * Union variant of userCanGrantRole — the grant is permitted if the actor's
 * combined roles (e.g. org role plus a team role override) together cover
 * every permission in the target role. Mirrors roles_grant_violations on the
 * backend. Fails closed on invalid JSON or an empty actor list.
 *
 * @param {string[]} actorPermissionsJsons - Permissions JSON of each of the actor's applicable roles.
 * @param {string} targetPermissionsJson - The permissions JSON of the role being assigned.
 * @returns {boolean} True if the combined roles may assign the target role.
 */
export const userCanGrantRoleFromAny = (
  actorPermissionsJsons: string[],
  targetPermissionsJson: string
): boolean => {
  const targetPolicy = parsePermissions(targetPermissionsJson);
  if (!targetPolicy) return false;

  // A violation stands only if every actor role reports it
  let remaining: Set<string> | null = null;
  for (const actorJson of actorPermissionsJsons) {
    const violations = roleGrantViolations(parsePermissions(actorJson), targetPolicy);
    if (violations.length === 0) return true;

    const current = new Set(violations);
    if (remaining === null) {
      remaining = current;
    } else {
      const prior: Set<string> = remaining;
      remaining = new Set([...prior].filter((violation) => current.has(violation)));
    }
    if (remaining.size === 0) return true;
  }

  return false;
};

/**
 * Compare two PermissionPolicy objects to check if they are equal.
 * 
 * @param policy1 - The first PermissionPolicy object.
 * @param policy2 - The second PermissionPolicy object.
 * @returns A boolean indicating whether the two policies are equal.
 */
export const arePoliciesEqual = (
  policy1: PermissionPolicy,
  policy2: PermissionPolicy
): boolean => {
  // Check if global_access is the same
  if (policy1.global_access !== policy2.global_access) {
    return false;
  }

  // Helper function to compare two Record<string, string[]>
  const comparePermissions = (
    perms1: Record<string, string[]>,
    perms2: Record<string, string[]>
  ): boolean => {
    const keys1 = Object.keys(perms1);
    const keys2 = Object.keys(perms2);

    // Check if both have the same number of keys
    if (keys1.length !== keys2.length) {
      return false;
    }

    for (const key of keys1) {
      // Check if both records have the same keys
      if (!(key in perms2)) {
        return false;
      }

      // Check if the arrays of actions are equal
      const actions1 = perms1[key];
      const actions2 = perms2[key];

      if (actions1.length !== actions2.length) {
        return false;
      }

      // Sort and compare the arrays of actions
      const sortedActions1 = [...actions1].sort();
      const sortedActions2 = [...actions2].sort();

      for (let i = 0; i < sortedActions1.length; i++) {
        if (sortedActions1[i] !== sortedActions2[i]) {
          return false;
        }
      }
    }

    return true;
  };

  // Compare both permissions and app_permissions
  return (
    comparePermissions(policy1.permissions, policy2.permissions) &&
    comparePermissions(policy1.app_permissions, policy2.app_permissions)
  );
};

/**
 * Updates a given PermissionPolicy by either toggling global access or adding/removing an action for a specific resource.
 *
 * @param {PermissionPolicy} policy - The current permission policy to be updated.
 * @param {Object} options - The options to determine the type of update.
 * @param {string} [options.resource] - The name of the resource to update (e.g., "Roles", "Secrets").
 * @param {string} [options.action] - The action to add or remove from the resource (e.g., "create", "update").
 * @param {boolean} [options.isAppResource=false] - Whether the resource is an app-level resource.
 * @param {boolean} [options.toggleGlobalAccess=false] - Whether to toggle the global access setting.
 * @returns {PermissionPolicy} - The updated permission policy object.
 *
 * @example
 * // Toggle global access
 * const updatedPolicy = togglePolicyResourcePermission(currentPolicy, { toggleGlobalAccess: true });
 *
 * @example
 * // Add or remove an action for a resource
 * const updatedPolicy = togglePolicyResourcePermission(currentPolicy, { 
 *   resource: "Roles", 
 *   action: "create", 
 *   isAppResource: false 
 * });
 */
export const togglePolicyResourcePermission = (
  policy: PermissionPolicy,
  options: {
    resource?: string;
    action?: string;
    isAppResource?: boolean;
    toggleGlobalAccess?: boolean;
  }
): PermissionPolicy => {
  const updatedPolicy = structuredClone(policy)!;

  // Handle global access toggle
  if (options.toggleGlobalAccess) {
    updatedPolicy.global_access = !policy.global_access;
  }

  // Handle resource action update
  if (options.resource && options.action) {
    const { resource, action, isAppResource = false } = options;
    const permissions = isAppResource ? updatedPolicy.app_permissions : updatedPolicy.permissions;

    if (!permissions[resource]) {
      permissions[resource] = [];
    }

    const actionIndex = permissions[resource].indexOf(action);

    if (actionIndex > -1) {
      permissions[resource] = permissions[resource].filter(
        (resourceAction) => resourceAction !== action
      );
    } else {
      permissions[resource] = [...permissions[resource], action];
    }
  }

  return updatedPolicy;
};


/**
* Updates a given PermissionPolicy by either toggling global access or setting a list of actions for a specific resource.
*
* @param {PermissionPolicy} policy - The current permission policy to be updated.
* @param {Object} options - The options to determine the type of update.
* @param {string} [options.resource] - The name of the resource to update (e.g., "Roles", "Secrets").
* @param {string[]} [options.actions] - The array of actions to set for the resource (e.g., ["create", "update"]).
* @param {boolean} [options.isAppResource=false] - Whether the resource is an app-level resource.
* @param {boolean} [options.toggleGlobalAccess=false] - Whether to toggle the global access setting.
* @returns {PermissionPolicy} - The updated permission policy object.
*
* @example
* // Toggle global access
* const updatedPolicy = updatePolicyResourcePermissions(currentPolicy, { toggleGlobalAccess: true });
*
* @example
* // Set actions for a resource, replacing existing ones
* const updatedPolicy = updatePolicyResourcePermissions(currentPolicy, { 
*   resource: "Roles", 
*   actions: ["create", "update"], 
*   isAppResource: false 
* });
*/
export const updatePolicyResourcePermissions = (
 policy: PermissionPolicy,
 options: {
   resource?: string;
   actions?: string[];
   isAppResource?: boolean;
   toggleGlobalAccess?: boolean;
 }
): PermissionPolicy => {
 const updatedPolicy = structuredClone(policy)!;

 // Handle global access toggle
 if (options.toggleGlobalAccess) {
   updatedPolicy.global_access = !policy.global_access;
 }

 // Handle resource actions update by replacing existing actions
 if (options.resource && options.actions) {
   const { resource, actions, isAppResource = false } = options;
   const permissions = isAppResource ? updatedPolicy.app_permissions : updatedPolicy.permissions;

   // Replace the current actions with the provided actions array
   permissions[resource] = [...actions];
 }

 return updatedPolicy;
};
