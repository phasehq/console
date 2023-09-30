export const userIsAdmin = (role: string) =>
  ['admin', 'owner'].includes(role.toLowerCase()) ?? false
