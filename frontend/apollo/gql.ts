/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 */
const documents = {
    "mutation CreateRole($name: String!, $description: String!, $color: String!, $permissions: JSONString!, $organisationId: ID!) {\n  createCustomRole(\n    name: $name\n    description: $description\n    color: $color\n    permissions: $permissions\n    organisationId: $organisationId\n  ) {\n    role {\n      id\n    }\n  }\n}": types.CreateRoleDocument,
    "mutation DeleteRole($id: ID!) {\n  deleteCustomRole(id: $id) {\n    ok\n  }\n}": types.DeleteRoleDocument,
    "mutation UpdateRole($id: ID!, $name: String!, $description: String!, $color: String!, $permissions: JSONString!) {\n  updateCustomRole(\n    id: $id\n    name: $name\n    description: $description\n    color: $color\n    permissions: $permissions\n  ) {\n    role {\n      id\n    }\n  }\n}": types.UpdateRoleDocument,
    "mutation AddMemberToApp($memberId: ID!, $memberType: MemberType, $appId: ID!, $envKeys: [EnvironmentKeyInput]) {\n  addAppMember(\n    memberId: $memberId\n    memberType: $memberType\n    appId: $appId\n    envKeys: $envKeys\n  ) {\n    app {\n      id\n    }\n  }\n}": types.AddMemberToAppDocument,
    "mutation RemoveMemberFromApp($memberId: ID!, $memberType: MemberType, $appId: ID!) {\n  removeAppMember(memberId: $memberId, memberType: $memberType, appId: $appId) {\n    app {\n      id\n    }\n  }\n}": types.RemoveMemberFromAppDocument,
    "mutation UpdateEnvScope($memberId: ID!, $memberType: MemberType, $appId: ID!, $envKeys: [EnvironmentKeyInput]) {\n  updateMemberEnvironmentScope(\n    memberId: $memberId\n    memberType: $memberType\n    appId: $appId\n    envKeys: $envKeys\n  ) {\n    app {\n      id\n    }\n  }\n}": types.UpdateEnvScopeDocument,
    "mutation InitStripeProUpgradeCheckout($organisationId: ID!, $billingPeriod: String!) {\n  createProUpgradeCheckoutSession(\n    organisationId: $organisationId\n    billingPeriod: $billingPeriod\n  ) {\n    clientSecret\n  }\n}": types.InitStripeProUpgradeCheckoutDocument,
    "mutation CreateApplication($id: ID!, $organisationId: ID!, $name: String!, $identityKey: String!, $appToken: String!, $appSeed: String!, $wrappedKeyShare: String!, $appVersion: Int!) {\n  createApp(\n    id: $id\n    organisationId: $organisationId\n    name: $name\n    identityKey: $identityKey\n    appToken: $appToken\n    appSeed: $appSeed\n    wrappedKeyShare: $wrappedKeyShare\n    appVersion: $appVersion\n  ) {\n    app {\n      id\n      name\n      identityKey\n    }\n  }\n}": types.CreateApplicationDocument,
    "mutation CreateOrg($id: ID!, $name: String!, $identityKey: String!, $wrappedKeyring: String!, $wrappedRecovery: String!) {\n  createOrganisation(\n    id: $id\n    name: $name\n    identityKey: $identityKey\n    wrappedKeyring: $wrappedKeyring\n    wrappedRecovery: $wrappedRecovery\n  ) {\n    organisation {\n      id\n      name\n      memberId\n    }\n  }\n}": types.CreateOrgDocument,
    "mutation DeleteApplication($id: ID!) {\n  deleteApp(id: $id) {\n    ok\n  }\n}": types.DeleteApplicationDocument,
    "mutation BulkProcessSecrets($secretsToCreate: [SecretInput!]!, $secretsToUpdate: [SecretInput!]!, $secretsToDelete: [ID!]!) {\n  createSecrets(secretsData: $secretsToCreate) {\n    secrets {\n      id\n    }\n  }\n  editSecrets(secretsData: $secretsToUpdate) {\n    secrets {\n      id\n    }\n  }\n  deleteSecrets(ids: $secretsToDelete) {\n    secrets {\n      id\n    }\n  }\n}": types.BulkProcessSecretsDocument,
    "mutation CreateEnv($envInput: EnvironmentInput!, $adminKeys: [EnvironmentKeyInput], $wrappedSeed: String, $wrappedSalt: String) {\n  createEnvironment(\n    environmentData: $envInput\n    adminKeys: $adminKeys\n    wrappedSeed: $wrappedSeed\n    wrappedSalt: $wrappedSalt\n  ) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n}": types.CreateEnvDocument,
    "mutation CreateEnvKey($envId: ID!, $userId: ID, $wrappedSeed: String!, $wrappedSalt: String!, $identityKey: String!) {\n  createEnvironmentKey(\n    envId: $envId\n    userId: $userId\n    wrappedSeed: $wrappedSeed\n    wrappedSalt: $wrappedSalt\n    identityKey: $identityKey\n  ) {\n    environmentKey {\n      id\n      createdAt\n    }\n  }\n}": types.CreateEnvKeyDocument,
    "mutation CreateEnvToken($envId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!) {\n  createEnvironmentToken(\n    envId: $envId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n  ) {\n    environmentToken {\n      id\n      createdAt\n    }\n  }\n}": types.CreateEnvTokenDocument,
    "mutation CreateNewSecretFolder($envId: ID!, $name: String!, $path: String!) {\n  createSecretFolder(envId: $envId, name: $name, path: $path) {\n    folder {\n      id\n      name\n      path\n    }\n  }\n}": types.CreateNewSecretFolderDocument,
    "mutation CreateNewPersonalSecret($newPersonalSecret: PersonalSecretInput!) {\n  createOverride(overrideData: $newPersonalSecret) {\n    override {\n      id\n      secret {\n        id\n      }\n      value\n      isActive\n      createdAt\n    }\n  }\n}": types.CreateNewPersonalSecretDocument,
    "mutation CreateNewSecret($newSecret: SecretInput!) {\n  createSecret(secretData: $newSecret) {\n    secret {\n      id\n      key\n      value\n      createdAt\n    }\n  }\n}": types.CreateNewSecretDocument,
    "mutation CreateNewSecretTag($orgId: ID!, $name: String!, $color: String!) {\n  createSecretTag(orgId: $orgId, name: $name, color: $color) {\n    tag {\n      id\n    }\n  }\n}": types.CreateNewSecretTagDocument,
    "mutation CreateNewServiceToken($appId: ID!, $environmentKeys: [EnvironmentKeyInput], $identityKey: String!, $token: String!, $wrappedKeyShare: String!, $name: String!, $expiry: BigInt) {\n  createServiceToken(\n    appId: $appId\n    environmentKeys: $environmentKeys\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n    name: $name\n    expiry: $expiry\n  ) {\n    serviceToken {\n      id\n      createdAt\n      expiresAt\n    }\n  }\n}": types.CreateNewServiceTokenDocument,
    "mutation DeleteEnv($environmentId: ID!) {\n  deleteEnvironment(environmentId: $environmentId) {\n    ok\n  }\n}": types.DeleteEnvDocument,
    "mutation DeleteFolder($folderId: ID!) {\n  deleteSecretFolder(folderId: $folderId) {\n    ok\n  }\n}": types.DeleteFolderDocument,
    "mutation DeleteSecretOp($id: ID!) {\n  deleteSecret(id: $id) {\n    secret {\n      id\n    }\n  }\n}": types.DeleteSecretOpDocument,
    "mutation RevokeServiceToken($tokenId: ID!) {\n  deleteServiceToken(tokenId: $tokenId) {\n    ok\n  }\n}": types.RevokeServiceTokenDocument,
    "mutation UpdateSecret($id: ID!, $secretData: SecretInput!) {\n  editSecret(id: $id, secretData: $secretData) {\n    secret {\n      id\n      updatedAt\n    }\n  }\n}": types.UpdateSecretDocument,
    "mutation InitAppEnvironments($devEnv: EnvironmentInput!, $stagingEnv: EnvironmentInput!, $prodEnv: EnvironmentInput!, $devAdminKeys: [EnvironmentKeyInput], $stagAdminKeys: [EnvironmentKeyInput], $prodAdminKeys: [EnvironmentKeyInput]) {\n  devEnvironment: createEnvironment(\n    environmentData: $devEnv\n    adminKeys: $devAdminKeys\n  ) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n  stagingEnvironment: createEnvironment(\n    environmentData: $stagingEnv\n    adminKeys: $stagAdminKeys\n  ) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n  prodEnvironment: createEnvironment(\n    environmentData: $prodEnv\n    adminKeys: $prodAdminKeys\n  ) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n}": types.InitAppEnvironmentsDocument,
    "mutation LogSecretReads($ids: [ID]!) {\n  readSecret(ids: $ids) {\n    ok\n  }\n}": types.LogSecretReadsDocument,
    "mutation RemovePersonalSecret($secretId: ID!) {\n  removeOverride(secretId: $secretId) {\n    ok\n  }\n}": types.RemovePersonalSecretDocument,
    "mutation RenameEnv($environmentId: ID!, $name: String!) {\n  renameEnvironment(environmentId: $environmentId, name: $name) {\n    environment {\n      id\n      name\n      updatedAt\n    }\n  }\n}": types.RenameEnvDocument,
    "mutation CreateSharedSecret($input: LockboxInput!) {\n  createLockbox(input: $input) {\n    lockbox {\n      id\n      allowedViews\n      expiresAt\n    }\n  }\n}": types.CreateSharedSecretDocument,
    "mutation SwapEnvOrder($environment1Id: ID!, $environment2Id: ID!) {\n  swapEnvironmentOrder(\n    environment1Id: $environment1Id\n    environment2Id: $environment2Id\n  ) {\n    ok\n  }\n}": types.SwapEnvOrderDocument,
    "mutation AcceptOrganisationInvite($orgId: ID!, $identityKey: String!, $wrappedKeyring: String!, $wrappedRecovery: String!, $inviteId: ID!) {\n  createOrganisationMember(\n    orgId: $orgId\n    identityKey: $identityKey\n    wrappedKeyring: $wrappedKeyring\n    wrappedRecovery: $wrappedRecovery\n    inviteId: $inviteId\n  ) {\n    orgMember {\n      id\n      email\n      createdAt\n      role {\n        name\n      }\n    }\n  }\n}": types.AcceptOrganisationInviteDocument,
    "mutation DeleteOrgInvite($inviteId: ID!) {\n  deleteInvitation(inviteId: $inviteId) {\n    ok\n  }\n}": types.DeleteOrgInviteDocument,
    "mutation RemoveMember($memberId: ID!) {\n  deleteOrganisationMember(memberId: $memberId) {\n    ok\n  }\n}": types.RemoveMemberDocument,
    "mutation InviteMember($orgId: ID!, $email: String!, $apps: [String]) {\n  inviteOrganisationMember(orgId: $orgId, email: $email, apps: $apps) {\n    invite {\n      id\n    }\n  }\n}": types.InviteMemberDocument,
    "mutation UpdateMemberRole($memberId: ID!, $roleId: ID!) {\n  updateOrganisationMemberRole(memberId: $memberId, roleId: $roleId) {\n    orgMember {\n      id\n      role {\n        name\n      }\n    }\n  }\n}": types.UpdateMemberRoleDocument,
    "mutation UpdateWrappedSecrets($orgId: ID!, $wrappedKeyring: String!, $wrappedRecovery: String!) {\n  updateMemberWrappedSecrets(\n    orgId: $orgId\n    wrappedKeyring: $wrappedKeyring\n    wrappedRecovery: $wrappedRecovery\n  ) {\n    orgMember {\n      id\n    }\n  }\n}": types.UpdateWrappedSecretsDocument,
    "mutation RotateAppKey($id: ID!, $appToken: String!, $wrappedKeyShare: String!) {\n  rotateAppKeys(id: $id, appToken: $appToken, wrappedKeyShare: $wrappedKeyShare) {\n    app {\n      id\n    }\n  }\n}": types.RotateAppKeyDocument,
    "mutation CreateServiceAccountOp($name: String!, $orgId: ID!, $roleId: ID!, $identityKey: String!, $handlers: [ServiceAccountHandlerInput], $serverWrappedKeyring: String, $serverWrappedRecovery: String) {\n  createServiceAccount(\n    name: $name\n    organisationId: $orgId\n    roleId: $roleId\n    identityKey: $identityKey\n    handlers: $handlers\n    serverWrappedKeyring: $serverWrappedKeyring\n    serverWrappedRecovery: $serverWrappedRecovery\n  ) {\n    serviceAccount {\n      id\n    }\n  }\n}": types.CreateServiceAccountOpDocument,
    "mutation CreateSAToken($serviceAccountId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!, $expiry: BigInt) {\n  createServiceAccountToken(\n    serviceAccountId: $serviceAccountId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n    expiry: $expiry\n  ) {\n    token {\n      id\n    }\n  }\n}": types.CreateSaTokenDocument,
    "mutation DeleteServiceAccountOp($id: ID!) {\n  deleteServiceAccount(serviceAccountId: $id) {\n    ok\n  }\n}": types.DeleteServiceAccountOpDocument,
    "mutation DeleteServiceAccountTokenOp($id: ID!) {\n  deleteServiceAccountToken(tokenId: $id) {\n    ok\n  }\n}": types.DeleteServiceAccountTokenOpDocument,
    "mutation UpdateServiceAccountHandlerKeys($orgId: ID!, $handlers: [ServiceAccountHandlerInput]) {\n  updateServiceAccountHandlers(organisationId: $orgId, handlers: $handlers) {\n    ok\n  }\n}": types.UpdateServiceAccountHandlerKeysDocument,
    "mutation UpdateServiceAccountOp($serviceAccountId: ID!, $name: String!, $roleId: ID!) {\n  updateServiceAccount(\n    serviceAccountId: $serviceAccountId\n    name: $name\n    roleId: $roleId\n  ) {\n    serviceAccount {\n      id\n    }\n  }\n}": types.UpdateServiceAccountOpDocument,
    "mutation CreateNewAWSSecretsSync($envId: ID!, $path: String!, $credentialId: ID!, $secretName: String!, $kmsId: String) {\n  createAwsSecretSync(\n    envId: $envId\n    path: $path\n    credentialId: $credentialId\n    secretName: $secretName\n    kmsId: $kmsId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}": types.CreateNewAwsSecretsSyncDocument,
    "mutation CreateNewCfPagesSync($envId: ID!, $path: String!, $projectName: String!, $deploymentId: ID!, $projectEnv: String!, $credentialId: ID!) {\n  createCloudflarePagesSync(\n    envId: $envId\n    path: $path\n    projectName: $projectName\n    deploymentId: $deploymentId\n    projectEnv: $projectEnv\n    credentialId: $credentialId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}": types.CreateNewCfPagesSyncDocument,
    "mutation DeleteProviderCreds($credentialId: ID!) {\n  deleteProviderCredentials(credentialId: $credentialId) {\n    ok\n  }\n}": types.DeleteProviderCredsDocument,
    "mutation DeleteSync($syncId: ID!) {\n  deleteEnvSync(syncId: $syncId) {\n    ok\n  }\n}": types.DeleteSyncDocument,
    "mutation CreateNewGhActionsSync($envId: ID!, $path: String!, $repoName: String!, $owner: String!, $credentialId: ID!) {\n  createGhActionsSync(\n    envId: $envId\n    path: $path\n    repoName: $repoName\n    owner: $owner\n    credentialId: $credentialId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}": types.CreateNewGhActionsSyncDocument,
    "mutation CreateNewGitlabCiSync($envId: ID!, $path: String!, $credentialId: ID!, $resourcePath: String!, $resourceId: String!, $isGroup: Boolean!, $isMasked: Boolean!, $isProtected: Boolean!) {\n  createGitlabCiSync(\n    envId: $envId\n    path: $path\n    credentialId: $credentialId\n    resourcePath: $resourcePath\n    resourceId: $resourceId\n    isGroup: $isGroup\n    masked: $isMasked\n    protected: $isProtected\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}": types.CreateNewGitlabCiSyncDocument,
    "mutation InitAppSyncing($appId: ID!, $envKeys: [EnvironmentKeyInput]) {\n  initEnvSync(appId: $appId, envKeys: $envKeys) {\n    app {\n      id\n      sseEnabled\n    }\n  }\n}": types.InitAppSyncingDocument,
    "mutation CreateNewNomadSync($envId: ID!, $path: String!, $nomadPath: String!, $nomadNamespace: String!, $credentialId: ID!) {\n  createNomadSync(\n    envId: $envId\n    path: $path\n    nomadPath: $nomadPath\n    nomadNamespace: $nomadNamespace\n    credentialId: $credentialId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}": types.CreateNewNomadSyncDocument,
    "mutation CreateNewRailwaySync($envId: ID!, $path: String!, $credentialId: ID!, $railwayProject: RailwayResourceInput!, $railwayEnvironment: RailwayResourceInput!, $railwayService: RailwayResourceInput) {\n  createRailwaySync(\n    envId: $envId\n    path: $path\n    credentialId: $credentialId\n    railwayProject: $railwayProject\n    railwayEnvironment: $railwayEnvironment\n    railwayService: $railwayService\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}": types.CreateNewRailwaySyncDocument,
    "mutation SaveNewProviderCreds($orgId: ID!, $provider: String!, $name: String!, $credentials: JSONString!) {\n  createProviderCredentials(\n    orgId: $orgId\n    provider: $provider\n    name: $name\n    credentials: $credentials\n  ) {\n    credential {\n      id\n    }\n  }\n}": types.SaveNewProviderCredsDocument,
    "mutation ToggleSync($syncId: ID!) {\n  toggleSyncActive(syncId: $syncId) {\n    ok\n  }\n}": types.ToggleSyncDocument,
    "mutation TriggerEnvSync($syncId: ID!) {\n  triggerSync(syncId: $syncId) {\n    sync {\n      status\n    }\n  }\n}": types.TriggerEnvSyncDocument,
    "mutation UpdateProviderCreds($credentialId: ID!, $name: String!, $credentials: JSONString!) {\n  updateProviderCredentials(\n    credentialId: $credentialId\n    name: $name\n    credentials: $credentials\n  ) {\n    credential {\n      id\n    }\n  }\n}": types.UpdateProviderCredsDocument,
    "mutation UpdateSyncAuth($syncId: ID!, $credentialId: ID!) {\n  updateSyncAuthentication(syncId: $syncId, credentialId: $credentialId) {\n    sync {\n      id\n      status\n    }\n  }\n}": types.UpdateSyncAuthDocument,
    "mutation CreateNewVaultSync($envId: ID!, $path: String!, $engine: String!, $vaultPath: String!, $credentialId: ID!) {\n  createVaultSync(\n    envId: $envId\n    path: $path\n    engine: $engine\n    vaultPath: $vaultPath\n    credentialId: $credentialId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}": types.CreateNewVaultSyncDocument,
    "mutation CreateNewUserToken($orgId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!, $expiry: BigInt) {\n  createUserToken(\n    orgId: $orgId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n    expiry: $expiry\n  ) {\n    ok\n  }\n}": types.CreateNewUserTokenDocument,
    "mutation RevokeUserToken($tokenId: ID!) {\n  deleteUserToken(tokenId: $tokenId) {\n    ok\n  }\n}": types.RevokeUserTokenDocument,
    "query GetAppMembers($appId: ID!) {\n  appUsers(appId: $appId) {\n    id\n    identityKey\n    email\n    fullName\n    avatarUrl\n    createdAt\n    role {\n      id\n      name\n      description\n      permissions\n      color\n    }\n  }\n}": types.GetAppMembersDocument,
    "query GetAppServiceAccounts($appId: ID!) {\n  appServiceAccounts(appId: $appId) {\n    id\n    identityKey\n    name\n    createdAt\n    role {\n      id\n      name\n      description\n      permissions\n      color\n    }\n  }\n}": types.GetAppServiceAccountsDocument,
    "query GetCheckoutDetails($stripeSessionId: String!) {\n  stripeCheckoutDetails(stripeSessionId: $stripeSessionId) {\n    paymentStatus\n    customerEmail\n    billingStartDate\n    billingEndDate\n    subscriptionId\n    planName\n  }\n}": types.GetCheckoutDetailsDocument,
    "query GetAppActivityChart($appId: ID!, $period: TimeRange) {\n  appActivityChart(appId: $appId, period: $period) {\n    index\n    date\n    data\n  }\n}": types.GetAppActivityChartDocument,
    "query GetAppDetail($organisationId: ID!, $appId: ID!) {\n  apps(organisationId: $organisationId, appId: $appId) {\n    id\n    name\n    identityKey\n    createdAt\n    appToken\n    appSeed\n    appVersion\n    sseEnabled\n  }\n}": types.GetAppDetailDocument,
    "query GetAppKmsLogs($appId: ID!, $start: BigInt, $end: BigInt) {\n  logs(appId: $appId, start: $start, end: $end) {\n    kms {\n      id\n      timestamp\n      phaseNode\n      eventType\n      ipAddress\n      country\n      city\n      phSize\n    }\n  }\n  kmsLogsCount(appId: $appId)\n}": types.GetAppKmsLogsDocument,
    "query GetApps($organisationId: ID!, $appId: ID) {\n  apps(organisationId: $organisationId, appId: $appId) {\n    id\n    name\n    identityKey\n    createdAt\n    sseEnabled\n    members {\n      id\n      email\n      fullName\n      avatarUrl\n    }\n    serviceAccounts {\n      id\n      name\n    }\n    environments {\n      id\n      name\n      envType\n      syncs {\n        id\n        serviceInfo {\n          id\n          name\n          provider {\n            id\n            name\n          }\n        }\n        status\n      }\n    }\n  }\n}": types.GetAppsDocument,
    "query GetDashboard($organisationId: ID!) {\n  apps(organisationId: $organisationId) {\n    id\n    sseEnabled\n  }\n  userTokens(organisationId: $organisationId) {\n    id\n  }\n  organisationInvites(orgId: $organisationId) {\n    id\n  }\n  organisationMembers(organisationId: $organisationId, role: null) {\n    id\n  }\n  savedCredentials(orgId: $organisationId) {\n    id\n  }\n  syncs(orgId: $organisationId) {\n    id\n  }\n}": types.GetDashboardDocument,
    "query GetOrganisations {\n  organisations {\n    id\n    name\n    identityKey\n    createdAt\n    plan\n    planDetail {\n      name\n      maxUsers\n      maxApps\n      maxEnvsPerApp\n      userCount\n      serviceAccountCount\n      appCount\n    }\n    role {\n      name\n      description\n      color\n      permissions\n    }\n    memberId\n    keyring\n    recovery\n  }\n}": types.GetOrganisationsDocument,
    "query CheckOrganisationNameAvailability($name: String!) {\n  organisationNameAvailable(name: $name)\n}": types.CheckOrganisationNameAvailabilityDocument,
    "query GetGlobalAccessUsers($organisationId: ID!) {\n  organisationGlobalAccessUsers(organisationId: $organisationId) {\n    id\n    role {\n      name\n      permissions\n    }\n    identityKey\n    self\n  }\n}": types.GetGlobalAccessUsersDocument,
    "query GetInvites($orgId: ID!) {\n  organisationInvites(orgId: $orgId) {\n    id\n    createdAt\n    expiresAt\n    invitedBy {\n      email\n      fullName\n      self\n    }\n    inviteeEmail\n  }\n}": types.GetInvitesDocument,
    "query GetLicenseData {\n  license {\n    id\n    customerName\n    organisationName\n    expiresAt\n    plan\n    seats\n    isActivated\n    organisationOwner {\n      fullName\n      email\n    }\n  }\n}": types.GetLicenseDataDocument,
    "query GetOrgLicense($organisationId: ID!) {\n  organisationLicense(organisationId: $organisationId) {\n    id\n    customerName\n    issuedAt\n    expiresAt\n    activatedAt\n    plan\n    seats\n    tokens\n  }\n}": types.GetOrgLicenseDocument,
    "query GetOrganisationMembers($organisationId: ID!, $role: [String]) {\n  organisationMembers(organisationId: $organisationId, role: $role) {\n    id\n    role {\n      id\n      name\n      description\n      permissions\n      color\n    }\n    identityKey\n    email\n    fullName\n    avatarUrl\n    createdAt\n    self\n  }\n}": types.GetOrganisationMembersDocument,
    "query GetOrganisationPlan($organisationId: ID!) {\n  organisationPlan(organisationId: $organisationId) {\n    name\n    maxUsers\n    maxApps\n    maxEnvsPerApp\n    userCount\n    appCount\n  }\n}": types.GetOrganisationPlanDocument,
    "query GetRoles($orgId: ID!) {\n  roles(orgId: $orgId) {\n    id\n    name\n    description\n    color\n    permissions\n    isDefault\n  }\n}": types.GetRolesDocument,
    "query VerifyInvite($inviteId: ID!) {\n  validateInvite(inviteId: $inviteId) {\n    id\n    organisation {\n      id\n      name\n    }\n    inviteeEmail\n    invitedBy {\n      email\n    }\n    apps {\n      id\n      name\n    }\n  }\n}": types.VerifyInviteDocument,
    "query GetAppEnvironments($appId: ID!, $memberId: ID, $memberType: MemberType) {\n  appEnvironments(\n    appId: $appId\n    environmentId: null\n    memberId: $memberId\n    memberType: $memberType\n  ) {\n    id\n    name\n    envType\n    identityKey\n    wrappedSeed\n    wrappedSalt\n    createdAt\n    app {\n      name\n      id\n    }\n    secretCount\n    folderCount\n    index\n    members {\n      email\n      fullName\n      avatarUrl\n    }\n  }\n  sseEnabled(appId: $appId)\n  serverPublicKey\n}": types.GetAppEnvironmentsDocument,
    "query GetAppSecretsLogs($appId: ID!, $start: BigInt, $end: BigInt) {\n  logs(appId: $appId, start: $start, end: $end) {\n    secrets {\n      id\n      path\n      key\n      value\n      tags {\n        id\n        name\n        color\n      }\n      version\n      comment\n      timestamp\n      ipAddress\n      userAgent\n      user {\n        email\n        username\n        fullName\n        avatarUrl\n      }\n      serviceToken {\n        id\n        name\n      }\n      serviceAccount {\n        id\n        name\n      }\n      eventType\n      environment {\n        id\n        envType\n        name\n      }\n      secret {\n        id\n        path\n      }\n    }\n  }\n  secretsLogsCount(appId: $appId)\n  environmentKeys(appId: $appId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n    environment {\n      id\n    }\n  }\n}": types.GetAppSecretsLogsDocument,
    "query GetEnvironmentKey($envId: ID!, $appId: ID!) {\n  environmentKeys(environmentId: $envId, appId: $appId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}": types.GetEnvironmentKeyDocument,
    "query GetEnvironmentTokens($envId: ID!) {\n  environmentTokens(environmentId: $envId) {\n    id\n    name\n    wrappedKeyShare\n    createdAt\n  }\n}": types.GetEnvironmentTokensDocument,
    "query GetFolders($envId: ID!, $path: String) {\n  folders(envId: $envId, path: $path) {\n    id\n    name\n    path\n    createdAt\n    folderCount\n    secretCount\n  }\n}": types.GetFoldersDocument,
    "query GetEnvSecretsKV($envId: ID!) {\n  folders(envId: $envId, path: \"/\") {\n    id\n    name\n  }\n  secrets(envId: $envId, path: \"/\") {\n    id\n    key\n    value\n    path\n  }\n  environmentKeys(environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}": types.GetEnvSecretsKvDocument,
    "query GetSecretTags($orgId: ID!) {\n  secretTags(orgId: $orgId) {\n    id\n    name\n    color\n  }\n}": types.GetSecretTagsDocument,
    "query GetSecrets($appId: ID!, $envId: ID!, $path: String) {\n  secrets(envId: $envId, path: $path) {\n    id\n    key\n    value\n    path\n    tags {\n      id\n      name\n      color\n    }\n    comment\n    createdAt\n    updatedAt\n    history {\n      id\n      key\n      value\n      path\n      tags {\n        id\n        name\n        color\n      }\n      version\n      comment\n      timestamp\n      ipAddress\n      userAgent\n      user {\n        email\n        username\n        fullName\n        avatarUrl\n      }\n      serviceToken {\n        id\n        name\n      }\n      serviceAccount {\n        id\n        name\n      }\n      eventType\n    }\n    override {\n      value\n      isActive\n    }\n    environment {\n      id\n      app {\n        id\n      }\n    }\n  }\n  folders(envId: $envId, path: $path) {\n    id\n    name\n    path\n    createdAt\n    folderCount\n    secretCount\n  }\n  appEnvironments(appId: $appId, environmentId: $envId) {\n    id\n    name\n    envType\n    identityKey\n    app {\n      name\n    }\n  }\n  environmentKeys(appId: $appId, environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n  envSyncs(envId: $envId) {\n    id\n    environment {\n      id\n      name\n      envType\n    }\n    serviceInfo {\n      id\n      name\n    }\n    options\n    isActive\n    status\n    lastSync\n    createdAt\n  }\n}": types.GetSecretsDocument,
    "query GetServiceTokens($appId: ID!) {\n  serviceTokens(appId: $appId) {\n    id\n    name\n    createdAt\n    createdBy {\n      fullName\n      avatarUrl\n      self\n    }\n    expiresAt\n    keys {\n      id\n      identityKey\n    }\n  }\n}": types.GetServiceTokensDocument,
    "query GetServiceAccountHandlers($orgId: ID!) {\n  serviceAccountHandlers(orgId: $orgId) {\n    id\n    email\n    role {\n      name\n      permissions\n    }\n    identityKey\n    self\n  }\n}": types.GetServiceAccountHandlersDocument,
    "query GetServiceAccounts($orgId: ID!, $id: ID) {\n  serviceAccounts(orgId: $orgId, serviceAccountId: $id) {\n    id\n    name\n    identityKey\n    role {\n      id\n      name\n      description\n      permissions\n    }\n    createdAt\n    handlers {\n      id\n      wrappedKeyring\n      wrappedRecovery\n      user {\n        self\n      }\n    }\n    tokens {\n      id\n      name\n      createdAt\n      expiresAt\n      createdBy {\n        fullName\n        avatarUrl\n        self\n      }\n    }\n  }\n}": types.GetServiceAccountsDocument,
    "query GetOrganisationSyncs($orgId: ID!) {\n  syncs(orgId: $orgId) {\n    id\n    environment {\n      id\n      name\n      envType\n      app {\n        id\n        name\n      }\n    }\n    path\n    serviceInfo {\n      id\n      name\n      provider {\n        id\n      }\n    }\n    options\n    isActive\n    lastSync\n    status\n    authentication {\n      id\n      name\n      credentials\n    }\n    createdAt\n    history {\n      id\n      status\n      createdAt\n      completedAt\n      meta\n    }\n  }\n  savedCredentials(orgId: $orgId) {\n    id\n    name\n    credentials\n    createdAt\n    provider {\n      id\n      name\n      expectedCredentials\n      optionalCredentials\n    }\n    syncCount\n  }\n  apps(organisationId: $orgId, appId: null) {\n    id\n    name\n    identityKey\n    createdAt\n    sseEnabled\n    members {\n      id\n    }\n    environments {\n      id\n      name\n      syncs {\n        id\n        serviceInfo {\n          id\n          name\n          provider {\n            id\n            name\n          }\n        }\n        status\n      }\n    }\n  }\n}": types.GetOrganisationSyncsDocument,
    "query GetAwsSecrets($credentialId: ID!) {\n  awsSecrets(credentialId: $credentialId) {\n    name\n    arn\n  }\n}": types.GetAwsSecretsDocument,
    "query GetCfPages($credentialId: ID!) {\n  cloudflarePagesProjects(credentialId: $credentialId) {\n    name\n    deploymentId\n    environments\n  }\n}": types.GetCfPagesDocument,
    "query GetAppSyncStatus($appId: ID!) {\n  sseEnabled(appId: $appId)\n  syncs(appId: $appId) {\n    id\n    environment {\n      id\n      name\n      envType\n      app {\n        id\n        name\n      }\n    }\n    path\n    serviceInfo {\n      id\n      name\n      provider {\n        id\n      }\n    }\n    options\n    isActive\n    lastSync\n    status\n    authentication {\n      id\n      name\n      credentials\n    }\n    createdAt\n    history {\n      id\n      status\n      createdAt\n      completedAt\n      meta\n    }\n  }\n  serverPublicKey\n}": types.GetAppSyncStatusDocument,
    "query GetProviderList {\n  providers {\n    id\n    name\n    expectedCredentials\n    optionalCredentials\n    authScheme\n  }\n  serverPublicKey\n}": types.GetProviderListDocument,
    "query GetSavedCredentials($orgId: ID!) {\n  savedCredentials(orgId: $orgId) {\n    id\n    name\n    credentials\n    createdAt\n    provider {\n      id\n      name\n      expectedCredentials\n      optionalCredentials\n    }\n    syncCount\n  }\n}": types.GetSavedCredentialsDocument,
    "query GetServerKey {\n  serverPublicKey\n}": types.GetServerKeyDocument,
    "query GetServiceList {\n  services {\n    id\n    name\n    provider {\n      id\n    }\n  }\n}": types.GetServiceListDocument,
    "query GetGithubRepos($credentialId: ID!) {\n  githubRepos(credentialId: $credentialId) {\n    name\n    owner\n    type\n  }\n}": types.GetGithubReposDocument,
    "query GetGitLabResources($credentialId: ID!) {\n  gitlabProjects(credentialId: $credentialId) {\n    id\n    name\n    namespace {\n      name\n      fullPath\n    }\n    pathWithNamespace\n    webUrl\n  }\n  gitlabGroups(credentialId: $credentialId) {\n    id\n    fullName\n    fullPath\n    webUrl\n  }\n}": types.GetGitLabResourcesDocument,
    "query TestNomadAuth($credentialId: ID!) {\n  testNomadCreds(credentialId: $credentialId)\n}": types.TestNomadAuthDocument,
    "query GetRailwayProjects($credentialId: ID!) {\n  railwayProjects(credentialId: $credentialId) {\n    id\n    name\n    environments {\n      id\n      name\n    }\n    services {\n      id\n      name\n    }\n  }\n}": types.GetRailwayProjectsDocument,
    "query TestVaultAuth($credentialId: ID!) {\n  testVaultCreds(credentialId: $credentialId)\n}": types.TestVaultAuthDocument,
    "query GetUserTokens($organisationId: ID!) {\n  userTokens(organisationId: $organisationId) {\n    id\n    name\n    wrappedKeyShare\n    createdAt\n    expiresAt\n  }\n}": types.GetUserTokensDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateRole($name: String!, $description: String!, $color: String!, $permissions: JSONString!, $organisationId: ID!) {\n  createCustomRole(\n    name: $name\n    description: $description\n    color: $color\n    permissions: $permissions\n    organisationId: $organisationId\n  ) {\n    role {\n      id\n    }\n  }\n}"): (typeof documents)["mutation CreateRole($name: String!, $description: String!, $color: String!, $permissions: JSONString!, $organisationId: ID!) {\n  createCustomRole(\n    name: $name\n    description: $description\n    color: $color\n    permissions: $permissions\n    organisationId: $organisationId\n  ) {\n    role {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteRole($id: ID!) {\n  deleteCustomRole(id: $id) {\n    ok\n  }\n}"): (typeof documents)["mutation DeleteRole($id: ID!) {\n  deleteCustomRole(id: $id) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateRole($id: ID!, $name: String!, $description: String!, $color: String!, $permissions: JSONString!) {\n  updateCustomRole(\n    id: $id\n    name: $name\n    description: $description\n    color: $color\n    permissions: $permissions\n  ) {\n    role {\n      id\n    }\n  }\n}"): (typeof documents)["mutation UpdateRole($id: ID!, $name: String!, $description: String!, $color: String!, $permissions: JSONString!) {\n  updateCustomRole(\n    id: $id\n    name: $name\n    description: $description\n    color: $color\n    permissions: $permissions\n  ) {\n    role {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AddMemberToApp($memberId: ID!, $memberType: MemberType, $appId: ID!, $envKeys: [EnvironmentKeyInput]) {\n  addAppMember(\n    memberId: $memberId\n    memberType: $memberType\n    appId: $appId\n    envKeys: $envKeys\n  ) {\n    app {\n      id\n    }\n  }\n}"): (typeof documents)["mutation AddMemberToApp($memberId: ID!, $memberType: MemberType, $appId: ID!, $envKeys: [EnvironmentKeyInput]) {\n  addAppMember(\n    memberId: $memberId\n    memberType: $memberType\n    appId: $appId\n    envKeys: $envKeys\n  ) {\n    app {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RemoveMemberFromApp($memberId: ID!, $memberType: MemberType, $appId: ID!) {\n  removeAppMember(memberId: $memberId, memberType: $memberType, appId: $appId) {\n    app {\n      id\n    }\n  }\n}"): (typeof documents)["mutation RemoveMemberFromApp($memberId: ID!, $memberType: MemberType, $appId: ID!) {\n  removeAppMember(memberId: $memberId, memberType: $memberType, appId: $appId) {\n    app {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateEnvScope($memberId: ID!, $memberType: MemberType, $appId: ID!, $envKeys: [EnvironmentKeyInput]) {\n  updateMemberEnvironmentScope(\n    memberId: $memberId\n    memberType: $memberType\n    appId: $appId\n    envKeys: $envKeys\n  ) {\n    app {\n      id\n    }\n  }\n}"): (typeof documents)["mutation UpdateEnvScope($memberId: ID!, $memberType: MemberType, $appId: ID!, $envKeys: [EnvironmentKeyInput]) {\n  updateMemberEnvironmentScope(\n    memberId: $memberId\n    memberType: $memberType\n    appId: $appId\n    envKeys: $envKeys\n  ) {\n    app {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation InitStripeProUpgradeCheckout($organisationId: ID!, $billingPeriod: String!) {\n  createProUpgradeCheckoutSession(\n    organisationId: $organisationId\n    billingPeriod: $billingPeriod\n  ) {\n    clientSecret\n  }\n}"): (typeof documents)["mutation InitStripeProUpgradeCheckout($organisationId: ID!, $billingPeriod: String!) {\n  createProUpgradeCheckoutSession(\n    organisationId: $organisationId\n    billingPeriod: $billingPeriod\n  ) {\n    clientSecret\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateApplication($id: ID!, $organisationId: ID!, $name: String!, $identityKey: String!, $appToken: String!, $appSeed: String!, $wrappedKeyShare: String!, $appVersion: Int!) {\n  createApp(\n    id: $id\n    organisationId: $organisationId\n    name: $name\n    identityKey: $identityKey\n    appToken: $appToken\n    appSeed: $appSeed\n    wrappedKeyShare: $wrappedKeyShare\n    appVersion: $appVersion\n  ) {\n    app {\n      id\n      name\n      identityKey\n    }\n  }\n}"): (typeof documents)["mutation CreateApplication($id: ID!, $organisationId: ID!, $name: String!, $identityKey: String!, $appToken: String!, $appSeed: String!, $wrappedKeyShare: String!, $appVersion: Int!) {\n  createApp(\n    id: $id\n    organisationId: $organisationId\n    name: $name\n    identityKey: $identityKey\n    appToken: $appToken\n    appSeed: $appSeed\n    wrappedKeyShare: $wrappedKeyShare\n    appVersion: $appVersion\n  ) {\n    app {\n      id\n      name\n      identityKey\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateOrg($id: ID!, $name: String!, $identityKey: String!, $wrappedKeyring: String!, $wrappedRecovery: String!) {\n  createOrganisation(\n    id: $id\n    name: $name\n    identityKey: $identityKey\n    wrappedKeyring: $wrappedKeyring\n    wrappedRecovery: $wrappedRecovery\n  ) {\n    organisation {\n      id\n      name\n      memberId\n    }\n  }\n}"): (typeof documents)["mutation CreateOrg($id: ID!, $name: String!, $identityKey: String!, $wrappedKeyring: String!, $wrappedRecovery: String!) {\n  createOrganisation(\n    id: $id\n    name: $name\n    identityKey: $identityKey\n    wrappedKeyring: $wrappedKeyring\n    wrappedRecovery: $wrappedRecovery\n  ) {\n    organisation {\n      id\n      name\n      memberId\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteApplication($id: ID!) {\n  deleteApp(id: $id) {\n    ok\n  }\n}"): (typeof documents)["mutation DeleteApplication($id: ID!) {\n  deleteApp(id: $id) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation BulkProcessSecrets($secretsToCreate: [SecretInput!]!, $secretsToUpdate: [SecretInput!]!, $secretsToDelete: [ID!]!) {\n  createSecrets(secretsData: $secretsToCreate) {\n    secrets {\n      id\n    }\n  }\n  editSecrets(secretsData: $secretsToUpdate) {\n    secrets {\n      id\n    }\n  }\n  deleteSecrets(ids: $secretsToDelete) {\n    secrets {\n      id\n    }\n  }\n}"): (typeof documents)["mutation BulkProcessSecrets($secretsToCreate: [SecretInput!]!, $secretsToUpdate: [SecretInput!]!, $secretsToDelete: [ID!]!) {\n  createSecrets(secretsData: $secretsToCreate) {\n    secrets {\n      id\n    }\n  }\n  editSecrets(secretsData: $secretsToUpdate) {\n    secrets {\n      id\n    }\n  }\n  deleteSecrets(ids: $secretsToDelete) {\n    secrets {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateEnv($envInput: EnvironmentInput!, $adminKeys: [EnvironmentKeyInput], $wrappedSeed: String, $wrappedSalt: String) {\n  createEnvironment(\n    environmentData: $envInput\n    adminKeys: $adminKeys\n    wrappedSeed: $wrappedSeed\n    wrappedSalt: $wrappedSalt\n  ) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n}"): (typeof documents)["mutation CreateEnv($envInput: EnvironmentInput!, $adminKeys: [EnvironmentKeyInput], $wrappedSeed: String, $wrappedSalt: String) {\n  createEnvironment(\n    environmentData: $envInput\n    adminKeys: $adminKeys\n    wrappedSeed: $wrappedSeed\n    wrappedSalt: $wrappedSalt\n  ) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateEnvKey($envId: ID!, $userId: ID, $wrappedSeed: String!, $wrappedSalt: String!, $identityKey: String!) {\n  createEnvironmentKey(\n    envId: $envId\n    userId: $userId\n    wrappedSeed: $wrappedSeed\n    wrappedSalt: $wrappedSalt\n    identityKey: $identityKey\n  ) {\n    environmentKey {\n      id\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateEnvKey($envId: ID!, $userId: ID, $wrappedSeed: String!, $wrappedSalt: String!, $identityKey: String!) {\n  createEnvironmentKey(\n    envId: $envId\n    userId: $userId\n    wrappedSeed: $wrappedSeed\n    wrappedSalt: $wrappedSalt\n    identityKey: $identityKey\n  ) {\n    environmentKey {\n      id\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateEnvToken($envId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!) {\n  createEnvironmentToken(\n    envId: $envId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n  ) {\n    environmentToken {\n      id\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateEnvToken($envId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!) {\n  createEnvironmentToken(\n    envId: $envId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n  ) {\n    environmentToken {\n      id\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewSecretFolder($envId: ID!, $name: String!, $path: String!) {\n  createSecretFolder(envId: $envId, name: $name, path: $path) {\n    folder {\n      id\n      name\n      path\n    }\n  }\n}"): (typeof documents)["mutation CreateNewSecretFolder($envId: ID!, $name: String!, $path: String!) {\n  createSecretFolder(envId: $envId, name: $name, path: $path) {\n    folder {\n      id\n      name\n      path\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewPersonalSecret($newPersonalSecret: PersonalSecretInput!) {\n  createOverride(overrideData: $newPersonalSecret) {\n    override {\n      id\n      secret {\n        id\n      }\n      value\n      isActive\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateNewPersonalSecret($newPersonalSecret: PersonalSecretInput!) {\n  createOverride(overrideData: $newPersonalSecret) {\n    override {\n      id\n      secret {\n        id\n      }\n      value\n      isActive\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewSecret($newSecret: SecretInput!) {\n  createSecret(secretData: $newSecret) {\n    secret {\n      id\n      key\n      value\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateNewSecret($newSecret: SecretInput!) {\n  createSecret(secretData: $newSecret) {\n    secret {\n      id\n      key\n      value\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewSecretTag($orgId: ID!, $name: String!, $color: String!) {\n  createSecretTag(orgId: $orgId, name: $name, color: $color) {\n    tag {\n      id\n    }\n  }\n}"): (typeof documents)["mutation CreateNewSecretTag($orgId: ID!, $name: String!, $color: String!) {\n  createSecretTag(orgId: $orgId, name: $name, color: $color) {\n    tag {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewServiceToken($appId: ID!, $environmentKeys: [EnvironmentKeyInput], $identityKey: String!, $token: String!, $wrappedKeyShare: String!, $name: String!, $expiry: BigInt) {\n  createServiceToken(\n    appId: $appId\n    environmentKeys: $environmentKeys\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n    name: $name\n    expiry: $expiry\n  ) {\n    serviceToken {\n      id\n      createdAt\n      expiresAt\n    }\n  }\n}"): (typeof documents)["mutation CreateNewServiceToken($appId: ID!, $environmentKeys: [EnvironmentKeyInput], $identityKey: String!, $token: String!, $wrappedKeyShare: String!, $name: String!, $expiry: BigInt) {\n  createServiceToken(\n    appId: $appId\n    environmentKeys: $environmentKeys\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n    name: $name\n    expiry: $expiry\n  ) {\n    serviceToken {\n      id\n      createdAt\n      expiresAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteEnv($environmentId: ID!) {\n  deleteEnvironment(environmentId: $environmentId) {\n    ok\n  }\n}"): (typeof documents)["mutation DeleteEnv($environmentId: ID!) {\n  deleteEnvironment(environmentId: $environmentId) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteFolder($folderId: ID!) {\n  deleteSecretFolder(folderId: $folderId) {\n    ok\n  }\n}"): (typeof documents)["mutation DeleteFolder($folderId: ID!) {\n  deleteSecretFolder(folderId: $folderId) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteSecretOp($id: ID!) {\n  deleteSecret(id: $id) {\n    secret {\n      id\n    }\n  }\n}"): (typeof documents)["mutation DeleteSecretOp($id: ID!) {\n  deleteSecret(id: $id) {\n    secret {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RevokeServiceToken($tokenId: ID!) {\n  deleteServiceToken(tokenId: $tokenId) {\n    ok\n  }\n}"): (typeof documents)["mutation RevokeServiceToken($tokenId: ID!) {\n  deleteServiceToken(tokenId: $tokenId) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateSecret($id: ID!, $secretData: SecretInput!) {\n  editSecret(id: $id, secretData: $secretData) {\n    secret {\n      id\n      updatedAt\n    }\n  }\n}"): (typeof documents)["mutation UpdateSecret($id: ID!, $secretData: SecretInput!) {\n  editSecret(id: $id, secretData: $secretData) {\n    secret {\n      id\n      updatedAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation InitAppEnvironments($devEnv: EnvironmentInput!, $stagingEnv: EnvironmentInput!, $prodEnv: EnvironmentInput!, $devAdminKeys: [EnvironmentKeyInput], $stagAdminKeys: [EnvironmentKeyInput], $prodAdminKeys: [EnvironmentKeyInput]) {\n  devEnvironment: createEnvironment(\n    environmentData: $devEnv\n    adminKeys: $devAdminKeys\n  ) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n  stagingEnvironment: createEnvironment(\n    environmentData: $stagingEnv\n    adminKeys: $stagAdminKeys\n  ) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n  prodEnvironment: createEnvironment(\n    environmentData: $prodEnv\n    adminKeys: $prodAdminKeys\n  ) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n}"): (typeof documents)["mutation InitAppEnvironments($devEnv: EnvironmentInput!, $stagingEnv: EnvironmentInput!, $prodEnv: EnvironmentInput!, $devAdminKeys: [EnvironmentKeyInput], $stagAdminKeys: [EnvironmentKeyInput], $prodAdminKeys: [EnvironmentKeyInput]) {\n  devEnvironment: createEnvironment(\n    environmentData: $devEnv\n    adminKeys: $devAdminKeys\n  ) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n  stagingEnvironment: createEnvironment(\n    environmentData: $stagingEnv\n    adminKeys: $stagAdminKeys\n  ) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n  prodEnvironment: createEnvironment(\n    environmentData: $prodEnv\n    adminKeys: $prodAdminKeys\n  ) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation LogSecretReads($ids: [ID]!) {\n  readSecret(ids: $ids) {\n    ok\n  }\n}"): (typeof documents)["mutation LogSecretReads($ids: [ID]!) {\n  readSecret(ids: $ids) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RemovePersonalSecret($secretId: ID!) {\n  removeOverride(secretId: $secretId) {\n    ok\n  }\n}"): (typeof documents)["mutation RemovePersonalSecret($secretId: ID!) {\n  removeOverride(secretId: $secretId) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RenameEnv($environmentId: ID!, $name: String!) {\n  renameEnvironment(environmentId: $environmentId, name: $name) {\n    environment {\n      id\n      name\n      updatedAt\n    }\n  }\n}"): (typeof documents)["mutation RenameEnv($environmentId: ID!, $name: String!) {\n  renameEnvironment(environmentId: $environmentId, name: $name) {\n    environment {\n      id\n      name\n      updatedAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateSharedSecret($input: LockboxInput!) {\n  createLockbox(input: $input) {\n    lockbox {\n      id\n      allowedViews\n      expiresAt\n    }\n  }\n}"): (typeof documents)["mutation CreateSharedSecret($input: LockboxInput!) {\n  createLockbox(input: $input) {\n    lockbox {\n      id\n      allowedViews\n      expiresAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation SwapEnvOrder($environment1Id: ID!, $environment2Id: ID!) {\n  swapEnvironmentOrder(\n    environment1Id: $environment1Id\n    environment2Id: $environment2Id\n  ) {\n    ok\n  }\n}"): (typeof documents)["mutation SwapEnvOrder($environment1Id: ID!, $environment2Id: ID!) {\n  swapEnvironmentOrder(\n    environment1Id: $environment1Id\n    environment2Id: $environment2Id\n  ) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation AcceptOrganisationInvite($orgId: ID!, $identityKey: String!, $wrappedKeyring: String!, $wrappedRecovery: String!, $inviteId: ID!) {\n  createOrganisationMember(\n    orgId: $orgId\n    identityKey: $identityKey\n    wrappedKeyring: $wrappedKeyring\n    wrappedRecovery: $wrappedRecovery\n    inviteId: $inviteId\n  ) {\n    orgMember {\n      id\n      email\n      createdAt\n      role {\n        name\n      }\n    }\n  }\n}"): (typeof documents)["mutation AcceptOrganisationInvite($orgId: ID!, $identityKey: String!, $wrappedKeyring: String!, $wrappedRecovery: String!, $inviteId: ID!) {\n  createOrganisationMember(\n    orgId: $orgId\n    identityKey: $identityKey\n    wrappedKeyring: $wrappedKeyring\n    wrappedRecovery: $wrappedRecovery\n    inviteId: $inviteId\n  ) {\n    orgMember {\n      id\n      email\n      createdAt\n      role {\n        name\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteOrgInvite($inviteId: ID!) {\n  deleteInvitation(inviteId: $inviteId) {\n    ok\n  }\n}"): (typeof documents)["mutation DeleteOrgInvite($inviteId: ID!) {\n  deleteInvitation(inviteId: $inviteId) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RemoveMember($memberId: ID!) {\n  deleteOrganisationMember(memberId: $memberId) {\n    ok\n  }\n}"): (typeof documents)["mutation RemoveMember($memberId: ID!) {\n  deleteOrganisationMember(memberId: $memberId) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation InviteMember($orgId: ID!, $email: String!, $apps: [String]) {\n  inviteOrganisationMember(orgId: $orgId, email: $email, apps: $apps) {\n    invite {\n      id\n    }\n  }\n}"): (typeof documents)["mutation InviteMember($orgId: ID!, $email: String!, $apps: [String]) {\n  inviteOrganisationMember(orgId: $orgId, email: $email, apps: $apps) {\n    invite {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateMemberRole($memberId: ID!, $roleId: ID!) {\n  updateOrganisationMemberRole(memberId: $memberId, roleId: $roleId) {\n    orgMember {\n      id\n      role {\n        name\n      }\n    }\n  }\n}"): (typeof documents)["mutation UpdateMemberRole($memberId: ID!, $roleId: ID!) {\n  updateOrganisationMemberRole(memberId: $memberId, roleId: $roleId) {\n    orgMember {\n      id\n      role {\n        name\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateWrappedSecrets($orgId: ID!, $wrappedKeyring: String!, $wrappedRecovery: String!) {\n  updateMemberWrappedSecrets(\n    orgId: $orgId\n    wrappedKeyring: $wrappedKeyring\n    wrappedRecovery: $wrappedRecovery\n  ) {\n    orgMember {\n      id\n    }\n  }\n}"): (typeof documents)["mutation UpdateWrappedSecrets($orgId: ID!, $wrappedKeyring: String!, $wrappedRecovery: String!) {\n  updateMemberWrappedSecrets(\n    orgId: $orgId\n    wrappedKeyring: $wrappedKeyring\n    wrappedRecovery: $wrappedRecovery\n  ) {\n    orgMember {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RotateAppKey($id: ID!, $appToken: String!, $wrappedKeyShare: String!) {\n  rotateAppKeys(id: $id, appToken: $appToken, wrappedKeyShare: $wrappedKeyShare) {\n    app {\n      id\n    }\n  }\n}"): (typeof documents)["mutation RotateAppKey($id: ID!, $appToken: String!, $wrappedKeyShare: String!) {\n  rotateAppKeys(id: $id, appToken: $appToken, wrappedKeyShare: $wrappedKeyShare) {\n    app {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateServiceAccountOp($name: String!, $orgId: ID!, $roleId: ID!, $identityKey: String!, $handlers: [ServiceAccountHandlerInput], $serverWrappedKeyring: String, $serverWrappedRecovery: String) {\n  createServiceAccount(\n    name: $name\n    organisationId: $orgId\n    roleId: $roleId\n    identityKey: $identityKey\n    handlers: $handlers\n    serverWrappedKeyring: $serverWrappedKeyring\n    serverWrappedRecovery: $serverWrappedRecovery\n  ) {\n    serviceAccount {\n      id\n    }\n  }\n}"): (typeof documents)["mutation CreateServiceAccountOp($name: String!, $orgId: ID!, $roleId: ID!, $identityKey: String!, $handlers: [ServiceAccountHandlerInput], $serverWrappedKeyring: String, $serverWrappedRecovery: String) {\n  createServiceAccount(\n    name: $name\n    organisationId: $orgId\n    roleId: $roleId\n    identityKey: $identityKey\n    handlers: $handlers\n    serverWrappedKeyring: $serverWrappedKeyring\n    serverWrappedRecovery: $serverWrappedRecovery\n  ) {\n    serviceAccount {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateSAToken($serviceAccountId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!, $expiry: BigInt) {\n  createServiceAccountToken(\n    serviceAccountId: $serviceAccountId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n    expiry: $expiry\n  ) {\n    token {\n      id\n    }\n  }\n}"): (typeof documents)["mutation CreateSAToken($serviceAccountId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!, $expiry: BigInt) {\n  createServiceAccountToken(\n    serviceAccountId: $serviceAccountId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n    expiry: $expiry\n  ) {\n    token {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteServiceAccountOp($id: ID!) {\n  deleteServiceAccount(serviceAccountId: $id) {\n    ok\n  }\n}"): (typeof documents)["mutation DeleteServiceAccountOp($id: ID!) {\n  deleteServiceAccount(serviceAccountId: $id) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteServiceAccountTokenOp($id: ID!) {\n  deleteServiceAccountToken(tokenId: $id) {\n    ok\n  }\n}"): (typeof documents)["mutation DeleteServiceAccountTokenOp($id: ID!) {\n  deleteServiceAccountToken(tokenId: $id) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateServiceAccountHandlerKeys($orgId: ID!, $handlers: [ServiceAccountHandlerInput]) {\n  updateServiceAccountHandlers(organisationId: $orgId, handlers: $handlers) {\n    ok\n  }\n}"): (typeof documents)["mutation UpdateServiceAccountHandlerKeys($orgId: ID!, $handlers: [ServiceAccountHandlerInput]) {\n  updateServiceAccountHandlers(organisationId: $orgId, handlers: $handlers) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateServiceAccountOp($serviceAccountId: ID!, $name: String!, $roleId: ID!) {\n  updateServiceAccount(\n    serviceAccountId: $serviceAccountId\n    name: $name\n    roleId: $roleId\n  ) {\n    serviceAccount {\n      id\n    }\n  }\n}"): (typeof documents)["mutation UpdateServiceAccountOp($serviceAccountId: ID!, $name: String!, $roleId: ID!) {\n  updateServiceAccount(\n    serviceAccountId: $serviceAccountId\n    name: $name\n    roleId: $roleId\n  ) {\n    serviceAccount {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewAWSSecretsSync($envId: ID!, $path: String!, $credentialId: ID!, $secretName: String!, $kmsId: String) {\n  createAwsSecretSync(\n    envId: $envId\n    path: $path\n    credentialId: $credentialId\n    secretName: $secretName\n    kmsId: $kmsId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateNewAWSSecretsSync($envId: ID!, $path: String!, $credentialId: ID!, $secretName: String!, $kmsId: String) {\n  createAwsSecretSync(\n    envId: $envId\n    path: $path\n    credentialId: $credentialId\n    secretName: $secretName\n    kmsId: $kmsId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewCfPagesSync($envId: ID!, $path: String!, $projectName: String!, $deploymentId: ID!, $projectEnv: String!, $credentialId: ID!) {\n  createCloudflarePagesSync(\n    envId: $envId\n    path: $path\n    projectName: $projectName\n    deploymentId: $deploymentId\n    projectEnv: $projectEnv\n    credentialId: $credentialId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateNewCfPagesSync($envId: ID!, $path: String!, $projectName: String!, $deploymentId: ID!, $projectEnv: String!, $credentialId: ID!) {\n  createCloudflarePagesSync(\n    envId: $envId\n    path: $path\n    projectName: $projectName\n    deploymentId: $deploymentId\n    projectEnv: $projectEnv\n    credentialId: $credentialId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteProviderCreds($credentialId: ID!) {\n  deleteProviderCredentials(credentialId: $credentialId) {\n    ok\n  }\n}"): (typeof documents)["mutation DeleteProviderCreds($credentialId: ID!) {\n  deleteProviderCredentials(credentialId: $credentialId) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteSync($syncId: ID!) {\n  deleteEnvSync(syncId: $syncId) {\n    ok\n  }\n}"): (typeof documents)["mutation DeleteSync($syncId: ID!) {\n  deleteEnvSync(syncId: $syncId) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewGhActionsSync($envId: ID!, $path: String!, $repoName: String!, $owner: String!, $credentialId: ID!) {\n  createGhActionsSync(\n    envId: $envId\n    path: $path\n    repoName: $repoName\n    owner: $owner\n    credentialId: $credentialId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateNewGhActionsSync($envId: ID!, $path: String!, $repoName: String!, $owner: String!, $credentialId: ID!) {\n  createGhActionsSync(\n    envId: $envId\n    path: $path\n    repoName: $repoName\n    owner: $owner\n    credentialId: $credentialId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewGitlabCiSync($envId: ID!, $path: String!, $credentialId: ID!, $resourcePath: String!, $resourceId: String!, $isGroup: Boolean!, $isMasked: Boolean!, $isProtected: Boolean!) {\n  createGitlabCiSync(\n    envId: $envId\n    path: $path\n    credentialId: $credentialId\n    resourcePath: $resourcePath\n    resourceId: $resourceId\n    isGroup: $isGroup\n    masked: $isMasked\n    protected: $isProtected\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateNewGitlabCiSync($envId: ID!, $path: String!, $credentialId: ID!, $resourcePath: String!, $resourceId: String!, $isGroup: Boolean!, $isMasked: Boolean!, $isProtected: Boolean!) {\n  createGitlabCiSync(\n    envId: $envId\n    path: $path\n    credentialId: $credentialId\n    resourcePath: $resourcePath\n    resourceId: $resourceId\n    isGroup: $isGroup\n    masked: $isMasked\n    protected: $isProtected\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation InitAppSyncing($appId: ID!, $envKeys: [EnvironmentKeyInput]) {\n  initEnvSync(appId: $appId, envKeys: $envKeys) {\n    app {\n      id\n      sseEnabled\n    }\n  }\n}"): (typeof documents)["mutation InitAppSyncing($appId: ID!, $envKeys: [EnvironmentKeyInput]) {\n  initEnvSync(appId: $appId, envKeys: $envKeys) {\n    app {\n      id\n      sseEnabled\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewNomadSync($envId: ID!, $path: String!, $nomadPath: String!, $nomadNamespace: String!, $credentialId: ID!) {\n  createNomadSync(\n    envId: $envId\n    path: $path\n    nomadPath: $nomadPath\n    nomadNamespace: $nomadNamespace\n    credentialId: $credentialId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateNewNomadSync($envId: ID!, $path: String!, $nomadPath: String!, $nomadNamespace: String!, $credentialId: ID!) {\n  createNomadSync(\n    envId: $envId\n    path: $path\n    nomadPath: $nomadPath\n    nomadNamespace: $nomadNamespace\n    credentialId: $credentialId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewRailwaySync($envId: ID!, $path: String!, $credentialId: ID!, $railwayProject: RailwayResourceInput!, $railwayEnvironment: RailwayResourceInput!, $railwayService: RailwayResourceInput) {\n  createRailwaySync(\n    envId: $envId\n    path: $path\n    credentialId: $credentialId\n    railwayProject: $railwayProject\n    railwayEnvironment: $railwayEnvironment\n    railwayService: $railwayService\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateNewRailwaySync($envId: ID!, $path: String!, $credentialId: ID!, $railwayProject: RailwayResourceInput!, $railwayEnvironment: RailwayResourceInput!, $railwayService: RailwayResourceInput) {\n  createRailwaySync(\n    envId: $envId\n    path: $path\n    credentialId: $credentialId\n    railwayProject: $railwayProject\n    railwayEnvironment: $railwayEnvironment\n    railwayService: $railwayService\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation SaveNewProviderCreds($orgId: ID!, $provider: String!, $name: String!, $credentials: JSONString!) {\n  createProviderCredentials(\n    orgId: $orgId\n    provider: $provider\n    name: $name\n    credentials: $credentials\n  ) {\n    credential {\n      id\n    }\n  }\n}"): (typeof documents)["mutation SaveNewProviderCreds($orgId: ID!, $provider: String!, $name: String!, $credentials: JSONString!) {\n  createProviderCredentials(\n    orgId: $orgId\n    provider: $provider\n    name: $name\n    credentials: $credentials\n  ) {\n    credential {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ToggleSync($syncId: ID!) {\n  toggleSyncActive(syncId: $syncId) {\n    ok\n  }\n}"): (typeof documents)["mutation ToggleSync($syncId: ID!) {\n  toggleSyncActive(syncId: $syncId) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation TriggerEnvSync($syncId: ID!) {\n  triggerSync(syncId: $syncId) {\n    sync {\n      status\n    }\n  }\n}"): (typeof documents)["mutation TriggerEnvSync($syncId: ID!) {\n  triggerSync(syncId: $syncId) {\n    sync {\n      status\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateProviderCreds($credentialId: ID!, $name: String!, $credentials: JSONString!) {\n  updateProviderCredentials(\n    credentialId: $credentialId\n    name: $name\n    credentials: $credentials\n  ) {\n    credential {\n      id\n    }\n  }\n}"): (typeof documents)["mutation UpdateProviderCreds($credentialId: ID!, $name: String!, $credentials: JSONString!) {\n  updateProviderCredentials(\n    credentialId: $credentialId\n    name: $name\n    credentials: $credentials\n  ) {\n    credential {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateSyncAuth($syncId: ID!, $credentialId: ID!) {\n  updateSyncAuthentication(syncId: $syncId, credentialId: $credentialId) {\n    sync {\n      id\n      status\n    }\n  }\n}"): (typeof documents)["mutation UpdateSyncAuth($syncId: ID!, $credentialId: ID!) {\n  updateSyncAuthentication(syncId: $syncId, credentialId: $credentialId) {\n    sync {\n      id\n      status\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewVaultSync($envId: ID!, $path: String!, $engine: String!, $vaultPath: String!, $credentialId: ID!) {\n  createVaultSync(\n    envId: $envId\n    path: $path\n    engine: $engine\n    vaultPath: $vaultPath\n    credentialId: $credentialId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateNewVaultSync($envId: ID!, $path: String!, $engine: String!, $vaultPath: String!, $credentialId: ID!) {\n  createVaultSync(\n    envId: $envId\n    path: $path\n    engine: $engine\n    vaultPath: $vaultPath\n    credentialId: $credentialId\n  ) {\n    sync {\n      id\n      environment {\n        id\n        name\n        envType\n      }\n      serviceInfo {\n        id\n        name\n      }\n      isActive\n      lastSync\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewUserToken($orgId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!, $expiry: BigInt) {\n  createUserToken(\n    orgId: $orgId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n    expiry: $expiry\n  ) {\n    ok\n  }\n}"): (typeof documents)["mutation CreateNewUserToken($orgId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!, $expiry: BigInt) {\n  createUserToken(\n    orgId: $orgId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n    expiry: $expiry\n  ) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RevokeUserToken($tokenId: ID!) {\n  deleteUserToken(tokenId: $tokenId) {\n    ok\n  }\n}"): (typeof documents)["mutation RevokeUserToken($tokenId: ID!) {\n  deleteUserToken(tokenId: $tokenId) {\n    ok\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppMembers($appId: ID!) {\n  appUsers(appId: $appId) {\n    id\n    identityKey\n    email\n    fullName\n    avatarUrl\n    createdAt\n    role {\n      id\n      name\n      description\n      permissions\n      color\n    }\n  }\n}"): (typeof documents)["query GetAppMembers($appId: ID!) {\n  appUsers(appId: $appId) {\n    id\n    identityKey\n    email\n    fullName\n    avatarUrl\n    createdAt\n    role {\n      id\n      name\n      description\n      permissions\n      color\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppServiceAccounts($appId: ID!) {\n  appServiceAccounts(appId: $appId) {\n    id\n    identityKey\n    name\n    createdAt\n    role {\n      id\n      name\n      description\n      permissions\n      color\n    }\n  }\n}"): (typeof documents)["query GetAppServiceAccounts($appId: ID!) {\n  appServiceAccounts(appId: $appId) {\n    id\n    identityKey\n    name\n    createdAt\n    role {\n      id\n      name\n      description\n      permissions\n      color\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetCheckoutDetails($stripeSessionId: String!) {\n  stripeCheckoutDetails(stripeSessionId: $stripeSessionId) {\n    paymentStatus\n    customerEmail\n    billingStartDate\n    billingEndDate\n    subscriptionId\n    planName\n  }\n}"): (typeof documents)["query GetCheckoutDetails($stripeSessionId: String!) {\n  stripeCheckoutDetails(stripeSessionId: $stripeSessionId) {\n    paymentStatus\n    customerEmail\n    billingStartDate\n    billingEndDate\n    subscriptionId\n    planName\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppActivityChart($appId: ID!, $period: TimeRange) {\n  appActivityChart(appId: $appId, period: $period) {\n    index\n    date\n    data\n  }\n}"): (typeof documents)["query GetAppActivityChart($appId: ID!, $period: TimeRange) {\n  appActivityChart(appId: $appId, period: $period) {\n    index\n    date\n    data\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppDetail($organisationId: ID!, $appId: ID!) {\n  apps(organisationId: $organisationId, appId: $appId) {\n    id\n    name\n    identityKey\n    createdAt\n    appToken\n    appSeed\n    appVersion\n    sseEnabled\n  }\n}"): (typeof documents)["query GetAppDetail($organisationId: ID!, $appId: ID!) {\n  apps(organisationId: $organisationId, appId: $appId) {\n    id\n    name\n    identityKey\n    createdAt\n    appToken\n    appSeed\n    appVersion\n    sseEnabled\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppKmsLogs($appId: ID!, $start: BigInt, $end: BigInt) {\n  logs(appId: $appId, start: $start, end: $end) {\n    kms {\n      id\n      timestamp\n      phaseNode\n      eventType\n      ipAddress\n      country\n      city\n      phSize\n    }\n  }\n  kmsLogsCount(appId: $appId)\n}"): (typeof documents)["query GetAppKmsLogs($appId: ID!, $start: BigInt, $end: BigInt) {\n  logs(appId: $appId, start: $start, end: $end) {\n    kms {\n      id\n      timestamp\n      phaseNode\n      eventType\n      ipAddress\n      country\n      city\n      phSize\n    }\n  }\n  kmsLogsCount(appId: $appId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetApps($organisationId: ID!, $appId: ID) {\n  apps(organisationId: $organisationId, appId: $appId) {\n    id\n    name\n    identityKey\n    createdAt\n    sseEnabled\n    members {\n      id\n      email\n      fullName\n      avatarUrl\n    }\n    serviceAccounts {\n      id\n      name\n    }\n    environments {\n      id\n      name\n      envType\n      syncs {\n        id\n        serviceInfo {\n          id\n          name\n          provider {\n            id\n            name\n          }\n        }\n        status\n      }\n    }\n  }\n}"): (typeof documents)["query GetApps($organisationId: ID!, $appId: ID) {\n  apps(organisationId: $organisationId, appId: $appId) {\n    id\n    name\n    identityKey\n    createdAt\n    sseEnabled\n    members {\n      id\n      email\n      fullName\n      avatarUrl\n    }\n    serviceAccounts {\n      id\n      name\n    }\n    environments {\n      id\n      name\n      envType\n      syncs {\n        id\n        serviceInfo {\n          id\n          name\n          provider {\n            id\n            name\n          }\n        }\n        status\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetDashboard($organisationId: ID!) {\n  apps(organisationId: $organisationId) {\n    id\n    sseEnabled\n  }\n  userTokens(organisationId: $organisationId) {\n    id\n  }\n  organisationInvites(orgId: $organisationId) {\n    id\n  }\n  organisationMembers(organisationId: $organisationId, role: null) {\n    id\n  }\n  savedCredentials(orgId: $organisationId) {\n    id\n  }\n  syncs(orgId: $organisationId) {\n    id\n  }\n}"): (typeof documents)["query GetDashboard($organisationId: ID!) {\n  apps(organisationId: $organisationId) {\n    id\n    sseEnabled\n  }\n  userTokens(organisationId: $organisationId) {\n    id\n  }\n  organisationInvites(orgId: $organisationId) {\n    id\n  }\n  organisationMembers(organisationId: $organisationId, role: null) {\n    id\n  }\n  savedCredentials(orgId: $organisationId) {\n    id\n  }\n  syncs(orgId: $organisationId) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetOrganisations {\n  organisations {\n    id\n    name\n    identityKey\n    createdAt\n    plan\n    planDetail {\n      name\n      maxUsers\n      maxApps\n      maxEnvsPerApp\n      userCount\n      serviceAccountCount\n      appCount\n    }\n    role {\n      name\n      description\n      color\n      permissions\n    }\n    memberId\n    keyring\n    recovery\n  }\n}"): (typeof documents)["query GetOrganisations {\n  organisations {\n    id\n    name\n    identityKey\n    createdAt\n    plan\n    planDetail {\n      name\n      maxUsers\n      maxApps\n      maxEnvsPerApp\n      userCount\n      serviceAccountCount\n      appCount\n    }\n    role {\n      name\n      description\n      color\n      permissions\n    }\n    memberId\n    keyring\n    recovery\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query CheckOrganisationNameAvailability($name: String!) {\n  organisationNameAvailable(name: $name)\n}"): (typeof documents)["query CheckOrganisationNameAvailability($name: String!) {\n  organisationNameAvailable(name: $name)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetGlobalAccessUsers($organisationId: ID!) {\n  organisationGlobalAccessUsers(organisationId: $organisationId) {\n    id\n    role {\n      name\n      permissions\n    }\n    identityKey\n    self\n  }\n}"): (typeof documents)["query GetGlobalAccessUsers($organisationId: ID!) {\n  organisationGlobalAccessUsers(organisationId: $organisationId) {\n    id\n    role {\n      name\n      permissions\n    }\n    identityKey\n    self\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetInvites($orgId: ID!) {\n  organisationInvites(orgId: $orgId) {\n    id\n    createdAt\n    expiresAt\n    invitedBy {\n      email\n      fullName\n      self\n    }\n    inviteeEmail\n  }\n}"): (typeof documents)["query GetInvites($orgId: ID!) {\n  organisationInvites(orgId: $orgId) {\n    id\n    createdAt\n    expiresAt\n    invitedBy {\n      email\n      fullName\n      self\n    }\n    inviteeEmail\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetLicenseData {\n  license {\n    id\n    customerName\n    organisationName\n    expiresAt\n    plan\n    seats\n    isActivated\n    organisationOwner {\n      fullName\n      email\n    }\n  }\n}"): (typeof documents)["query GetLicenseData {\n  license {\n    id\n    customerName\n    organisationName\n    expiresAt\n    plan\n    seats\n    isActivated\n    organisationOwner {\n      fullName\n      email\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetOrgLicense($organisationId: ID!) {\n  organisationLicense(organisationId: $organisationId) {\n    id\n    customerName\n    issuedAt\n    expiresAt\n    activatedAt\n    plan\n    seats\n    tokens\n  }\n}"): (typeof documents)["query GetOrgLicense($organisationId: ID!) {\n  organisationLicense(organisationId: $organisationId) {\n    id\n    customerName\n    issuedAt\n    expiresAt\n    activatedAt\n    plan\n    seats\n    tokens\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetOrganisationMembers($organisationId: ID!, $role: [String]) {\n  organisationMembers(organisationId: $organisationId, role: $role) {\n    id\n    role {\n      id\n      name\n      description\n      permissions\n      color\n    }\n    identityKey\n    email\n    fullName\n    avatarUrl\n    createdAt\n    self\n  }\n}"): (typeof documents)["query GetOrganisationMembers($organisationId: ID!, $role: [String]) {\n  organisationMembers(organisationId: $organisationId, role: $role) {\n    id\n    role {\n      id\n      name\n      description\n      permissions\n      color\n    }\n    identityKey\n    email\n    fullName\n    avatarUrl\n    createdAt\n    self\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetOrganisationPlan($organisationId: ID!) {\n  organisationPlan(organisationId: $organisationId) {\n    name\n    maxUsers\n    maxApps\n    maxEnvsPerApp\n    userCount\n    appCount\n  }\n}"): (typeof documents)["query GetOrganisationPlan($organisationId: ID!) {\n  organisationPlan(organisationId: $organisationId) {\n    name\n    maxUsers\n    maxApps\n    maxEnvsPerApp\n    userCount\n    appCount\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetRoles($orgId: ID!) {\n  roles(orgId: $orgId) {\n    id\n    name\n    description\n    color\n    permissions\n    isDefault\n  }\n}"): (typeof documents)["query GetRoles($orgId: ID!) {\n  roles(orgId: $orgId) {\n    id\n    name\n    description\n    color\n    permissions\n    isDefault\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query VerifyInvite($inviteId: ID!) {\n  validateInvite(inviteId: $inviteId) {\n    id\n    organisation {\n      id\n      name\n    }\n    inviteeEmail\n    invitedBy {\n      email\n    }\n    apps {\n      id\n      name\n    }\n  }\n}"): (typeof documents)["query VerifyInvite($inviteId: ID!) {\n  validateInvite(inviteId: $inviteId) {\n    id\n    organisation {\n      id\n      name\n    }\n    inviteeEmail\n    invitedBy {\n      email\n    }\n    apps {\n      id\n      name\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppEnvironments($appId: ID!, $memberId: ID, $memberType: MemberType) {\n  appEnvironments(\n    appId: $appId\n    environmentId: null\n    memberId: $memberId\n    memberType: $memberType\n  ) {\n    id\n    name\n    envType\n    identityKey\n    wrappedSeed\n    wrappedSalt\n    createdAt\n    app {\n      name\n      id\n    }\n    secretCount\n    folderCount\n    index\n    members {\n      email\n      fullName\n      avatarUrl\n    }\n  }\n  sseEnabled(appId: $appId)\n  serverPublicKey\n}"): (typeof documents)["query GetAppEnvironments($appId: ID!, $memberId: ID, $memberType: MemberType) {\n  appEnvironments(\n    appId: $appId\n    environmentId: null\n    memberId: $memberId\n    memberType: $memberType\n  ) {\n    id\n    name\n    envType\n    identityKey\n    wrappedSeed\n    wrappedSalt\n    createdAt\n    app {\n      name\n      id\n    }\n    secretCount\n    folderCount\n    index\n    members {\n      email\n      fullName\n      avatarUrl\n    }\n  }\n  sseEnabled(appId: $appId)\n  serverPublicKey\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppSecretsLogs($appId: ID!, $start: BigInt, $end: BigInt) {\n  logs(appId: $appId, start: $start, end: $end) {\n    secrets {\n      id\n      path\n      key\n      value\n      tags {\n        id\n        name\n        color\n      }\n      version\n      comment\n      timestamp\n      ipAddress\n      userAgent\n      user {\n        email\n        username\n        fullName\n        avatarUrl\n      }\n      serviceToken {\n        id\n        name\n      }\n      serviceAccount {\n        id\n        name\n      }\n      eventType\n      environment {\n        id\n        envType\n        name\n      }\n      secret {\n        id\n        path\n      }\n    }\n  }\n  secretsLogsCount(appId: $appId)\n  environmentKeys(appId: $appId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n    environment {\n      id\n    }\n  }\n}"): (typeof documents)["query GetAppSecretsLogs($appId: ID!, $start: BigInt, $end: BigInt) {\n  logs(appId: $appId, start: $start, end: $end) {\n    secrets {\n      id\n      path\n      key\n      value\n      tags {\n        id\n        name\n        color\n      }\n      version\n      comment\n      timestamp\n      ipAddress\n      userAgent\n      user {\n        email\n        username\n        fullName\n        avatarUrl\n      }\n      serviceToken {\n        id\n        name\n      }\n      serviceAccount {\n        id\n        name\n      }\n      eventType\n      environment {\n        id\n        envType\n        name\n      }\n      secret {\n        id\n        path\n      }\n    }\n  }\n  secretsLogsCount(appId: $appId)\n  environmentKeys(appId: $appId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n    environment {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetEnvironmentKey($envId: ID!, $appId: ID!) {\n  environmentKeys(environmentId: $envId, appId: $appId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}"): (typeof documents)["query GetEnvironmentKey($envId: ID!, $appId: ID!) {\n  environmentKeys(environmentId: $envId, appId: $appId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetEnvironmentTokens($envId: ID!) {\n  environmentTokens(environmentId: $envId) {\n    id\n    name\n    wrappedKeyShare\n    createdAt\n  }\n}"): (typeof documents)["query GetEnvironmentTokens($envId: ID!) {\n  environmentTokens(environmentId: $envId) {\n    id\n    name\n    wrappedKeyShare\n    createdAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetFolders($envId: ID!, $path: String) {\n  folders(envId: $envId, path: $path) {\n    id\n    name\n    path\n    createdAt\n    folderCount\n    secretCount\n  }\n}"): (typeof documents)["query GetFolders($envId: ID!, $path: String) {\n  folders(envId: $envId, path: $path) {\n    id\n    name\n    path\n    createdAt\n    folderCount\n    secretCount\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetEnvSecretsKV($envId: ID!) {\n  folders(envId: $envId, path: \"/\") {\n    id\n    name\n  }\n  secrets(envId: $envId, path: \"/\") {\n    id\n    key\n    value\n    path\n  }\n  environmentKeys(environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}"): (typeof documents)["query GetEnvSecretsKV($envId: ID!) {\n  folders(envId: $envId, path: \"/\") {\n    id\n    name\n  }\n  secrets(envId: $envId, path: \"/\") {\n    id\n    key\n    value\n    path\n  }\n  environmentKeys(environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetSecretTags($orgId: ID!) {\n  secretTags(orgId: $orgId) {\n    id\n    name\n    color\n  }\n}"): (typeof documents)["query GetSecretTags($orgId: ID!) {\n  secretTags(orgId: $orgId) {\n    id\n    name\n    color\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetSecrets($appId: ID!, $envId: ID!, $path: String) {\n  secrets(envId: $envId, path: $path) {\n    id\n    key\n    value\n    path\n    tags {\n      id\n      name\n      color\n    }\n    comment\n    createdAt\n    updatedAt\n    history {\n      id\n      key\n      value\n      path\n      tags {\n        id\n        name\n        color\n      }\n      version\n      comment\n      timestamp\n      ipAddress\n      userAgent\n      user {\n        email\n        username\n        fullName\n        avatarUrl\n      }\n      serviceToken {\n        id\n        name\n      }\n      serviceAccount {\n        id\n        name\n      }\n      eventType\n    }\n    override {\n      value\n      isActive\n    }\n    environment {\n      id\n      app {\n        id\n      }\n    }\n  }\n  folders(envId: $envId, path: $path) {\n    id\n    name\n    path\n    createdAt\n    folderCount\n    secretCount\n  }\n  appEnvironments(appId: $appId, environmentId: $envId) {\n    id\n    name\n    envType\n    identityKey\n    app {\n      name\n    }\n  }\n  environmentKeys(appId: $appId, environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n  envSyncs(envId: $envId) {\n    id\n    environment {\n      id\n      name\n      envType\n    }\n    serviceInfo {\n      id\n      name\n    }\n    options\n    isActive\n    status\n    lastSync\n    createdAt\n  }\n}"): (typeof documents)["query GetSecrets($appId: ID!, $envId: ID!, $path: String) {\n  secrets(envId: $envId, path: $path) {\n    id\n    key\n    value\n    path\n    tags {\n      id\n      name\n      color\n    }\n    comment\n    createdAt\n    updatedAt\n    history {\n      id\n      key\n      value\n      path\n      tags {\n        id\n        name\n        color\n      }\n      version\n      comment\n      timestamp\n      ipAddress\n      userAgent\n      user {\n        email\n        username\n        fullName\n        avatarUrl\n      }\n      serviceToken {\n        id\n        name\n      }\n      serviceAccount {\n        id\n        name\n      }\n      eventType\n    }\n    override {\n      value\n      isActive\n    }\n    environment {\n      id\n      app {\n        id\n      }\n    }\n  }\n  folders(envId: $envId, path: $path) {\n    id\n    name\n    path\n    createdAt\n    folderCount\n    secretCount\n  }\n  appEnvironments(appId: $appId, environmentId: $envId) {\n    id\n    name\n    envType\n    identityKey\n    app {\n      name\n    }\n  }\n  environmentKeys(appId: $appId, environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n  envSyncs(envId: $envId) {\n    id\n    environment {\n      id\n      name\n      envType\n    }\n    serviceInfo {\n      id\n      name\n    }\n    options\n    isActive\n    status\n    lastSync\n    createdAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetServiceTokens($appId: ID!) {\n  serviceTokens(appId: $appId) {\n    id\n    name\n    createdAt\n    createdBy {\n      fullName\n      avatarUrl\n      self\n    }\n    expiresAt\n    keys {\n      id\n      identityKey\n    }\n  }\n}"): (typeof documents)["query GetServiceTokens($appId: ID!) {\n  serviceTokens(appId: $appId) {\n    id\n    name\n    createdAt\n    createdBy {\n      fullName\n      avatarUrl\n      self\n    }\n    expiresAt\n    keys {\n      id\n      identityKey\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetServiceAccountHandlers($orgId: ID!) {\n  serviceAccountHandlers(orgId: $orgId) {\n    id\n    email\n    role {\n      name\n      permissions\n    }\n    identityKey\n    self\n  }\n}"): (typeof documents)["query GetServiceAccountHandlers($orgId: ID!) {\n  serviceAccountHandlers(orgId: $orgId) {\n    id\n    email\n    role {\n      name\n      permissions\n    }\n    identityKey\n    self\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetServiceAccounts($orgId: ID!, $id: ID) {\n  serviceAccounts(orgId: $orgId, serviceAccountId: $id) {\n    id\n    name\n    identityKey\n    role {\n      id\n      name\n      description\n      permissions\n    }\n    createdAt\n    handlers {\n      id\n      wrappedKeyring\n      wrappedRecovery\n      user {\n        self\n      }\n    }\n    tokens {\n      id\n      name\n      createdAt\n      expiresAt\n      createdBy {\n        fullName\n        avatarUrl\n        self\n      }\n    }\n  }\n}"): (typeof documents)["query GetServiceAccounts($orgId: ID!, $id: ID) {\n  serviceAccounts(orgId: $orgId, serviceAccountId: $id) {\n    id\n    name\n    identityKey\n    role {\n      id\n      name\n      description\n      permissions\n    }\n    createdAt\n    handlers {\n      id\n      wrappedKeyring\n      wrappedRecovery\n      user {\n        self\n      }\n    }\n    tokens {\n      id\n      name\n      createdAt\n      expiresAt\n      createdBy {\n        fullName\n        avatarUrl\n        self\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetOrganisationSyncs($orgId: ID!) {\n  syncs(orgId: $orgId) {\n    id\n    environment {\n      id\n      name\n      envType\n      app {\n        id\n        name\n      }\n    }\n    path\n    serviceInfo {\n      id\n      name\n      provider {\n        id\n      }\n    }\n    options\n    isActive\n    lastSync\n    status\n    authentication {\n      id\n      name\n      credentials\n    }\n    createdAt\n    history {\n      id\n      status\n      createdAt\n      completedAt\n      meta\n    }\n  }\n  savedCredentials(orgId: $orgId) {\n    id\n    name\n    credentials\n    createdAt\n    provider {\n      id\n      name\n      expectedCredentials\n      optionalCredentials\n    }\n    syncCount\n  }\n  apps(organisationId: $orgId, appId: null) {\n    id\n    name\n    identityKey\n    createdAt\n    sseEnabled\n    members {\n      id\n    }\n    environments {\n      id\n      name\n      syncs {\n        id\n        serviceInfo {\n          id\n          name\n          provider {\n            id\n            name\n          }\n        }\n        status\n      }\n    }\n  }\n}"): (typeof documents)["query GetOrganisationSyncs($orgId: ID!) {\n  syncs(orgId: $orgId) {\n    id\n    environment {\n      id\n      name\n      envType\n      app {\n        id\n        name\n      }\n    }\n    path\n    serviceInfo {\n      id\n      name\n      provider {\n        id\n      }\n    }\n    options\n    isActive\n    lastSync\n    status\n    authentication {\n      id\n      name\n      credentials\n    }\n    createdAt\n    history {\n      id\n      status\n      createdAt\n      completedAt\n      meta\n    }\n  }\n  savedCredentials(orgId: $orgId) {\n    id\n    name\n    credentials\n    createdAt\n    provider {\n      id\n      name\n      expectedCredentials\n      optionalCredentials\n    }\n    syncCount\n  }\n  apps(organisationId: $orgId, appId: null) {\n    id\n    name\n    identityKey\n    createdAt\n    sseEnabled\n    members {\n      id\n    }\n    environments {\n      id\n      name\n      syncs {\n        id\n        serviceInfo {\n          id\n          name\n          provider {\n            id\n            name\n          }\n        }\n        status\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAwsSecrets($credentialId: ID!) {\n  awsSecrets(credentialId: $credentialId) {\n    name\n    arn\n  }\n}"): (typeof documents)["query GetAwsSecrets($credentialId: ID!) {\n  awsSecrets(credentialId: $credentialId) {\n    name\n    arn\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetCfPages($credentialId: ID!) {\n  cloudflarePagesProjects(credentialId: $credentialId) {\n    name\n    deploymentId\n    environments\n  }\n}"): (typeof documents)["query GetCfPages($credentialId: ID!) {\n  cloudflarePagesProjects(credentialId: $credentialId) {\n    name\n    deploymentId\n    environments\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppSyncStatus($appId: ID!) {\n  sseEnabled(appId: $appId)\n  syncs(appId: $appId) {\n    id\n    environment {\n      id\n      name\n      envType\n      app {\n        id\n        name\n      }\n    }\n    path\n    serviceInfo {\n      id\n      name\n      provider {\n        id\n      }\n    }\n    options\n    isActive\n    lastSync\n    status\n    authentication {\n      id\n      name\n      credentials\n    }\n    createdAt\n    history {\n      id\n      status\n      createdAt\n      completedAt\n      meta\n    }\n  }\n  serverPublicKey\n}"): (typeof documents)["query GetAppSyncStatus($appId: ID!) {\n  sseEnabled(appId: $appId)\n  syncs(appId: $appId) {\n    id\n    environment {\n      id\n      name\n      envType\n      app {\n        id\n        name\n      }\n    }\n    path\n    serviceInfo {\n      id\n      name\n      provider {\n        id\n      }\n    }\n    options\n    isActive\n    lastSync\n    status\n    authentication {\n      id\n      name\n      credentials\n    }\n    createdAt\n    history {\n      id\n      status\n      createdAt\n      completedAt\n      meta\n    }\n  }\n  serverPublicKey\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetProviderList {\n  providers {\n    id\n    name\n    expectedCredentials\n    optionalCredentials\n    authScheme\n  }\n  serverPublicKey\n}"): (typeof documents)["query GetProviderList {\n  providers {\n    id\n    name\n    expectedCredentials\n    optionalCredentials\n    authScheme\n  }\n  serverPublicKey\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetSavedCredentials($orgId: ID!) {\n  savedCredentials(orgId: $orgId) {\n    id\n    name\n    credentials\n    createdAt\n    provider {\n      id\n      name\n      expectedCredentials\n      optionalCredentials\n    }\n    syncCount\n  }\n}"): (typeof documents)["query GetSavedCredentials($orgId: ID!) {\n  savedCredentials(orgId: $orgId) {\n    id\n    name\n    credentials\n    createdAt\n    provider {\n      id\n      name\n      expectedCredentials\n      optionalCredentials\n    }\n    syncCount\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetServerKey {\n  serverPublicKey\n}"): (typeof documents)["query GetServerKey {\n  serverPublicKey\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetServiceList {\n  services {\n    id\n    name\n    provider {\n      id\n    }\n  }\n}"): (typeof documents)["query GetServiceList {\n  services {\n    id\n    name\n    provider {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetGithubRepos($credentialId: ID!) {\n  githubRepos(credentialId: $credentialId) {\n    name\n    owner\n    type\n  }\n}"): (typeof documents)["query GetGithubRepos($credentialId: ID!) {\n  githubRepos(credentialId: $credentialId) {\n    name\n    owner\n    type\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetGitLabResources($credentialId: ID!) {\n  gitlabProjects(credentialId: $credentialId) {\n    id\n    name\n    namespace {\n      name\n      fullPath\n    }\n    pathWithNamespace\n    webUrl\n  }\n  gitlabGroups(credentialId: $credentialId) {\n    id\n    fullName\n    fullPath\n    webUrl\n  }\n}"): (typeof documents)["query GetGitLabResources($credentialId: ID!) {\n  gitlabProjects(credentialId: $credentialId) {\n    id\n    name\n    namespace {\n      name\n      fullPath\n    }\n    pathWithNamespace\n    webUrl\n  }\n  gitlabGroups(credentialId: $credentialId) {\n    id\n    fullName\n    fullPath\n    webUrl\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query TestNomadAuth($credentialId: ID!) {\n  testNomadCreds(credentialId: $credentialId)\n}"): (typeof documents)["query TestNomadAuth($credentialId: ID!) {\n  testNomadCreds(credentialId: $credentialId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetRailwayProjects($credentialId: ID!) {\n  railwayProjects(credentialId: $credentialId) {\n    id\n    name\n    environments {\n      id\n      name\n    }\n    services {\n      id\n      name\n    }\n  }\n}"): (typeof documents)["query GetRailwayProjects($credentialId: ID!) {\n  railwayProjects(credentialId: $credentialId) {\n    id\n    name\n    environments {\n      id\n      name\n    }\n    services {\n      id\n      name\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query TestVaultAuth($credentialId: ID!) {\n  testVaultCreds(credentialId: $credentialId)\n}"): (typeof documents)["query TestVaultAuth($credentialId: ID!) {\n  testVaultCreds(credentialId: $credentialId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetUserTokens($organisationId: ID!) {\n  userTokens(organisationId: $organisationId) {\n    id\n    name\n    wrappedKeyShare\n    createdAt\n    expiresAt\n  }\n}"): (typeof documents)["query GetUserTokens($organisationId: ID!) {\n  userTokens(organisationId: $organisationId) {\n    id\n    name\n    wrappedKeyShare\n    createdAt\n    expiresAt\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;