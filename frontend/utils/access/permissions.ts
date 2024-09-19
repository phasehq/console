

export type PermissionPolicy = {
  permissions: Record<string, string[]>; // A dictionary mapping resources to actions
  app_permissions: Record<string, string[]>; // A dictionary mapping app resources to actions
  global_access: boolean
};

/**
 * Parses a JSON string representing permissions into a PermissionPolicy object.
 * @param {string} permissionsJson - The JSON string representing permissions.
 * @returns {PermissionPolicy | null} The parsed PermissionPolicy object, or null if the JSON is invalid.
 */
export const parsePermissions = (permissionsJson: string): PermissionPolicy | null => {
  try {
    return JSON.parse(permissionsJson) as PermissionPolicy;
  } catch (error) {
    console.error("Invalid JSON string", error);
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

  // Compare both permissions and app_permissions
  return (
    comparePermissions(policy1.permissions, policy2.permissions) &&
    comparePermissions(policy1.app_permissions, policy2.app_permissions)
  );
};