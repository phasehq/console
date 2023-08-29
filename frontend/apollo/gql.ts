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
    "mutation CreateApplication($id: ID!, $organisationId: ID!, $name: String!, $identityKey: String!, $appToken: String!, $appSeed: String!, $wrappedKeyShare: String!, $appVersion: Int!) {\n  createApp(\n    id: $id\n    organisationId: $organisationId\n    name: $name\n    identityKey: $identityKey\n    appToken: $appToken\n    appSeed: $appSeed\n    wrappedKeyShare: $wrappedKeyShare\n    appVersion: $appVersion\n  ) {\n    app {\n      id\n      name\n      identityKey\n    }\n  }\n}": types.CreateApplicationDocument,
    "mutation CreateOrg($id: ID!, $name: String!, $identityKey: String!) {\n  createOrganisation(id: $id, name: $name, identityKey: $identityKey) {\n    organisation {\n      id\n      name\n      createdAt\n    }\n  }\n}": types.CreateOrgDocument,
    "mutation DeleteApplication($id: ID!) {\n  deleteApp(id: $id) {\n    app {\n      id\n    }\n  }\n}": types.DeleteApplicationDocument,
    "mutation CreateEnv($input: EnvironmentInput!) {\n  createEnvironment(environmentData: $input) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n}": types.CreateEnvDocument,
    "mutation CreateEnvKey($envId: ID!, $ownerId: ID!, $wrappedSeed: String!, $wrappedSalt: String!, $identityKey: String!) {\n  createEnvironmentKey(\n    envId: $envId\n    userId: $ownerId\n    wrappedSeed: $wrappedSeed\n    wrappedSalt: $wrappedSalt\n    identityKey: $identityKey\n  ) {\n    environmentKey {\n      id\n      createdAt\n    }\n  }\n}": types.CreateEnvKeyDocument,
    "mutation CreateEnvToken($envId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!) {\n  createEnvironmentToken(\n    envId: $envId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n  ) {\n    environmentToken {\n      id\n      createdAt\n    }\n  }\n}": types.CreateEnvTokenDocument,
    "mutation CreateNewSecret($newSecret: SecretInput!) {\n  createSecret(secretData: $newSecret) {\n    secret {\n      id\n      key\n      value\n      createdAt\n    }\n  }\n}": types.CreateNewSecretDocument,
    "mutation CreateNewSecretTag($orgId: ID!, $name: String!, $color: String!) {\n  createSecretTag(orgId: $orgId, name: $name, color: $color) {\n    tag {\n      id\n    }\n  }\n}": types.CreateNewSecretTagDocument,
    "mutation DeleteSecretOp($id: ID!) {\n  deleteSecret(id: $id) {\n    secret {\n      id\n    }\n  }\n}": types.DeleteSecretOpDocument,
    "mutation UpdateSecret($id: ID!, $secretData: SecretInput!) {\n  editSecret(id: $id, secretData: $secretData) {\n    secret {\n      id\n      updatedAt\n    }\n  }\n}": types.UpdateSecretDocument,
    "mutation InitAppEnvironments($devEnv: EnvironmentInput!, $stagingEnv: EnvironmentInput!, $prodEnv: EnvironmentInput!) {\n  devEnvironment: createEnvironment(environmentData: $devEnv) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n  stagingEnvironment: createEnvironment(environmentData: $stagingEnv) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n  prodEnvironment: createEnvironment(environmentData: $prodEnv) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n}": types.InitAppEnvironmentsDocument,
    "mutation RotateAppKey($id: ID!, $appToken: String!, $wrappedKeyShare: String!) {\n  rotateAppKeys(id: $id, appToken: $appToken, wrappedKeyShare: $wrappedKeyShare) {\n    app {\n      id\n    }\n  }\n}": types.RotateAppKeyDocument,
    "mutation CreateNewUserToken($orgId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!) {\n  createUserToken(\n    orgId: $orgId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n  ) {\n    userToken {\n      id\n      createdAt\n    }\n  }\n}": types.CreateNewUserTokenDocument,
    "query GetAppActivityChart($appId: ID!, $period: TimeRange) {\n  appActivityChart(appId: $appId, period: $period) {\n    index\n    date\n    data\n  }\n}": types.GetAppActivityChartDocument,
    "query GetAppDetail($organisationId: ID!, $appId: ID!) {\n  apps(organisationId: $organisationId, appId: $appId) {\n    id\n    name\n    identityKey\n    createdAt\n    appToken\n    appSeed\n    appVersion\n  }\n}": types.GetAppDetailDocument,
    "query GetAppLogCount($appId: ID!, $thisMonth: Boolean) {\n  logsCount(appId: $appId, thisMonth: $thisMonth)\n}": types.GetAppLogCountDocument,
    "query GetAppLogs($appId: ID!, $start: BigInt, $end: BigInt) {\n  logs(appId: $appId, start: $start, end: $end) {\n    id\n    timestamp\n    phaseNode\n    eventType\n    ipAddress\n    country\n    city\n    phSize\n  }\n  logsCount(appId: $appId)\n}": types.GetAppLogsDocument,
    "query GetApps($organisationId: ID!, $appId: ID!) {\n  apps(organisationId: $organisationId, appId: $appId) {\n    id\n    name\n    identityKey\n    createdAt\n  }\n}": types.GetAppsDocument,
    "query GetOrganisations {\n  organisations {\n    id\n    name\n    identityKey\n    createdAt\n    plan\n  }\n}": types.GetOrganisationsDocument,
    "query GetOrganisationAdminsAndSelf($organisationId: ID!) {\n  organisationAdminsAndSelf(organisationId: $organisationId) {\n    id\n    role\n    identityKey\n  }\n}": types.GetOrganisationAdminsAndSelfDocument,
    "query GetOrganisationMembers($organisationId: ID!, $role: [String]) {\n  organisationMembers(organisationId: $organisationId, role: $role) {\n    role\n    identityKey\n  }\n}": types.GetOrganisationMembersDocument,
    "query GetAppEnvironments($appId: ID!) {\n  appEnvironments(appId: $appId, environmentId: null) {\n    id\n    name\n    envType\n    identityKey\n    wrappedSeed\n    wrappedSalt\n    createdAt\n  }\n}": types.GetAppEnvironmentsDocument,
    "query GetEnvironmentKey($envId: ID!) {\n  environmentKeys(environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}": types.GetEnvironmentKeyDocument,
    "query GetEnvironmentTokens($envId: ID!) {\n  environmentTokens(environmentId: $envId) {\n    id\n    name\n    wrappedKeyShare\n    createdAt\n  }\n}": types.GetEnvironmentTokensDocument,
    "query GetSecretNames($envId: ID!) {\n  secrets(envId: $envId) {\n    id\n    key\n  }\n  environmentKeys(environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}": types.GetSecretNamesDocument,
    "query GetSecretTags($orgId: ID!) {\n  secretTags(orgId: $orgId) {\n    id\n    name\n    color\n  }\n}": types.GetSecretTagsDocument,
    "query GetSecrets($appId: ID!, $envId: ID!) {\n  secrets(envId: $envId) {\n    id\n    key\n    value\n    tags {\n      name\n      color\n    }\n    comment\n    createdAt\n    history {\n      id\n      key\n      value\n      tags {\n        name\n        color\n      }\n      version\n      comment\n      timestamp\n      eventType\n    }\n  }\n  appEnvironments(appId: $appId, environmentId: $envId) {\n    id\n    name\n    envType\n    identityKey\n  }\n  environmentKeys(environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}": types.GetSecretsDocument,
    "query GetUserTokens($organisationId: ID!) {\n  userTokens(organisationId: $organisationId) {\n    id\n    name\n    wrappedKeyShare\n    createdAt\n  }\n}": types.GetUserTokensDocument,
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
export function graphql(source: "mutation CreateApplication($id: ID!, $organisationId: ID!, $name: String!, $identityKey: String!, $appToken: String!, $appSeed: String!, $wrappedKeyShare: String!, $appVersion: Int!) {\n  createApp(\n    id: $id\n    organisationId: $organisationId\n    name: $name\n    identityKey: $identityKey\n    appToken: $appToken\n    appSeed: $appSeed\n    wrappedKeyShare: $wrappedKeyShare\n    appVersion: $appVersion\n  ) {\n    app {\n      id\n      name\n      identityKey\n    }\n  }\n}"): (typeof documents)["mutation CreateApplication($id: ID!, $organisationId: ID!, $name: String!, $identityKey: String!, $appToken: String!, $appSeed: String!, $wrappedKeyShare: String!, $appVersion: Int!) {\n  createApp(\n    id: $id\n    organisationId: $organisationId\n    name: $name\n    identityKey: $identityKey\n    appToken: $appToken\n    appSeed: $appSeed\n    wrappedKeyShare: $wrappedKeyShare\n    appVersion: $appVersion\n  ) {\n    app {\n      id\n      name\n      identityKey\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateOrg($id: ID!, $name: String!, $identityKey: String!) {\n  createOrganisation(id: $id, name: $name, identityKey: $identityKey) {\n    organisation {\n      id\n      name\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateOrg($id: ID!, $name: String!, $identityKey: String!) {\n  createOrganisation(id: $id, name: $name, identityKey: $identityKey) {\n    organisation {\n      id\n      name\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteApplication($id: ID!) {\n  deleteApp(id: $id) {\n    app {\n      id\n    }\n  }\n}"): (typeof documents)["mutation DeleteApplication($id: ID!) {\n  deleteApp(id: $id) {\n    app {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateEnv($input: EnvironmentInput!) {\n  createEnvironment(environmentData: $input) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n}"): (typeof documents)["mutation CreateEnv($input: EnvironmentInput!) {\n  createEnvironment(environmentData: $input) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateEnvKey($envId: ID!, $ownerId: ID!, $wrappedSeed: String!, $wrappedSalt: String!, $identityKey: String!) {\n  createEnvironmentKey(\n    envId: $envId\n    userId: $ownerId\n    wrappedSeed: $wrappedSeed\n    wrappedSalt: $wrappedSalt\n    identityKey: $identityKey\n  ) {\n    environmentKey {\n      id\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateEnvKey($envId: ID!, $ownerId: ID!, $wrappedSeed: String!, $wrappedSalt: String!, $identityKey: String!) {\n  createEnvironmentKey(\n    envId: $envId\n    userId: $ownerId\n    wrappedSeed: $wrappedSeed\n    wrappedSalt: $wrappedSalt\n    identityKey: $identityKey\n  ) {\n    environmentKey {\n      id\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateEnvToken($envId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!) {\n  createEnvironmentToken(\n    envId: $envId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n  ) {\n    environmentToken {\n      id\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateEnvToken($envId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!) {\n  createEnvironmentToken(\n    envId: $envId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n  ) {\n    environmentToken {\n      id\n      createdAt\n    }\n  }\n}"];
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
export function graphql(source: "mutation DeleteSecretOp($id: ID!) {\n  deleteSecret(id: $id) {\n    secret {\n      id\n    }\n  }\n}"): (typeof documents)["mutation DeleteSecretOp($id: ID!) {\n  deleteSecret(id: $id) {\n    secret {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateSecret($id: ID!, $secretData: SecretInput!) {\n  editSecret(id: $id, secretData: $secretData) {\n    secret {\n      id\n      updatedAt\n    }\n  }\n}"): (typeof documents)["mutation UpdateSecret($id: ID!, $secretData: SecretInput!) {\n  editSecret(id: $id, secretData: $secretData) {\n    secret {\n      id\n      updatedAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation InitAppEnvironments($devEnv: EnvironmentInput!, $stagingEnv: EnvironmentInput!, $prodEnv: EnvironmentInput!) {\n  devEnvironment: createEnvironment(environmentData: $devEnv) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n  stagingEnvironment: createEnvironment(environmentData: $stagingEnv) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n  prodEnvironment: createEnvironment(environmentData: $prodEnv) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n}"): (typeof documents)["mutation InitAppEnvironments($devEnv: EnvironmentInput!, $stagingEnv: EnvironmentInput!, $prodEnv: EnvironmentInput!) {\n  devEnvironment: createEnvironment(environmentData: $devEnv) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n  stagingEnvironment: createEnvironment(environmentData: $stagingEnv) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n  prodEnvironment: createEnvironment(environmentData: $prodEnv) {\n    environment {\n      id\n      name\n      createdAt\n      identityKey\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RotateAppKey($id: ID!, $appToken: String!, $wrappedKeyShare: String!) {\n  rotateAppKeys(id: $id, appToken: $appToken, wrappedKeyShare: $wrappedKeyShare) {\n    app {\n      id\n    }\n  }\n}"): (typeof documents)["mutation RotateAppKey($id: ID!, $appToken: String!, $wrappedKeyShare: String!) {\n  rotateAppKeys(id: $id, appToken: $appToken, wrappedKeyShare: $wrappedKeyShare) {\n    app {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateNewUserToken($orgId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!) {\n  createUserToken(\n    orgId: $orgId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n  ) {\n    userToken {\n      id\n      createdAt\n    }\n  }\n}"): (typeof documents)["mutation CreateNewUserToken($orgId: ID!, $name: String!, $identityKey: String!, $token: String!, $wrappedKeyShare: String!) {\n  createUserToken(\n    orgId: $orgId\n    name: $name\n    identityKey: $identityKey\n    token: $token\n    wrappedKeyShare: $wrappedKeyShare\n  ) {\n    userToken {\n      id\n      createdAt\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppActivityChart($appId: ID!, $period: TimeRange) {\n  appActivityChart(appId: $appId, period: $period) {\n    index\n    date\n    data\n  }\n}"): (typeof documents)["query GetAppActivityChart($appId: ID!, $period: TimeRange) {\n  appActivityChart(appId: $appId, period: $period) {\n    index\n    date\n    data\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppDetail($organisationId: ID!, $appId: ID!) {\n  apps(organisationId: $organisationId, appId: $appId) {\n    id\n    name\n    identityKey\n    createdAt\n    appToken\n    appSeed\n    appVersion\n  }\n}"): (typeof documents)["query GetAppDetail($organisationId: ID!, $appId: ID!) {\n  apps(organisationId: $organisationId, appId: $appId) {\n    id\n    name\n    identityKey\n    createdAt\n    appToken\n    appSeed\n    appVersion\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppLogCount($appId: ID!, $thisMonth: Boolean) {\n  logsCount(appId: $appId, thisMonth: $thisMonth)\n}"): (typeof documents)["query GetAppLogCount($appId: ID!, $thisMonth: Boolean) {\n  logsCount(appId: $appId, thisMonth: $thisMonth)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppLogs($appId: ID!, $start: BigInt, $end: BigInt) {\n  logs(appId: $appId, start: $start, end: $end) {\n    id\n    timestamp\n    phaseNode\n    eventType\n    ipAddress\n    country\n    city\n    phSize\n  }\n  logsCount(appId: $appId)\n}"): (typeof documents)["query GetAppLogs($appId: ID!, $start: BigInt, $end: BigInt) {\n  logs(appId: $appId, start: $start, end: $end) {\n    id\n    timestamp\n    phaseNode\n    eventType\n    ipAddress\n    country\n    city\n    phSize\n  }\n  logsCount(appId: $appId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetApps($organisationId: ID!, $appId: ID!) {\n  apps(organisationId: $organisationId, appId: $appId) {\n    id\n    name\n    identityKey\n    createdAt\n  }\n}"): (typeof documents)["query GetApps($organisationId: ID!, $appId: ID!) {\n  apps(organisationId: $organisationId, appId: $appId) {\n    id\n    name\n    identityKey\n    createdAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetOrganisations {\n  organisations {\n    id\n    name\n    identityKey\n    createdAt\n    plan\n  }\n}"): (typeof documents)["query GetOrganisations {\n  organisations {\n    id\n    name\n    identityKey\n    createdAt\n    plan\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetOrganisationAdminsAndSelf($organisationId: ID!) {\n  organisationAdminsAndSelf(organisationId: $organisationId) {\n    id\n    role\n    identityKey\n  }\n}"): (typeof documents)["query GetOrganisationAdminsAndSelf($organisationId: ID!) {\n  organisationAdminsAndSelf(organisationId: $organisationId) {\n    id\n    role\n    identityKey\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetOrganisationMembers($organisationId: ID!, $role: [String]) {\n  organisationMembers(organisationId: $organisationId, role: $role) {\n    role\n    identityKey\n  }\n}"): (typeof documents)["query GetOrganisationMembers($organisationId: ID!, $role: [String]) {\n  organisationMembers(organisationId: $organisationId, role: $role) {\n    role\n    identityKey\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetAppEnvironments($appId: ID!) {\n  appEnvironments(appId: $appId, environmentId: null) {\n    id\n    name\n    envType\n    identityKey\n    wrappedSeed\n    wrappedSalt\n    createdAt\n  }\n}"): (typeof documents)["query GetAppEnvironments($appId: ID!) {\n  appEnvironments(appId: $appId, environmentId: null) {\n    id\n    name\n    envType\n    identityKey\n    wrappedSeed\n    wrappedSalt\n    createdAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetEnvironmentKey($envId: ID!) {\n  environmentKeys(environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}"): (typeof documents)["query GetEnvironmentKey($envId: ID!) {\n  environmentKeys(environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetEnvironmentTokens($envId: ID!) {\n  environmentTokens(environmentId: $envId) {\n    id\n    name\n    wrappedKeyShare\n    createdAt\n  }\n}"): (typeof documents)["query GetEnvironmentTokens($envId: ID!) {\n  environmentTokens(environmentId: $envId) {\n    id\n    name\n    wrappedKeyShare\n    createdAt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetSecretNames($envId: ID!) {\n  secrets(envId: $envId) {\n    id\n    key\n  }\n  environmentKeys(environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}"): (typeof documents)["query GetSecretNames($envId: ID!) {\n  secrets(envId: $envId) {\n    id\n    key\n  }\n  environmentKeys(environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetSecretTags($orgId: ID!) {\n  secretTags(orgId: $orgId) {\n    id\n    name\n    color\n  }\n}"): (typeof documents)["query GetSecretTags($orgId: ID!) {\n  secretTags(orgId: $orgId) {\n    id\n    name\n    color\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetSecrets($appId: ID!, $envId: ID!) {\n  secrets(envId: $envId) {\n    id\n    key\n    value\n    tags {\n      name\n      color\n    }\n    comment\n    createdAt\n    history {\n      id\n      key\n      value\n      tags {\n        name\n        color\n      }\n      version\n      comment\n      timestamp\n      eventType\n    }\n  }\n  appEnvironments(appId: $appId, environmentId: $envId) {\n    id\n    name\n    envType\n    identityKey\n  }\n  environmentKeys(environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}"): (typeof documents)["query GetSecrets($appId: ID!, $envId: ID!) {\n  secrets(envId: $envId) {\n    id\n    key\n    value\n    tags {\n      name\n      color\n    }\n    comment\n    createdAt\n    history {\n      id\n      key\n      value\n      tags {\n        name\n        color\n      }\n      version\n      comment\n      timestamp\n      eventType\n    }\n  }\n  appEnvironments(appId: $appId, environmentId: $envId) {\n    id\n    name\n    envType\n    identityKey\n  }\n  environmentKeys(environmentId: $envId) {\n    id\n    identityKey\n    wrappedSeed\n    wrappedSalt\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetUserTokens($organisationId: ID!) {\n  userTokens(organisationId: $organisationId) {\n    id\n    name\n    wrappedKeyShare\n    createdAt\n  }\n}"): (typeof documents)["query GetUserTokens($organisationId: ID!) {\n  userTokens(organisationId: $organisationId) {\n    id\n    name\n    wrappedKeyShare\n    createdAt\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;