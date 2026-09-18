

export type PermissionPolicy = {
  permissions: Record<string, string[]>; // A dictionary mapping resources to actions
  app_permissions: Record<string, string[]>; // A dictionary mapping app resources to actions
  agent_permissions: Record<string, string[]>; // A dictionary mapping per-Agent resources to actions
  global_access: boolean
};

export type PermissionKey = 'permissions' | 'app_permissions' | 'agent_permissions'

/**
 * Resources that act within an Agent, stored under `agent_permissions`.
 * Mirrors AGENT_PERMISSION_RESOURCES in backend/api/utils/access/roles.py.
 */
export const AGENT_PERMISSION_RESOURCES = [
  'AgentWorkflows',
  'AgentMemberships',
  'AgentTokens',
  'AgentSessions',
] as const

const agentPermissionResources = new Set<string>(AGENT_PERMISSION_RESOURCES)

/**
 * The policy map a resource's grants live in. App resources need the explicit
 * flag because their names collide with organisation ones (`Members`, `Logs`);
 * Agent resources are uniquely named, so they route by name.
 */
export const permissionKeyFor = (resource: string, isAppResource = false): PermissionKey => {
  if (isAppResource) return 'app_permissions'
  if (agentPermissionResources.has(resource)) return 'agent_permissions'
  return 'permissions'
}


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
      agent_permissions: Object.hasOwn(parsedJson, 'agent_permissions')
        ? parsedJson.agent_permissions
        : {},
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

  const permissionKey = permissionKeyFor(resource, isAppResource);
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

  // Compare every permission map; a change confined to one must still count.
  return (
    comparePermissions(policy1.permissions, policy2.permissions) &&
    comparePermissions(policy1.app_permissions, policy2.app_permissions) &&
    comparePermissions(policy1.agent_permissions ?? {}, policy2.agent_permissions ?? {})
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
    const permissionKey = permissionKeyFor(resource, isAppResource);
    updatedPolicy[permissionKey] ??= {};
    const permissions = updatedPolicy[permissionKey];

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
   const permissionKey = permissionKeyFor(resource, isAppResource);
   updatedPolicy[permissionKey] ??= {};
   const permissions = updatedPolicy[permissionKey];

   // Replace the current actions with the provided actions array
   permissions[resource] = [...actions];
 }

 return updatedPolicy;
};
