/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /**
   * The `BigInt` scalar type represents non-fractional whole numeric values.
   * `BigInt` is not constrained to 32-bit like the `Int` type and thus is a less
   * compatible type.
   */
  BigInt: { input: any; output: any; }
  /**
   * The `DateTime` scalar type represents a DateTime
   * value as specified by
   * [iso8601](https://en.wikipedia.org/wiki/ISO_8601).
   */
  DateTime: { input: any; output: any; }
  /**
   * Allows use of a JSON String for input / output from the GraphQL schema.
   *
   * Use of this type is *not recommended* as you lose the benefits of having a defined, static
   * schema (one of the key benefits of GraphQL).
   */
  JSONString: { input: any; output: any; }
};

export type AwsSecretType = {
  __typename?: 'AWSSecretType';
  arn?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
};

export type AddAppMemberMutation = {
  __typename?: 'AddAppMemberMutation';
  app?: Maybe<AppType>;
};

/** An enumeration. */
export enum ApiEnvironmentEnvTypeChoices {
  /** Development */
  Dev = 'DEV',
  /** Production */
  Prod = 'PROD',
  /** Staging */
  Staging = 'STAGING'
}

/** An enumeration. */
export enum ApiEnvironmentSyncEventStatusChoices {
  /** cancelled */
  Cancelled = 'CANCELLED',
  /** Completed */
  Completed = 'COMPLETED',
  /** Failed */
  Failed = 'FAILED',
  /** In progress */
  InProgress = 'IN_PROGRESS',
  /** Timed out */
  TimedOut = 'TIMED_OUT'
}

/** An enumeration. */
export enum ApiEnvironmentSyncStatusChoices {
  /** cancelled */
  Cancelled = 'CANCELLED',
  /** Completed */
  Completed = 'COMPLETED',
  /** Failed */
  Failed = 'FAILED',
  /** In progress */
  InProgress = 'IN_PROGRESS',
  /** Timed out */
  TimedOut = 'TIMED_OUT'
}

/** An enumeration. */
export enum ApiOrganisationMemberInviteRoleChoices {
  /** Admin */
  Admin = 'ADMIN',
  /** Developer */
  Dev = 'DEV',
  /** Owner */
  Owner = 'OWNER'
}

/** An enumeration. */
export enum ApiOrganisationMemberRoleChoices {
  /** Admin */
  Admin = 'ADMIN',
  /** Developer */
  Dev = 'DEV',
  /** Owner */
  Owner = 'OWNER'
}

/** An enumeration. */
export enum ApiOrganisationPlanChoices {
  /** Enterprise */
  En = 'EN',
  /** Free */
  Fr = 'FR',
  /** Pro */
  Pr = 'PR'
}

/** An enumeration. */
export enum ApiSecretEventEventTypeChoices {
  /** Create */
  C = 'C',
  /** Delete */
  D = 'D',
  /** Read */
  R = 'R',
  /** Update */
  U = 'U'
}

export type AppType = {
  __typename?: 'AppType';
  appSeed: Scalars['String']['output'];
  appToken: Scalars['String']['output'];
  appVersion: Scalars['Int']['output'];
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  identityKey: Scalars['String']['output'];
  name: Scalars['String']['output'];
  syncEnabled?: Maybe<Scalars['Boolean']['output']>;
  wrappedKeyShare: Scalars['String']['output'];
};

export type ChartDataPointType = {
  __typename?: 'ChartDataPointType';
  data?: Maybe<Scalars['Int']['output']>;
  date?: Maybe<Scalars['BigInt']['output']>;
  index?: Maybe<Scalars['Int']['output']>;
};

export type CloudFlarePagesType = {
  __typename?: 'CloudFlarePagesType';
  deploymentId?: Maybe<Scalars['String']['output']>;
  environments?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  name?: Maybe<Scalars['String']['output']>;
};

export type CreateAwsSecretsManagerSync = {
  __typename?: 'CreateAWSSecretsManagerSync';
  sync?: Maybe<EnvironmentSyncType>;
};

export type CreateAppMutation = {
  __typename?: 'CreateAppMutation';
  app?: Maybe<AppType>;
};

export type CreateCloudflarePagesSync = {
  __typename?: 'CreateCloudflarePagesSync';
  sync?: Maybe<EnvironmentSyncType>;
};

export type CreateEnvironmentKeyMutation = {
  __typename?: 'CreateEnvironmentKeyMutation';
  environmentKey?: Maybe<EnvironmentKeyType>;
};

export type CreateEnvironmentMutation = {
  __typename?: 'CreateEnvironmentMutation';
  environment?: Maybe<EnvironmentType>;
};

export type CreateEnvironmentTokenMutation = {
  __typename?: 'CreateEnvironmentTokenMutation';
  environmentToken?: Maybe<EnvironmentTokenType>;
};

export type CreateGitHubActionsSync = {
  __typename?: 'CreateGitHubActionsSync';
  sync?: Maybe<EnvironmentSyncType>;
};

export type CreateOrganisationMemberMutation = {
  __typename?: 'CreateOrganisationMemberMutation';
  orgMember?: Maybe<OrganisationMemberType>;
};

export type CreateOrganisationMutation = {
  __typename?: 'CreateOrganisationMutation';
  organisation?: Maybe<OrganisationType>;
};

export type CreatePersonalSecretMutation = {
  __typename?: 'CreatePersonalSecretMutation';
  override?: Maybe<PersonalSecretType>;
};

export type CreateProviderCredentials = {
  __typename?: 'CreateProviderCredentials';
  credential?: Maybe<ProviderCredentialsType>;
};

export type CreateSecretFolderMutation = {
  __typename?: 'CreateSecretFolderMutation';
  folder?: Maybe<SecretFolderType>;
};

export type CreateSecretMutation = {
  __typename?: 'CreateSecretMutation';
  secret?: Maybe<SecretType>;
};

export type CreateSecretTagMutation = {
  __typename?: 'CreateSecretTagMutation';
  tag?: Maybe<SecretTagType>;
};

export type CreateServiceTokenMutation = {
  __typename?: 'CreateServiceTokenMutation';
  serviceToken?: Maybe<ServiceTokenType>;
};

export type CreateUserTokenMutation = {
  __typename?: 'CreateUserTokenMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
  userToken?: Maybe<UserTokenType>;
};

export type CreateVaultSync = {
  __typename?: 'CreateVaultSync';
  sync?: Maybe<EnvironmentSyncType>;
};

export type DeleteAppMutation = {
  __typename?: 'DeleteAppMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteInviteMutation = {
  __typename?: 'DeleteInviteMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteOrganisationMemberMutation = {
  __typename?: 'DeleteOrganisationMemberMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeletePersonalSecretMutation = {
  __typename?: 'DeletePersonalSecretMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteProviderCredentials = {
  __typename?: 'DeleteProviderCredentials';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteSecretFolderMutation = {
  __typename?: 'DeleteSecretFolderMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteSecretMutation = {
  __typename?: 'DeleteSecretMutation';
  secret?: Maybe<SecretType>;
};

export type DeleteServiceTokenMutation = {
  __typename?: 'DeleteServiceTokenMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteSync = {
  __typename?: 'DeleteSync';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteUserTokenMutation = {
  __typename?: 'DeleteUserTokenMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type EditSecretMutation = {
  __typename?: 'EditSecretMutation';
  secret?: Maybe<SecretType>;
};

export type EnvironmentInput = {
  appId: Scalars['ID']['input'];
  envType: Scalars['String']['input'];
  identityKey: Scalars['String']['input'];
  name: Scalars['String']['input'];
  wrappedSalt: Scalars['String']['input'];
  wrappedSeed: Scalars['String']['input'];
};

export type EnvironmentKeyInput = {
  envId: Scalars['ID']['input'];
  identityKey: Scalars['String']['input'];
  userId?: InputMaybe<Scalars['ID']['input']>;
  wrappedSalt: Scalars['String']['input'];
  wrappedSeed: Scalars['String']['input'];
};

export type EnvironmentKeyType = {
  __typename?: 'EnvironmentKeyType';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  environment: EnvironmentType;
  id: Scalars['String']['output'];
  identityKey: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  wrappedSalt: Scalars['String']['output'];
  wrappedSeed: Scalars['String']['output'];
};

export type EnvironmentSyncEventType = {
  __typename?: 'EnvironmentSyncEventType';
  completedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  envSync: EnvironmentSyncType;
  id: Scalars['String']['output'];
  meta?: Maybe<Scalars['JSONString']['output']>;
  status: ApiEnvironmentSyncEventStatusChoices;
};

export type EnvironmentSyncType = {
  __typename?: 'EnvironmentSyncType';
  authentication?: Maybe<ProviderCredentialsType>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  environment: EnvironmentType;
  history: Array<EnvironmentSyncEventType>;
  id: Scalars['String']['output'];
  isActive: Scalars['Boolean']['output'];
  lastSync?: Maybe<Scalars['DateTime']['output']>;
  options: Scalars['JSONString']['output'];
  path: Scalars['String']['output'];
  serviceInfo?: Maybe<ServiceType>;
  status: ApiEnvironmentSyncStatusChoices;
};

export type EnvironmentTokenType = {
  __typename?: 'EnvironmentTokenType';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  identityKey: Scalars['String']['output'];
  name: Scalars['String']['output'];
  token: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  wrappedKeyShare: Scalars['String']['output'];
};

export type EnvironmentType = {
  __typename?: 'EnvironmentType';
  app: AppType;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  envType: ApiEnvironmentEnvTypeChoices;
  folderCount?: Maybe<Scalars['Int']['output']>;
  id: Scalars['String']['output'];
  identityKey: Scalars['String']['output'];
  name: Scalars['String']['output'];
  secretCount?: Maybe<Scalars['Int']['output']>;
  updatedAt: Scalars['DateTime']['output'];
  wrappedSalt: Scalars['String']['output'];
  wrappedSeed: Scalars['String']['output'];
};

export type GitHubRepoType = {
  __typename?: 'GitHubRepoType';
  name?: Maybe<Scalars['String']['output']>;
  owner?: Maybe<Scalars['String']['output']>;
  type?: Maybe<Scalars['String']['output']>;
};

export type InitEnvSync = {
  __typename?: 'InitEnvSync';
  app?: Maybe<AppType>;
};

export type InviteOrganisationMemberMutation = {
  __typename?: 'InviteOrganisationMemberMutation';
  invite?: Maybe<OrganisationMemberInviteType>;
};

export type KmsLogType = Node & {
  __typename?: 'KMSLogType';
  appId?: Maybe<Scalars['String']['output']>;
  asn?: Maybe<Scalars['Int']['output']>;
  city?: Maybe<Scalars['String']['output']>;
  country?: Maybe<Scalars['String']['output']>;
  edgeLocation?: Maybe<Scalars['String']['output']>;
  eventType?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  ipAddress?: Maybe<Scalars['String']['output']>;
  isp?: Maybe<Scalars['String']['output']>;
  latitude?: Maybe<Scalars['Float']['output']>;
  longitude?: Maybe<Scalars['Float']['output']>;
  phSize?: Maybe<Scalars['Int']['output']>;
  phaseNode?: Maybe<Scalars['String']['output']>;
  timestamp?: Maybe<Scalars['BigInt']['output']>;
};

export type LogsResponseType = {
  __typename?: 'LogsResponseType';
  kms?: Maybe<Array<Maybe<KmsLogType>>>;
  secrets?: Maybe<Array<Maybe<SecretEventType>>>;
};

export type Mutation = {
  __typename?: 'Mutation';
  addAppMember?: Maybe<AddAppMemberMutation>;
  createApp?: Maybe<CreateAppMutation>;
  createAwsSecretSync?: Maybe<CreateAwsSecretsManagerSync>;
  createCloudflarePagesSync?: Maybe<CreateCloudflarePagesSync>;
  createEnvironment?: Maybe<CreateEnvironmentMutation>;
  createEnvironmentKey?: Maybe<CreateEnvironmentKeyMutation>;
  createEnvironmentToken?: Maybe<CreateEnvironmentTokenMutation>;
  createGhActionsSync?: Maybe<CreateGitHubActionsSync>;
  createOrganisation?: Maybe<CreateOrganisationMutation>;
  createOrganisationMember?: Maybe<CreateOrganisationMemberMutation>;
  createOverride?: Maybe<CreatePersonalSecretMutation>;
  createProviderCredentials?: Maybe<CreateProviderCredentials>;
  createSecret?: Maybe<CreateSecretMutation>;
  createSecretFolder?: Maybe<CreateSecretFolderMutation>;
  createSecretTag?: Maybe<CreateSecretTagMutation>;
  createServiceToken?: Maybe<CreateServiceTokenMutation>;
  createUserToken?: Maybe<CreateUserTokenMutation>;
  createVaultSync?: Maybe<CreateVaultSync>;
  deleteApp?: Maybe<DeleteAppMutation>;
  deleteEnvSync?: Maybe<DeleteSync>;
  deleteInvitation?: Maybe<DeleteInviteMutation>;
  deleteOrganisationMember?: Maybe<DeleteOrganisationMemberMutation>;
  deleteProviderCredentials?: Maybe<DeleteProviderCredentials>;
  deleteSecret?: Maybe<DeleteSecretMutation>;
  deleteSecretFolder?: Maybe<DeleteSecretFolderMutation>;
  deleteServiceToken?: Maybe<DeleteServiceTokenMutation>;
  deleteUserToken?: Maybe<DeleteUserTokenMutation>;
  editSecret?: Maybe<EditSecretMutation>;
  initEnvSync?: Maybe<InitEnvSync>;
  inviteOrganisationMember?: Maybe<InviteOrganisationMemberMutation>;
  readSecret?: Maybe<ReadSecretMutation>;
  removeAppMember?: Maybe<RemoveAppMemberMutation>;
  removeOverride?: Maybe<DeletePersonalSecretMutation>;
  rotateAppKeys?: Maybe<RotateAppKeysMutation>;
  toggleSyncActive?: Maybe<ToggleSyncActive>;
  triggerSync?: Maybe<TriggerSync>;
  updateMemberEnvironmentScope?: Maybe<UpdateMemberEnvScopeMutation>;
  updateMemberWrappedSecrets?: Maybe<UpdateUserWrappedSecretsMutation>;
  updateOrganisationMemberRole?: Maybe<UpdateOrganisationMemberRole>;
  updateProviderCredentials?: Maybe<UpdateProviderCredentials>;
  updateSyncAuthentication?: Maybe<UpdateSyncAuthentication>;
};


export type MutationAddAppMemberArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  envKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>>>;
  memberId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationCreateAppArgs = {
  appSeed: Scalars['String']['input'];
  appToken: Scalars['String']['input'];
  appVersion: Scalars['Int']['input'];
  id: Scalars['ID']['input'];
  identityKey: Scalars['String']['input'];
  name: Scalars['String']['input'];
  organisationId: Scalars['ID']['input'];
  wrappedKeyShare: Scalars['String']['input'];
};


export type MutationCreateAwsSecretSyncArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  kmsId?: InputMaybe<Scalars['String']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  secretName?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateCloudflarePagesSyncArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  deploymentId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  projectEnv?: InputMaybe<Scalars['String']['input']>;
  projectName?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateEnvironmentArgs = {
  adminKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>>>;
  environmentData: EnvironmentInput;
};


export type MutationCreateEnvironmentKeyArgs = {
  envId: Scalars['ID']['input'];
  identityKey: Scalars['String']['input'];
  userId?: InputMaybe<Scalars['ID']['input']>;
  wrappedSalt: Scalars['String']['input'];
  wrappedSeed: Scalars['String']['input'];
};


export type MutationCreateEnvironmentTokenArgs = {
  envId: Scalars['ID']['input'];
  identityKey: Scalars['String']['input'];
  name: Scalars['String']['input'];
  token: Scalars['String']['input'];
  wrappedKeyShare: Scalars['String']['input'];
};


export type MutationCreateGhActionsSyncArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  owner?: InputMaybe<Scalars['String']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  repoName?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateOrganisationArgs = {
  id: Scalars['ID']['input'];
  identityKey: Scalars['String']['input'];
  name: Scalars['String']['input'];
  wrappedKeyring: Scalars['String']['input'];
  wrappedRecovery: Scalars['String']['input'];
};


export type MutationCreateOrganisationMemberArgs = {
  identityKey: Scalars['String']['input'];
  inviteId: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
  wrappedKeyring?: InputMaybe<Scalars['String']['input']>;
  wrappedRecovery?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateOverrideArgs = {
  overrideData?: InputMaybe<PersonalSecretInput>;
};


export type MutationCreateProviderCredentialsArgs = {
  credentials?: InputMaybe<Scalars['JSONString']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  provider?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateSecretArgs = {
  secretData?: InputMaybe<SecretInput>;
};


export type MutationCreateSecretFolderArgs = {
  envId?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateSecretTagArgs = {
  color: Scalars['String']['input'];
  name: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
};


export type MutationCreateServiceTokenArgs = {
  appId: Scalars['ID']['input'];
  environmentKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>>>;
  expiry?: InputMaybe<Scalars['BigInt']['input']>;
  identityKey: Scalars['String']['input'];
  name: Scalars['String']['input'];
  token: Scalars['String']['input'];
  wrappedKeyShare: Scalars['String']['input'];
};


export type MutationCreateUserTokenArgs = {
  expiry?: InputMaybe<Scalars['BigInt']['input']>;
  identityKey: Scalars['String']['input'];
  name: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  token: Scalars['String']['input'];
  wrappedKeyShare: Scalars['String']['input'];
};


export type MutationCreateVaultSyncArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  engine?: InputMaybe<Scalars['String']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  vaultPath?: InputMaybe<Scalars['String']['input']>;
};


export type MutationDeleteAppArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteEnvSyncArgs = {
  syncId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationDeleteInvitationArgs = {
  inviteId: Scalars['ID']['input'];
};


export type MutationDeleteOrganisationMemberArgs = {
  memberId: Scalars['ID']['input'];
};


export type MutationDeleteProviderCredentialsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationDeleteSecretArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteSecretFolderArgs = {
  folderId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationDeleteServiceTokenArgs = {
  tokenId: Scalars['ID']['input'];
};


export type MutationDeleteUserTokenArgs = {
  tokenId: Scalars['ID']['input'];
};


export type MutationEditSecretArgs = {
  id: Scalars['ID']['input'];
  secretData?: InputMaybe<SecretInput>;
};


export type MutationInitEnvSyncArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  envKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>>>;
};


export type MutationInviteOrganisationMemberArgs = {
  apps?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  email: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  role?: InputMaybe<Scalars['String']['input']>;
};


export type MutationReadSecretArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRemoveAppMemberArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  memberId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationRemoveOverrideArgs = {
  secretId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationRotateAppKeysArgs = {
  appToken: Scalars['String']['input'];
  id: Scalars['ID']['input'];
  wrappedKeyShare: Scalars['String']['input'];
};


export type MutationToggleSyncActiveArgs = {
  syncId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationTriggerSyncArgs = {
  syncId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationUpdateMemberEnvironmentScopeArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  envKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>>>;
  memberId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationUpdateMemberWrappedSecretsArgs = {
  orgId: Scalars['ID']['input'];
  wrappedKeyring: Scalars['String']['input'];
  wrappedRecovery: Scalars['String']['input'];
};


export type MutationUpdateOrganisationMemberRoleArgs = {
  memberId: Scalars['ID']['input'];
  role: Scalars['String']['input'];
};


export type MutationUpdateProviderCredentialsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  credentials?: InputMaybe<Scalars['JSONString']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};


export type MutationUpdateSyncAuthenticationArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  syncId?: InputMaybe<Scalars['ID']['input']>;
};

/** An object with an ID */
export type Node = {
  /** The ID of the object */
  id: Scalars['ID']['output'];
};

export type OrganisationMemberInviteType = {
  __typename?: 'OrganisationMemberInviteType';
  apps: Array<AppType>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  expiresAt: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  invitedBy: OrganisationMemberType;
  inviteeEmail: Scalars['String']['output'];
  organisation: OrganisationType;
  role: ApiOrganisationMemberInviteRoleChoices;
  updatedAt: Scalars['DateTime']['output'];
  valid: Scalars['Boolean']['output'];
};

export type OrganisationMemberType = {
  __typename?: 'OrganisationMemberType';
  avatarUrl?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  email?: Maybe<Scalars['String']['output']>;
  fullName?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  identityKey?: Maybe<Scalars['String']['output']>;
  role: ApiOrganisationMemberRoleChoices;
  self?: Maybe<Scalars['Boolean']['output']>;
  updatedAt: Scalars['DateTime']['output'];
  username?: Maybe<Scalars['String']['output']>;
  wrappedKeyring: Scalars['String']['output'];
};

export type OrganisationType = {
  __typename?: 'OrganisationType';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  identityKey: Scalars['String']['output'];
  keyring?: Maybe<Scalars['String']['output']>;
  memberId?: Maybe<Scalars['ID']['output']>;
  name: Scalars['String']['output'];
  plan: ApiOrganisationPlanChoices;
  recovery?: Maybe<Scalars['String']['output']>;
  role?: Maybe<Scalars['String']['output']>;
};

export type PersonalSecretInput = {
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  secretId?: InputMaybe<Scalars['ID']['input']>;
  value?: InputMaybe<Scalars['String']['input']>;
};

export type PersonalSecretType = {
  __typename?: 'PersonalSecretType';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  isActive: Scalars['Boolean']['output'];
  secret: SecretType;
  updatedAt: Scalars['DateTime']['output'];
  user: OrganisationMemberType;
  value?: Maybe<Scalars['String']['output']>;
};

export type ProviderCredentialsType = {
  __typename?: 'ProviderCredentialsType';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  credentials: Scalars['JSONString']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  provider?: Maybe<ProviderType>;
  syncCount?: Maybe<Scalars['Int']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type ProviderType = {
  __typename?: 'ProviderType';
  authScheme?: Maybe<Scalars['String']['output']>;
  expectedCredentials: Array<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  optionalCredentials: Array<Scalars['String']['output']>;
};

export type Query = {
  __typename?: 'Query';
  appActivityChart?: Maybe<Array<Maybe<ChartDataPointType>>>;
  appEnvironments?: Maybe<Array<Maybe<EnvironmentType>>>;
  appUsers?: Maybe<Array<Maybe<OrganisationMemberType>>>;
  apps?: Maybe<Array<Maybe<AppType>>>;
  awsSecrets?: Maybe<Array<Maybe<AwsSecretType>>>;
  cloudflarePagesProjects?: Maybe<Array<Maybe<CloudFlarePagesType>>>;
  envSyncs?: Maybe<Array<Maybe<EnvironmentSyncType>>>;
  environmentKeys?: Maybe<Array<Maybe<EnvironmentKeyType>>>;
  environmentTokens?: Maybe<Array<Maybe<EnvironmentTokenType>>>;
  folders?: Maybe<Array<Maybe<SecretFolderType>>>;
  githubRepos?: Maybe<Array<Maybe<GitHubRepoType>>>;
  kmsLogsCount?: Maybe<Scalars['Int']['output']>;
  logs?: Maybe<LogsResponseType>;
  organisationAdminsAndSelf?: Maybe<Array<Maybe<OrganisationMemberType>>>;
  organisationInvites?: Maybe<Array<Maybe<OrganisationMemberInviteType>>>;
  organisationMembers?: Maybe<Array<Maybe<OrganisationMemberType>>>;
  organisations?: Maybe<Array<Maybe<OrganisationType>>>;
  providers?: Maybe<Array<Maybe<ProviderType>>>;
  savedCredentials?: Maybe<Array<Maybe<ProviderCredentialsType>>>;
  secretHistory?: Maybe<Array<Maybe<SecretEventType>>>;
  secretTags?: Maybe<Array<Maybe<SecretTagType>>>;
  secrets?: Maybe<Array<Maybe<SecretType>>>;
  secretsLogsCount?: Maybe<Scalars['Int']['output']>;
  serverPublicKey?: Maybe<Scalars['String']['output']>;
  serviceTokens?: Maybe<Array<Maybe<ServiceTokenType>>>;
  services?: Maybe<Array<Maybe<ServiceType>>>;
  syncEnabled?: Maybe<Scalars['Boolean']['output']>;
  syncs?: Maybe<Array<Maybe<EnvironmentSyncType>>>;
  testVaultCreds?: Maybe<Scalars['Boolean']['output']>;
  userTokens?: Maybe<Array<Maybe<UserTokenType>>>;
  validateInvite?: Maybe<OrganisationMemberInviteType>;
};


export type QueryAppActivityChartArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  period?: InputMaybe<TimeRange>;
};


export type QueryAppEnvironmentsArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  environmentId?: InputMaybe<Scalars['ID']['input']>;
  memberId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryAppUsersArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryAppsArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  organisationId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryAwsSecretsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryCloudflarePagesProjectsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryEnvSyncsArgs = {
  envId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryEnvironmentKeysArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  environmentId?: InputMaybe<Scalars['ID']['input']>;
  memberId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryEnvironmentTokensArgs = {
  environmentId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryFoldersArgs = {
  envId?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
};


export type QueryGithubReposArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryKmsLogsCountArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  thisMonth?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryLogsArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  end?: InputMaybe<Scalars['BigInt']['input']>;
  start?: InputMaybe<Scalars['BigInt']['input']>;
};


export type QueryOrganisationAdminsAndSelfArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryOrganisationInvitesArgs = {
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryOrganisationMembersArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
  role?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySavedCredentialsArgs = {
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySecretHistoryArgs = {
  secretId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySecretTagsArgs = {
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySecretsArgs = {
  envId?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
};


export type QuerySecretsLogsCountArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryServiceTokensArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySyncEnabledArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySyncsArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryTestVaultCredsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryUserTokensArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryValidateInviteArgs = {
  inviteId?: InputMaybe<Scalars['ID']['input']>;
};

export type ReadSecretMutation = {
  __typename?: 'ReadSecretMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type RemoveAppMemberMutation = {
  __typename?: 'RemoveAppMemberMutation';
  app?: Maybe<AppType>;
};

export type RotateAppKeysMutation = {
  __typename?: 'RotateAppKeysMutation';
  app?: Maybe<AppType>;
};

export type SecretEventType = {
  __typename?: 'SecretEventType';
  comment: Scalars['String']['output'];
  environment: EnvironmentType;
  eventType: ApiSecretEventEventTypeChoices;
  id: Scalars['String']['output'];
  ipAddress?: Maybe<Scalars['String']['output']>;
  key: Scalars['String']['output'];
  path: Scalars['String']['output'];
  secret: SecretType;
  tags: Array<SecretTagType>;
  timestamp: Scalars['DateTime']['output'];
  user?: Maybe<OrganisationMemberType>;
  userAgent?: Maybe<Scalars['String']['output']>;
  value: Scalars['String']['output'];
  version: Scalars['Int']['output'];
};

export type SecretFolderType = {
  __typename?: 'SecretFolderType';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  environment: EnvironmentType;
  folderCount?: Maybe<Scalars['Int']['output']>;
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  path: Scalars['String']['output'];
  secretCount?: Maybe<Scalars['Int']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type SecretInput = {
  comment?: InputMaybe<Scalars['String']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  key: Scalars['String']['input'];
  keyDigest: Scalars['String']['input'];
  path?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  value: Scalars['String']['input'];
};

export type SecretTagType = {
  __typename?: 'SecretTagType';
  color: Scalars['String']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type SecretType = {
  __typename?: 'SecretType';
  comment: Scalars['String']['output'];
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  folder?: Maybe<SecretFolderType>;
  history?: Maybe<Array<Maybe<SecretEventType>>>;
  id: Scalars['String']['output'];
  key: Scalars['String']['output'];
  override?: Maybe<PersonalSecretType>;
  path: Scalars['String']['output'];
  tags: Array<SecretTagType>;
  updatedAt: Scalars['DateTime']['output'];
  value: Scalars['String']['output'];
  version: Scalars['Int']['output'];
};

export type ServerEnvironmentKeyType = {
  __typename?: 'ServerEnvironmentKeyType';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  environment: EnvironmentType;
  id: Scalars['String']['output'];
  identityKey: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  wrappedSalt: Scalars['String']['output'];
  wrappedSeed: Scalars['String']['output'];
};

export type ServiceTokenType = {
  __typename?: 'ServiceTokenType';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  createdBy?: Maybe<OrganisationMemberType>;
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  identityKey: Scalars['String']['output'];
  keys: Array<ServerEnvironmentKeyType>;
  name: Scalars['String']['output'];
  token: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  wrappedKeyShare: Scalars['String']['output'];
};

export type ServiceType = {
  __typename?: 'ServiceType';
  id?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  provider?: Maybe<ProviderType>;
  resourceType?: Maybe<Scalars['String']['output']>;
};

/** An enumeration. */
export enum TimeRange {
  AllTime = 'ALL_TIME',
  Day = 'DAY',
  Hour = 'HOUR',
  Month = 'MONTH',
  Week = 'WEEK',
  Year = 'YEAR'
}

export type ToggleSyncActive = {
  __typename?: 'ToggleSyncActive';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type TriggerSync = {
  __typename?: 'TriggerSync';
  sync?: Maybe<EnvironmentSyncType>;
};

export type UpdateMemberEnvScopeMutation = {
  __typename?: 'UpdateMemberEnvScopeMutation';
  app?: Maybe<AppType>;
};

export type UpdateOrganisationMemberRole = {
  __typename?: 'UpdateOrganisationMemberRole';
  orgMember?: Maybe<OrganisationMemberType>;
};

export type UpdateProviderCredentials = {
  __typename?: 'UpdateProviderCredentials';
  credential?: Maybe<ProviderCredentialsType>;
};

export type UpdateSyncAuthentication = {
  __typename?: 'UpdateSyncAuthentication';
  sync?: Maybe<EnvironmentSyncType>;
};

export type UpdateUserWrappedSecretsMutation = {
  __typename?: 'UpdateUserWrappedSecretsMutation';
  orgMember?: Maybe<OrganisationMemberType>;
};

export type UserTokenType = {
  __typename?: 'UserTokenType';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  identityKey: Scalars['String']['output'];
  name: Scalars['String']['output'];
  token: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  wrappedKeyShare: Scalars['String']['output'];
};

export type AddMemberToAppMutationVariables = Exact<{
  memberId: Scalars['ID']['input'];
  appId: Scalars['ID']['input'];
  envKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>> | InputMaybe<EnvironmentKeyInput>>;
}>;


export type AddMemberToAppMutation = { __typename?: 'Mutation', addAppMember?: { __typename?: 'AddAppMemberMutation', app?: { __typename?: 'AppType', id: string } | null } | null };

export type RemoveMemberFromAppMutationVariables = Exact<{
  memberId: Scalars['ID']['input'];
  appId: Scalars['ID']['input'];
}>;


export type RemoveMemberFromAppMutation = { __typename?: 'Mutation', removeAppMember?: { __typename?: 'RemoveAppMemberMutation', app?: { __typename?: 'AppType', id: string } | null } | null };

export type UpdateEnvScopeMutationVariables = Exact<{
  memberId: Scalars['ID']['input'];
  appId: Scalars['ID']['input'];
  envKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>> | InputMaybe<EnvironmentKeyInput>>;
}>;


export type UpdateEnvScopeMutation = { __typename?: 'Mutation', updateMemberEnvironmentScope?: { __typename?: 'UpdateMemberEnvScopeMutation', app?: { __typename?: 'AppType', id: string } | null } | null };

export type CreateApplicationMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  organisationId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  identityKey: Scalars['String']['input'];
  appToken: Scalars['String']['input'];
  appSeed: Scalars['String']['input'];
  wrappedKeyShare: Scalars['String']['input'];
  appVersion: Scalars['Int']['input'];
}>;


export type CreateApplicationMutation = { __typename?: 'Mutation', createApp?: { __typename?: 'CreateAppMutation', app?: { __typename?: 'AppType', id: string, name: string, identityKey: string } | null } | null };

export type CreateOrgMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  identityKey: Scalars['String']['input'];
  wrappedKeyring: Scalars['String']['input'];
  wrappedRecovery: Scalars['String']['input'];
}>;


export type CreateOrgMutation = { __typename?: 'Mutation', createOrganisation?: { __typename?: 'CreateOrganisationMutation', organisation?: { __typename?: 'OrganisationType', id: string, name: string, createdAt?: any | null } | null } | null };

export type DeleteApplicationMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteApplicationMutation = { __typename?: 'Mutation', deleteApp?: { __typename?: 'DeleteAppMutation', ok?: boolean | null } | null };

export type CreateEnvMutationVariables = Exact<{
  input: EnvironmentInput;
}>;


export type CreateEnvMutation = { __typename?: 'Mutation', createEnvironment?: { __typename?: 'CreateEnvironmentMutation', environment?: { __typename?: 'EnvironmentType', id: string, name: string, createdAt?: any | null, identityKey: string } | null } | null };

export type CreateEnvKeyMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  userId?: InputMaybe<Scalars['ID']['input']>;
  wrappedSeed: Scalars['String']['input'];
  wrappedSalt: Scalars['String']['input'];
  identityKey: Scalars['String']['input'];
}>;


export type CreateEnvKeyMutation = { __typename?: 'Mutation', createEnvironmentKey?: { __typename?: 'CreateEnvironmentKeyMutation', environmentKey?: { __typename?: 'EnvironmentKeyType', id: string, createdAt?: any | null } | null } | null };

export type CreateEnvTokenMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  identityKey: Scalars['String']['input'];
  token: Scalars['String']['input'];
  wrappedKeyShare: Scalars['String']['input'];
}>;


export type CreateEnvTokenMutation = { __typename?: 'Mutation', createEnvironmentToken?: { __typename?: 'CreateEnvironmentTokenMutation', environmentToken?: { __typename?: 'EnvironmentTokenType', id: string, createdAt?: any | null } | null } | null };

export type CreateNewSecretFolderMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  path: Scalars['String']['input'];
}>;


export type CreateNewSecretFolderMutation = { __typename?: 'Mutation', createSecretFolder?: { __typename?: 'CreateSecretFolderMutation', folder?: { __typename?: 'SecretFolderType', id: string, name: string, path: string } | null } | null };

export type CreateNewPersonalSecretMutationVariables = Exact<{
  newPersonalSecret: PersonalSecretInput;
}>;


export type CreateNewPersonalSecretMutation = { __typename?: 'Mutation', createOverride?: { __typename?: 'CreatePersonalSecretMutation', override?: { __typename?: 'PersonalSecretType', id: string, value?: string | null, isActive: boolean, createdAt?: any | null, secret: { __typename?: 'SecretType', id: string } } | null } | null };

export type CreateNewSecretMutationVariables = Exact<{
  newSecret: SecretInput;
}>;


export type CreateNewSecretMutation = { __typename?: 'Mutation', createSecret?: { __typename?: 'CreateSecretMutation', secret?: { __typename?: 'SecretType', id: string, key: string, value: string, createdAt?: any | null } | null } | null };

export type CreateNewSecretTagMutationVariables = Exact<{
  orgId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  color: Scalars['String']['input'];
}>;


export type CreateNewSecretTagMutation = { __typename?: 'Mutation', createSecretTag?: { __typename?: 'CreateSecretTagMutation', tag?: { __typename?: 'SecretTagType', id: string } | null } | null };

export type CreateNewServiceTokenMutationVariables = Exact<{
  appId: Scalars['ID']['input'];
  environmentKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>> | InputMaybe<EnvironmentKeyInput>>;
  identityKey: Scalars['String']['input'];
  token: Scalars['String']['input'];
  wrappedKeyShare: Scalars['String']['input'];
  name: Scalars['String']['input'];
  expiry?: InputMaybe<Scalars['BigInt']['input']>;
}>;


export type CreateNewServiceTokenMutation = { __typename?: 'Mutation', createServiceToken?: { __typename?: 'CreateServiceTokenMutation', serviceToken?: { __typename?: 'ServiceTokenType', id: string, createdAt?: any | null, expiresAt?: any | null } | null } | null };

export type DeleteFolderMutationVariables = Exact<{
  folderId: Scalars['ID']['input'];
}>;


export type DeleteFolderMutation = { __typename?: 'Mutation', deleteSecretFolder?: { __typename?: 'DeleteSecretFolderMutation', ok?: boolean | null } | null };

export type DeleteSecretOpMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteSecretOpMutation = { __typename?: 'Mutation', deleteSecret?: { __typename?: 'DeleteSecretMutation', secret?: { __typename?: 'SecretType', id: string } | null } | null };

export type RevokeServiceTokenMutationVariables = Exact<{
  tokenId: Scalars['ID']['input'];
}>;


export type RevokeServiceTokenMutation = { __typename?: 'Mutation', deleteServiceToken?: { __typename?: 'DeleteServiceTokenMutation', ok?: boolean | null } | null };

export type UpdateSecretMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  secretData: SecretInput;
}>;


export type UpdateSecretMutation = { __typename?: 'Mutation', editSecret?: { __typename?: 'EditSecretMutation', secret?: { __typename?: 'SecretType', id: string, updatedAt: any } | null } | null };

export type InitAppEnvironmentsMutationVariables = Exact<{
  devEnv: EnvironmentInput;
  stagingEnv: EnvironmentInput;
  prodEnv: EnvironmentInput;
  devAdminKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>> | InputMaybe<EnvironmentKeyInput>>;
  stagAdminKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>> | InputMaybe<EnvironmentKeyInput>>;
  prodAdminKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>> | InputMaybe<EnvironmentKeyInput>>;
}>;


export type InitAppEnvironmentsMutation = { __typename?: 'Mutation', devEnvironment?: { __typename?: 'CreateEnvironmentMutation', environment?: { __typename?: 'EnvironmentType', id: string, name: string, createdAt?: any | null, identityKey: string } | null } | null, stagingEnvironment?: { __typename?: 'CreateEnvironmentMutation', environment?: { __typename?: 'EnvironmentType', id: string, name: string, createdAt?: any | null, identityKey: string } | null } | null, prodEnvironment?: { __typename?: 'CreateEnvironmentMutation', environment?: { __typename?: 'EnvironmentType', id: string, name: string, createdAt?: any | null, identityKey: string } | null } | null };

export type LogSecretReadMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type LogSecretReadMutation = { __typename?: 'Mutation', readSecret?: { __typename?: 'ReadSecretMutation', ok?: boolean | null } | null };

export type RemovePersonalSecretMutationVariables = Exact<{
  secretId: Scalars['ID']['input'];
}>;


export type RemovePersonalSecretMutation = { __typename?: 'Mutation', removeOverride?: { __typename?: 'DeletePersonalSecretMutation', ok?: boolean | null } | null };

export type AcceptOrganisationInviteMutationVariables = Exact<{
  orgId: Scalars['ID']['input'];
  identityKey: Scalars['String']['input'];
  wrappedKeyring: Scalars['String']['input'];
  wrappedRecovery: Scalars['String']['input'];
  inviteId: Scalars['ID']['input'];
}>;


export type AcceptOrganisationInviteMutation = { __typename?: 'Mutation', createOrganisationMember?: { __typename?: 'CreateOrganisationMemberMutation', orgMember?: { __typename?: 'OrganisationMemberType', id: string, email?: string | null, createdAt?: any | null, role: ApiOrganisationMemberRoleChoices } | null } | null };

export type DeleteOrgInviteMutationVariables = Exact<{
  inviteId: Scalars['ID']['input'];
}>;


export type DeleteOrgInviteMutation = { __typename?: 'Mutation', deleteInvitation?: { __typename?: 'DeleteInviteMutation', ok?: boolean | null } | null };

export type RemoveMemberMutationVariables = Exact<{
  memberId: Scalars['ID']['input'];
}>;


export type RemoveMemberMutation = { __typename?: 'Mutation', deleteOrganisationMember?: { __typename?: 'DeleteOrganisationMemberMutation', ok?: boolean | null } | null };

export type InviteMemberMutationVariables = Exact<{
  orgId: Scalars['ID']['input'];
  email: Scalars['String']['input'];
  apps?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>> | InputMaybe<Scalars['String']['input']>>;
  role?: InputMaybe<Scalars['String']['input']>;
}>;


export type InviteMemberMutation = { __typename?: 'Mutation', inviteOrganisationMember?: { __typename?: 'InviteOrganisationMemberMutation', invite?: { __typename?: 'OrganisationMemberInviteType', id: string } | null } | null };

export type UpdateMemberRoleMutationVariables = Exact<{
  memberId: Scalars['ID']['input'];
  role: Scalars['String']['input'];
}>;


export type UpdateMemberRoleMutation = { __typename?: 'Mutation', updateOrganisationMemberRole?: { __typename?: 'UpdateOrganisationMemberRole', orgMember?: { __typename?: 'OrganisationMemberType', id: string, role: ApiOrganisationMemberRoleChoices } | null } | null };

export type UpdateWrappedSecretsMutationVariables = Exact<{
  orgId: Scalars['ID']['input'];
  wrappedKeyring: Scalars['String']['input'];
  wrappedRecovery: Scalars['String']['input'];
}>;


export type UpdateWrappedSecretsMutation = { __typename?: 'Mutation', updateMemberWrappedSecrets?: { __typename?: 'UpdateUserWrappedSecretsMutation', orgMember?: { __typename?: 'OrganisationMemberType', id: string } | null } | null };

export type RotateAppKeyMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  appToken: Scalars['String']['input'];
  wrappedKeyShare: Scalars['String']['input'];
}>;


export type RotateAppKeyMutation = { __typename?: 'Mutation', rotateAppKeys?: { __typename?: 'RotateAppKeysMutation', app?: { __typename?: 'AppType', id: string } | null } | null };

export type CreateNewAwsSecretsSyncMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  path: Scalars['String']['input'];
  credentialId: Scalars['ID']['input'];
  secretName: Scalars['String']['input'];
  kmsId?: InputMaybe<Scalars['String']['input']>;
}>;


export type CreateNewAwsSecretsSyncMutation = { __typename?: 'Mutation', createAwsSecretSync?: { __typename?: 'CreateAWSSecretsManagerSync', sync?: { __typename?: 'EnvironmentSyncType', id: string, isActive: boolean, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', name?: string | null } | null } | null } | null };

export type CreateNewCfPagesSyncMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  path: Scalars['String']['input'];
  projectName: Scalars['String']['input'];
  deploymentId: Scalars['ID']['input'];
  projectEnv: Scalars['String']['input'];
  credentialId: Scalars['ID']['input'];
}>;


export type CreateNewCfPagesSyncMutation = { __typename?: 'Mutation', createCloudflarePagesSync?: { __typename?: 'CreateCloudflarePagesSync', sync?: { __typename?: 'EnvironmentSyncType', id: string, isActive: boolean, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null } | null };

export type DeleteProviderCredsMutationVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type DeleteProviderCredsMutation = { __typename?: 'Mutation', deleteProviderCredentials?: { __typename?: 'DeleteProviderCredentials', ok?: boolean | null } | null };

export type DeleteSyncMutationVariables = Exact<{
  syncId: Scalars['ID']['input'];
}>;


export type DeleteSyncMutation = { __typename?: 'Mutation', deleteEnvSync?: { __typename?: 'DeleteSync', ok?: boolean | null } | null };

export type CreateNewGhActionsSyncMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  path: Scalars['String']['input'];
  repoName: Scalars['String']['input'];
  owner: Scalars['String']['input'];
  credentialId: Scalars['ID']['input'];
}>;


export type CreateNewGhActionsSyncMutation = { __typename?: 'Mutation', createGhActionsSync?: { __typename?: 'CreateGitHubActionsSync', sync?: { __typename?: 'EnvironmentSyncType', id: string, isActive: boolean, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null } | null };

export type InitAppSyncingMutationVariables = Exact<{
  appId: Scalars['ID']['input'];
  envKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>> | InputMaybe<EnvironmentKeyInput>>;
}>;


export type InitAppSyncingMutation = { __typename?: 'Mutation', initEnvSync?: { __typename?: 'InitEnvSync', app?: { __typename?: 'AppType', id: string, syncEnabled?: boolean | null } | null } | null };

export type SaveNewProviderCredsMutationVariables = Exact<{
  orgId: Scalars['ID']['input'];
  provider: Scalars['String']['input'];
  name: Scalars['String']['input'];
  credentials: Scalars['JSONString']['input'];
}>;


export type SaveNewProviderCredsMutation = { __typename?: 'Mutation', createProviderCredentials?: { __typename?: 'CreateProviderCredentials', credential?: { __typename?: 'ProviderCredentialsType', id: string } | null } | null };

export type ToggleSyncMutationVariables = Exact<{
  syncId: Scalars['ID']['input'];
}>;


export type ToggleSyncMutation = { __typename?: 'Mutation', toggleSyncActive?: { __typename?: 'ToggleSyncActive', ok?: boolean | null } | null };

export type TriggerEnvSyncMutationVariables = Exact<{
  syncId: Scalars['ID']['input'];
}>;


export type TriggerEnvSyncMutation = { __typename?: 'Mutation', triggerSync?: { __typename?: 'TriggerSync', sync?: { __typename?: 'EnvironmentSyncType', status: ApiEnvironmentSyncStatusChoices } | null } | null };

export type UpdateProviderCredsMutationVariables = Exact<{
  credentialId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  credentials: Scalars['JSONString']['input'];
}>;


export type UpdateProviderCredsMutation = { __typename?: 'Mutation', updateProviderCredentials?: { __typename?: 'UpdateProviderCredentials', credential?: { __typename?: 'ProviderCredentialsType', id: string } | null } | null };

export type UpdateSyncAuthMutationVariables = Exact<{
  syncId: Scalars['ID']['input'];
  credentialId: Scalars['ID']['input'];
}>;


export type UpdateSyncAuthMutation = { __typename?: 'Mutation', updateSyncAuthentication?: { __typename?: 'UpdateSyncAuthentication', sync?: { __typename?: 'EnvironmentSyncType', id: string, status: ApiEnvironmentSyncStatusChoices } | null } | null };

export type CreateNewVaultSyncMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  path: Scalars['String']['input'];
  engine: Scalars['String']['input'];
  vaultPath: Scalars['String']['input'];
  credentialId: Scalars['ID']['input'];
}>;


export type CreateNewVaultSyncMutation = { __typename?: 'Mutation', createVaultSync?: { __typename?: 'CreateVaultSync', sync?: { __typename?: 'EnvironmentSyncType', id: string, isActive: boolean, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null } | null };

export type CreateNewUserTokenMutationVariables = Exact<{
  orgId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  identityKey: Scalars['String']['input'];
  token: Scalars['String']['input'];
  wrappedKeyShare: Scalars['String']['input'];
  expiry?: InputMaybe<Scalars['BigInt']['input']>;
}>;


export type CreateNewUserTokenMutation = { __typename?: 'Mutation', createUserToken?: { __typename?: 'CreateUserTokenMutation', ok?: boolean | null } | null };

export type RevokeUserTokenMutationVariables = Exact<{
  tokenId: Scalars['ID']['input'];
}>;


export type RevokeUserTokenMutation = { __typename?: 'Mutation', deleteUserToken?: { __typename?: 'DeleteUserTokenMutation', ok?: boolean | null } | null };

export type GetAppMembersQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
}>;


export type GetAppMembersQuery = { __typename?: 'Query', appUsers?: Array<{ __typename?: 'OrganisationMemberType', id: string, identityKey?: string | null, email?: string | null, fullName?: string | null, avatarUrl?: string | null, createdAt?: any | null, role: ApiOrganisationMemberRoleChoices } | null> | null };

export type GetAppActivityChartQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
  period?: InputMaybe<TimeRange>;
}>;


export type GetAppActivityChartQuery = { __typename?: 'Query', appActivityChart?: Array<{ __typename?: 'ChartDataPointType', index?: number | null, date?: any | null, data?: number | null } | null> | null };

export type GetAppDetailQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  appId: Scalars['ID']['input'];
}>;


export type GetAppDetailQuery = { __typename?: 'Query', apps?: Array<{ __typename?: 'AppType', id: string, name: string, identityKey: string, createdAt?: any | null, appToken: string, appSeed: string, appVersion: number } | null> | null };

export type GetAppKmsLogsQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
  start?: InputMaybe<Scalars['BigInt']['input']>;
  end?: InputMaybe<Scalars['BigInt']['input']>;
}>;


export type GetAppKmsLogsQuery = { __typename?: 'Query', kmsLogsCount?: number | null, logs?: { __typename?: 'LogsResponseType', kms?: Array<{ __typename?: 'KMSLogType', id: string, timestamp?: any | null, phaseNode?: string | null, eventType?: string | null, ipAddress?: string | null, country?: string | null, city?: string | null, phSize?: number | null } | null> | null } | null };

export type GetAppsQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  appId?: InputMaybe<Scalars['ID']['input']>;
}>;


export type GetAppsQuery = { __typename?: 'Query', apps?: Array<{ __typename?: 'AppType', id: string, name: string, identityKey: string, createdAt?: any | null, syncEnabled?: boolean | null } | null> | null };

export type GetDashboardQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetDashboardQuery = { __typename?: 'Query', apps?: Array<{ __typename?: 'AppType', id: string, syncEnabled?: boolean | null } | null> | null, userTokens?: Array<{ __typename?: 'UserTokenType', id: string } | null> | null, organisationInvites?: Array<{ __typename?: 'OrganisationMemberInviteType', id: string } | null> | null, organisationMembers?: Array<{ __typename?: 'OrganisationMemberType', id: string } | null> | null, savedCredentials?: Array<{ __typename?: 'ProviderCredentialsType', id: string } | null> | null, syncs?: Array<{ __typename?: 'EnvironmentSyncType', id: string } | null> | null };

export type GetOrganisationsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetOrganisationsQuery = { __typename?: 'Query', organisations?: Array<{ __typename?: 'OrganisationType', id: string, name: string, identityKey: string, createdAt?: any | null, plan: ApiOrganisationPlanChoices, role?: string | null, memberId?: string | null, keyring?: string | null, recovery?: string | null } | null> | null };

export type GetInvitesQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
}>;


export type GetInvitesQuery = { __typename?: 'Query', organisationInvites?: Array<{ __typename?: 'OrganisationMemberInviteType', id: string, createdAt?: any | null, expiresAt: any, inviteeEmail: string, invitedBy: { __typename?: 'OrganisationMemberType', email?: string | null, fullName?: string | null, self?: boolean | null } } | null> | null };

export type GetOrganisationAdminsAndSelfQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetOrganisationAdminsAndSelfQuery = { __typename?: 'Query', organisationAdminsAndSelf?: Array<{ __typename?: 'OrganisationMemberType', id: string, role: ApiOrganisationMemberRoleChoices, identityKey?: string | null, self?: boolean | null } | null> | null };

export type GetOrganisationMembersQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  role?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>> | InputMaybe<Scalars['String']['input']>>;
}>;


export type GetOrganisationMembersQuery = { __typename?: 'Query', organisationMembers?: Array<{ __typename?: 'OrganisationMemberType', id: string, role: ApiOrganisationMemberRoleChoices, identityKey?: string | null, email?: string | null, fullName?: string | null, avatarUrl?: string | null, createdAt?: any | null, self?: boolean | null } | null> | null };

export type VerifyInviteQueryVariables = Exact<{
  inviteId: Scalars['ID']['input'];
}>;


export type VerifyInviteQuery = { __typename?: 'Query', validateInvite?: { __typename?: 'OrganisationMemberInviteType', id: string, inviteeEmail: string, organisation: { __typename?: 'OrganisationType', id: string, name: string }, invitedBy: { __typename?: 'OrganisationMemberType', email?: string | null }, apps: Array<{ __typename?: 'AppType', id: string, name: string }> } | null };

export type GetAppEnvironmentsQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
  memberId?: InputMaybe<Scalars['ID']['input']>;
}>;


export type GetAppEnvironmentsQuery = { __typename?: 'Query', appEnvironments?: Array<{ __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices, identityKey: string, wrappedSeed: string, wrappedSalt: string, createdAt?: any | null, app: { __typename?: 'AppType', name: string } } | null> | null };

export type GetAppSecretsLogsQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
  start?: InputMaybe<Scalars['BigInt']['input']>;
  end?: InputMaybe<Scalars['BigInt']['input']>;
}>;


export type GetAppSecretsLogsQuery = { __typename?: 'Query', secretsLogsCount?: number | null, logs?: { __typename?: 'LogsResponseType', secrets?: Array<{ __typename?: 'SecretEventType', id: string, key: string, value: string, version: number, comment: string, timestamp: any, ipAddress?: string | null, userAgent?: string | null, eventType: ApiSecretEventEventTypeChoices, tags: Array<{ __typename?: 'SecretTagType', id: string, name: string, color: string }>, user?: { __typename?: 'OrganisationMemberType', email?: string | null, username?: string | null, fullName?: string | null, avatarUrl?: string | null } | null, environment: { __typename?: 'EnvironmentType', id: string, envType: ApiEnvironmentEnvTypeChoices, name: string }, secret: { __typename?: 'SecretType', id: string, path: string } } | null> | null } | null, environmentKeys?: Array<{ __typename?: 'EnvironmentKeyType', id: string, identityKey: string, wrappedSeed: string, wrappedSalt: string, environment: { __typename?: 'EnvironmentType', id: string } } | null> | null };

export type GetEnvironmentKeyQueryVariables = Exact<{
  envId: Scalars['ID']['input'];
  appId: Scalars['ID']['input'];
}>;


export type GetEnvironmentKeyQuery = { __typename?: 'Query', environmentKeys?: Array<{ __typename?: 'EnvironmentKeyType', id: string, identityKey: string, wrappedSeed: string, wrappedSalt: string } | null> | null };

export type GetEnvironmentTokensQueryVariables = Exact<{
  envId: Scalars['ID']['input'];
}>;


export type GetEnvironmentTokensQuery = { __typename?: 'Query', environmentTokens?: Array<{ __typename?: 'EnvironmentTokenType', id: string, name: string, wrappedKeyShare: string, createdAt?: any | null } | null> | null };

export type GetFoldersQueryVariables = Exact<{
  envId: Scalars['ID']['input'];
  path?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetFoldersQuery = { __typename?: 'Query', folders?: Array<{ __typename?: 'SecretFolderType', id: string, name: string, path: string, createdAt?: any | null, folderCount?: number | null, secretCount?: number | null } | null> | null };

export type GetEnvSecretsKvQueryVariables = Exact<{
  envId: Scalars['ID']['input'];
}>;


export type GetEnvSecretsKvQuery = { __typename?: 'Query', folders?: Array<{ __typename?: 'SecretFolderType', id: string, name: string } | null> | null, secrets?: Array<{ __typename?: 'SecretType', id: string, key: string, value: string, path: string } | null> | null, environmentKeys?: Array<{ __typename?: 'EnvironmentKeyType', id: string, identityKey: string, wrappedSeed: string, wrappedSalt: string } | null> | null };

export type GetSecretTagsQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
}>;


export type GetSecretTagsQuery = { __typename?: 'Query', secretTags?: Array<{ __typename?: 'SecretTagType', id: string, name: string, color: string } | null> | null };

export type GetSecretsQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
  envId: Scalars['ID']['input'];
  path?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetSecretsQuery = { __typename?: 'Query', secrets?: Array<{ __typename?: 'SecretType', id: string, key: string, value: string, comment: string, createdAt?: any | null, tags: Array<{ __typename?: 'SecretTagType', id: string, name: string, color: string }>, history?: Array<{ __typename?: 'SecretEventType', id: string, key: string, value: string, version: number, comment: string, timestamp: any, ipAddress?: string | null, userAgent?: string | null, eventType: ApiSecretEventEventTypeChoices, tags: Array<{ __typename?: 'SecretTagType', id: string, name: string, color: string }>, user?: { __typename?: 'OrganisationMemberType', email?: string | null, username?: string | null, fullName?: string | null, avatarUrl?: string | null } | null } | null> | null, override?: { __typename?: 'PersonalSecretType', value?: string | null, isActive: boolean } | null } | null> | null, folders?: Array<{ __typename?: 'SecretFolderType', id: string, name: string, path: string, createdAt?: any | null, folderCount?: number | null, secretCount?: number | null } | null> | null, appEnvironments?: Array<{ __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices, identityKey: string } | null> | null, environmentKeys?: Array<{ __typename?: 'EnvironmentKeyType', id: string, identityKey: string, wrappedSeed: string, wrappedSalt: string } | null> | null, envSyncs?: Array<{ __typename?: 'EnvironmentSyncType', id: string, options: any, isActive: boolean, status: ApiEnvironmentSyncStatusChoices, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null> | null };

export type GetServiceTokensQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
}>;


export type GetServiceTokensQuery = { __typename?: 'Query', serviceTokens?: Array<{ __typename?: 'ServiceTokenType', id: string, name: string, createdAt?: any | null, expiresAt?: any | null, createdBy?: { __typename?: 'OrganisationMemberType', fullName?: string | null, avatarUrl?: string | null, self?: boolean | null } | null, keys: Array<{ __typename?: 'ServerEnvironmentKeyType', id: string, identityKey: string }> } | null> | null };

export type GetOrganisationSyncsQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
}>;


export type GetOrganisationSyncsQuery = { __typename?: 'Query', syncs?: Array<{ __typename?: 'EnvironmentSyncType', id: string, path: string, options: any, isActive: boolean, lastSync?: any | null, status: ApiEnvironmentSyncStatusChoices, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices, app: { __typename?: 'AppType', id: string, name: string } }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null, provider?: { __typename?: 'ProviderType', id: string } | null } | null, authentication?: { __typename?: 'ProviderCredentialsType', id: string, name: string, credentials: any } | null, history: Array<{ __typename?: 'EnvironmentSyncEventType', id: string, status: ApiEnvironmentSyncEventStatusChoices, createdAt?: any | null, completedAt?: any | null, meta?: any | null }> } | null> | null };

export type GetAwsSecretsQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type GetAwsSecretsQuery = { __typename?: 'Query', awsSecrets?: Array<{ __typename?: 'AWSSecretType', name?: string | null, arn?: string | null } | null> | null };

export type GetCfPagesQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type GetCfPagesQuery = { __typename?: 'Query', cloudflarePagesProjects?: Array<{ __typename?: 'CloudFlarePagesType', name?: string | null, deploymentId?: string | null, environments?: Array<string | null> | null } | null> | null };

export type GetAppSyncStatusQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
}>;


export type GetAppSyncStatusQuery = { __typename?: 'Query', syncEnabled?: boolean | null, serverPublicKey?: string | null, syncs?: Array<{ __typename?: 'EnvironmentSyncType', id: string, path: string, options: any, isActive: boolean, lastSync?: any | null, status: ApiEnvironmentSyncStatusChoices, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices, app: { __typename?: 'AppType', id: string, name: string } }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null, provider?: { __typename?: 'ProviderType', id: string } | null } | null, authentication?: { __typename?: 'ProviderCredentialsType', id: string, name: string, credentials: any } | null, history: Array<{ __typename?: 'EnvironmentSyncEventType', id: string, status: ApiEnvironmentSyncEventStatusChoices, createdAt?: any | null, completedAt?: any | null, meta?: any | null }> } | null> | null };

export type GetProviderListQueryVariables = Exact<{ [key: string]: never; }>;


export type GetProviderListQuery = { __typename?: 'Query', serverPublicKey?: string | null, providers?: Array<{ __typename?: 'ProviderType', id: string, name: string, expectedCredentials: Array<string>, optionalCredentials: Array<string>, authScheme?: string | null } | null> | null };

export type GetSavedCredentialsQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
}>;


export type GetSavedCredentialsQuery = { __typename?: 'Query', savedCredentials?: Array<{ __typename?: 'ProviderCredentialsType', id: string, name: string, credentials: any, createdAt?: any | null, syncCount?: number | null, provider?: { __typename?: 'ProviderType', id: string, name: string, expectedCredentials: Array<string>, optionalCredentials: Array<string> } | null } | null> | null };

export type GetServerKeyQueryVariables = Exact<{ [key: string]: never; }>;


export type GetServerKeyQuery = { __typename?: 'Query', serverPublicKey?: string | null };

export type GetServiceListQueryVariables = Exact<{ [key: string]: never; }>;


export type GetServiceListQuery = { __typename?: 'Query', services?: Array<{ __typename?: 'ServiceType', id?: string | null, name?: string | null, provider?: { __typename?: 'ProviderType', id: string } | null } | null> | null };

export type GetGithubReposQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type GetGithubReposQuery = { __typename?: 'Query', githubRepos?: Array<{ __typename?: 'GitHubRepoType', name?: string | null, owner?: string | null, type?: string | null } | null> | null };

export type TestVaultAuthQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type TestVaultAuthQuery = { __typename?: 'Query', testVaultCreds?: boolean | null };

export type GetUserTokensQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetUserTokensQuery = { __typename?: 'Query', userTokens?: Array<{ __typename?: 'UserTokenType', id: string, name: string, wrappedKeyShare: string, createdAt?: any | null, expiresAt?: any | null } | null> | null };


export const AddMemberToAppDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddMemberToApp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addAppMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"envKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envKeys"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<AddMemberToAppMutation, AddMemberToAppMutationVariables>;
export const RemoveMemberFromAppDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveMemberFromApp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeAppMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<RemoveMemberFromAppMutation, RemoveMemberFromAppMutationVariables>;
export const UpdateEnvScopeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateEnvScope"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateMemberEnvironmentScope"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"envKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envKeys"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateEnvScopeMutation, UpdateEnvScopeMutationVariables>;
export const CreateApplicationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateApplication"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appToken"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appSeed"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appVersion"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createApp"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"appToken"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appToken"}}},{"kind":"Argument","name":{"kind":"Name","value":"appSeed"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appSeed"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyShare"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}}},{"kind":"Argument","name":{"kind":"Name","value":"appVersion"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appVersion"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}}]}}]}}]} as unknown as DocumentNode<CreateApplicationMutation, CreateApplicationMutationVariables>;
export const CreateOrgDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateOrg"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyring"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedRecovery"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOrganisation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyring"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyring"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedRecovery"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedRecovery"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateOrgMutation, CreateOrgMutationVariables>;
export const DeleteApplicationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteApplication"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteApp"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteApplicationMutation, DeleteApplicationMutationVariables>;
export const CreateEnvDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateEnv"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createEnvironment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}}]}}]}}]} as unknown as DocumentNode<CreateEnvMutation, CreateEnvMutationVariables>;
export const CreateEnvKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateEnvKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedSeed"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedSalt"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createEnvironmentKey"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedSeed"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedSeed"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedSalt"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedSalt"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environmentKey"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateEnvKeyMutation, CreateEnvKeyMutationVariables>;
export const CreateEnvTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateEnvToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"token"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createEnvironmentToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"token"},"value":{"kind":"Variable","name":{"kind":"Name","value":"token"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyShare"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environmentToken"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateEnvTokenMutation, CreateEnvTokenMutationVariables>;
export const CreateNewSecretFolderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewSecretFolder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSecretFolder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"folder"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"path"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewSecretFolderMutation, CreateNewSecretFolderMutationVariables>;
export const CreateNewPersonalSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewPersonalSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"newPersonalSecret"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PersonalSecretInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOverride"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"overrideData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"newPersonalSecret"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"override"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"secret"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewPersonalSecretMutation, CreateNewPersonalSecretMutationVariables>;
export const CreateNewSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"newSecret"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SecretInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"secretData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"newSecret"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secret"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewSecretMutation, CreateNewSecretMutationVariables>;
export const CreateNewSecretTagDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewSecretTag"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"color"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSecretTag"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"color"},"value":{"kind":"Variable","name":{"kind":"Name","value":"color"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tag"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewSecretTagMutation, CreateNewSecretTagMutationVariables>;
export const CreateNewServiceTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewServiceToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"environmentKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"token"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"expiry"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createServiceToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"environmentKeys"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"token"},"value":{"kind":"Variable","name":{"kind":"Name","value":"token"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyShare"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"expiry"},"value":{"kind":"Variable","name":{"kind":"Name","value":"expiry"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceToken"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewServiceTokenMutation, CreateNewServiceTokenMutationVariables>;
export const DeleteFolderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteFolder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"folderId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSecretFolder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"folderId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"folderId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteFolderMutation, DeleteFolderMutationVariables>;
export const DeleteSecretOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSecretOp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secret"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<DeleteSecretOpMutation, DeleteSecretOpMutationVariables>;
export const RevokeServiceTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeServiceToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tokenId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteServiceToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tokenId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tokenId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<RevokeServiceTokenMutation, RevokeServiceTokenMutationVariables>;
export const UpdateSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretData"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SecretInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"editSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"secretData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretData"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secret"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateSecretMutation, UpdateSecretMutationVariables>;
export const InitAppEnvironmentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"InitAppEnvironments"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"devEnv"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"stagingEnv"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"prodEnv"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"devAdminKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"stagAdminKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"prodAdminKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"devEnvironment"},"name":{"kind":"Name","value":"createEnvironment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"devEnv"}}},{"kind":"Argument","name":{"kind":"Name","value":"adminKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"devAdminKeys"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}}]}},{"kind":"Field","alias":{"kind":"Name","value":"stagingEnvironment"},"name":{"kind":"Name","value":"createEnvironment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"stagingEnv"}}},{"kind":"Argument","name":{"kind":"Name","value":"adminKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"stagAdminKeys"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}}]}},{"kind":"Field","alias":{"kind":"Name","value":"prodEnvironment"},"name":{"kind":"Name","value":"createEnvironment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"prodEnv"}}},{"kind":"Argument","name":{"kind":"Name","value":"adminKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"prodAdminKeys"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}}]}}]}}]} as unknown as DocumentNode<InitAppEnvironmentsMutation, InitAppEnvironmentsMutationVariables>;
export const LogSecretReadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LogSecretRead"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"readSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<LogSecretReadMutation, LogSecretReadMutationVariables>;
export const RemovePersonalSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemovePersonalSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeOverride"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"secretId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<RemovePersonalSecretMutation, RemovePersonalSecretMutationVariables>;
export const AcceptOrganisationInviteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AcceptOrganisationInvite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyring"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedRecovery"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"inviteId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOrganisationMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyring"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyring"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedRecovery"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedRecovery"}}},{"kind":"Argument","name":{"kind":"Name","value":"inviteId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"inviteId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orgMember"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"role"}}]}}]}}]}}]} as unknown as DocumentNode<AcceptOrganisationInviteMutation, AcceptOrganisationInviteMutationVariables>;
export const DeleteOrgInviteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteOrgInvite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"inviteId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteInvitation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"inviteId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"inviteId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteOrgInviteMutation, DeleteOrgInviteMutationVariables>;
export const RemoveMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteOrganisationMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<RemoveMemberMutation, RemoveMemberMutationVariables>;
export const InviteMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"InviteMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"email"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"apps"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"role"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inviteOrganisationMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"email"},"value":{"kind":"Variable","name":{"kind":"Name","value":"email"}}},{"kind":"Argument","name":{"kind":"Name","value":"apps"},"value":{"kind":"Variable","name":{"kind":"Name","value":"apps"}}},{"kind":"Argument","name":{"kind":"Name","value":"role"},"value":{"kind":"Variable","name":{"kind":"Name","value":"role"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"invite"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<InviteMemberMutation, InviteMemberMutationVariables>;
export const UpdateMemberRoleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateMemberRole"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"role"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateOrganisationMemberRole"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}},{"kind":"Argument","name":{"kind":"Name","value":"role"},"value":{"kind":"Variable","name":{"kind":"Name","value":"role"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orgMember"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateMemberRoleMutation, UpdateMemberRoleMutationVariables>;
export const UpdateWrappedSecretsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateWrappedSecrets"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyring"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedRecovery"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateMemberWrappedSecrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyring"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyring"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedRecovery"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedRecovery"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orgMember"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateWrappedSecretsMutation, UpdateWrappedSecretsMutationVariables>;
export const RotateAppKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RotateAppKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appToken"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rotateAppKeys"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"appToken"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appToken"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyShare"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<RotateAppKeyMutation, RotateAppKeyMutationVariables>;
export const CreateNewAwsSecretsSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewAWSSecretsSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"kmsId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAwsSecretSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}},{"kind":"Argument","name":{"kind":"Name","value":"secretName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretName"}}},{"kind":"Argument","name":{"kind":"Name","value":"kmsId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"kmsId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewAwsSecretsSyncMutation, CreateNewAwsSecretsSyncMutationVariables>;
export const CreateNewCfPagesSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewCfPagesSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"deploymentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectEnv"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createCloudflarePagesSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"projectName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectName"}}},{"kind":"Argument","name":{"kind":"Name","value":"deploymentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"deploymentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"projectEnv"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectEnv"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewCfPagesSyncMutation, CreateNewCfPagesSyncMutationVariables>;
export const DeleteProviderCredsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteProviderCreds"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteProviderCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteProviderCredsMutation, DeleteProviderCredsMutationVariables>;
export const DeleteSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteEnvSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"syncId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteSyncMutation, DeleteSyncMutationVariables>;
export const CreateNewGhActionsSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewGhActionsSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"repoName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"owner"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createGhActionsSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"repoName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"repoName"}}},{"kind":"Argument","name":{"kind":"Name","value":"owner"},"value":{"kind":"Variable","name":{"kind":"Name","value":"owner"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewGhActionsSyncMutation, CreateNewGhActionsSyncMutationVariables>;
export const InitAppSyncingDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"InitAppSyncing"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"initEnvSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"envKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envKeys"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"syncEnabled"}}]}}]}}]}}]} as unknown as DocumentNode<InitAppSyncingMutation, InitAppSyncingMutationVariables>;
export const SaveNewProviderCredsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SaveNewProviderCreds"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"provider"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"JSONString"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createProviderCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"provider"},"value":{"kind":"Variable","name":{"kind":"Name","value":"provider"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentials"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"credential"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<SaveNewProviderCredsMutation, SaveNewProviderCredsMutationVariables>;
export const ToggleSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ToggleSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"toggleSyncActive"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"syncId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<ToggleSyncMutation, ToggleSyncMutationVariables>;
export const TriggerEnvSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"TriggerEnvSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"triggerSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"syncId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]} as unknown as DocumentNode<TriggerEnvSyncMutation, TriggerEnvSyncMutationVariables>;
export const UpdateProviderCredsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProviderCreds"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"JSONString"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProviderCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentials"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"credential"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateProviderCredsMutation, UpdateProviderCredsMutationVariables>;
export const UpdateSyncAuthDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSyncAuth"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateSyncAuthentication"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"syncId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateSyncAuthMutation, UpdateSyncAuthMutationVariables>;
export const CreateNewVaultSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewVaultSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"engine"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"vaultPath"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createVaultSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"engine"},"value":{"kind":"Variable","name":{"kind":"Name","value":"engine"}}},{"kind":"Argument","name":{"kind":"Name","value":"vaultPath"},"value":{"kind":"Variable","name":{"kind":"Name","value":"vaultPath"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewVaultSyncMutation, CreateNewVaultSyncMutationVariables>;
export const CreateNewUserTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewUserToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"token"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"expiry"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"token"},"value":{"kind":"Variable","name":{"kind":"Name","value":"token"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyShare"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}}},{"kind":"Argument","name":{"kind":"Name","value":"expiry"},"value":{"kind":"Variable","name":{"kind":"Name","value":"expiry"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<CreateNewUserTokenMutation, CreateNewUserTokenMutationVariables>;
export const RevokeUserTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeUserToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tokenId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tokenId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tokenId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<RevokeUserTokenMutation, RevokeUserTokenMutationVariables>;
export const GetAppMembersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppMembers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"appUsers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"role"}}]}}]}}]} as unknown as DocumentNode<GetAppMembersQuery, GetAppMembersQueryVariables>;
export const GetAppActivityChartDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppActivityChart"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"period"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"TimeRange"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"appActivityChart"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"period"},"value":{"kind":"Variable","name":{"kind":"Name","value":"period"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"index"}},{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"data"}}]}}]}}]} as unknown as DocumentNode<GetAppActivityChartQuery, GetAppActivityChartQueryVariables>;
export const GetAppDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"appToken"}},{"kind":"Field","name":{"kind":"Name","value":"appSeed"}},{"kind":"Field","name":{"kind":"Name","value":"appVersion"}}]}}]}}]} as unknown as DocumentNode<GetAppDetailQuery, GetAppDetailQueryVariables>;
export const GetAppKmsLogsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppKmsLogs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"start"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"end"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"logs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"start"},"value":{"kind":"Variable","name":{"kind":"Name","value":"start"}}},{"kind":"Argument","name":{"kind":"Name","value":"end"},"value":{"kind":"Variable","name":{"kind":"Name","value":"end"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"phaseNode"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"ipAddress"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"city"}},{"kind":"Field","name":{"kind":"Name","value":"phSize"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"kmsLogsCount"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}]}]}}]} as unknown as DocumentNode<GetAppKmsLogsQuery, GetAppKmsLogsQueryVariables>;
export const GetAppsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetApps"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"syncEnabled"}}]}}]}}]} as unknown as DocumentNode<GetAppsQuery, GetAppsQueryVariables>;
export const GetDashboardDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetDashboard"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"syncEnabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userTokens"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"organisationInvites"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"organisationMembers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"role"},"value":{"kind":"NullValue"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"savedCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"syncs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<GetDashboardQuery, GetDashboardQueryVariables>;
export const GetOrganisationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOrganisations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"memberId"}},{"kind":"Field","name":{"kind":"Name","value":"keyring"}},{"kind":"Field","name":{"kind":"Name","value":"recovery"}}]}}]}}]} as unknown as DocumentNode<GetOrganisationsQuery, GetOrganisationsQueryVariables>;
export const GetInvitesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetInvites"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisationInvites"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"invitedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}},{"kind":"Field","name":{"kind":"Name","value":"inviteeEmail"}}]}}]}}]} as unknown as DocumentNode<GetInvitesQuery, GetInvitesQueryVariables>;
export const GetOrganisationAdminsAndSelfDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOrganisationAdminsAndSelf"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisationAdminsAndSelf"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}}]}}]} as unknown as DocumentNode<GetOrganisationAdminsAndSelfQuery, GetOrganisationAdminsAndSelfQueryVariables>;
export const GetOrganisationMembersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOrganisationMembers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"role"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisationMembers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"role"},"value":{"kind":"Variable","name":{"kind":"Name","value":"role"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}}]}}]} as unknown as DocumentNode<GetOrganisationMembersQuery, GetOrganisationMembersQueryVariables>;
export const VerifyInviteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"VerifyInvite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"inviteId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"validateInvite"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"inviteId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"inviteId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"organisation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"inviteeEmail"}},{"kind":"Field","name":{"kind":"Name","value":"invitedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}}]}},{"kind":"Field","name":{"kind":"Name","value":"apps"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<VerifyInviteQuery, VerifyInviteQueryVariables>;
export const GetAppEnvironmentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppEnvironments"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"appEnvironments"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"NullValue"}},{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<GetAppEnvironmentsQuery, GetAppEnvironmentsQueryVariables>;
export const GetAppSecretsLogsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppSecretsLogs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"start"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"end"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"logs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"start"},"value":{"kind":"Variable","name":{"kind":"Name","value":"start"}}},{"kind":"Argument","name":{"kind":"Name","value":"end"},"value":{"kind":"Variable","name":{"kind":"Name","value":"end"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secrets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"tags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"ipAddress"}},{"kind":"Field","name":{"kind":"Name","value":"userAgent"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"username"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"secret"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"path"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"secretsLogsCount"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}]},{"kind":"Field","name":{"kind":"Name","value":"environmentKeys"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<GetAppSecretsLogsQuery, GetAppSecretsLogsQueryVariables>;
export const GetEnvironmentKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetEnvironmentKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environmentKeys"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}}]}}]}}]} as unknown as DocumentNode<GetEnvironmentKeyQuery, GetEnvironmentKeyQueryVariables>;
export const GetEnvironmentTokensDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetEnvironmentTokens"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environmentTokens"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedKeyShare"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<GetEnvironmentTokensQuery, GetEnvironmentTokensQueryVariables>;
export const GetFoldersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetFolders"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"folders"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"folderCount"}},{"kind":"Field","name":{"kind":"Name","value":"secretCount"}}]}}]}}]} as unknown as DocumentNode<GetFoldersQuery, GetFoldersQueryVariables>;
export const GetEnvSecretsKvDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetEnvSecretsKV"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"folders"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"StringValue","value":"/","block":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"secrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"StringValue","value":"/","block":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"path"}}]}},{"kind":"Field","name":{"kind":"Name","value":"environmentKeys"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}}]}}]}}]} as unknown as DocumentNode<GetEnvSecretsKvQuery, GetEnvSecretsKvQueryVariables>;
export const GetSecretTagsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetSecretTags"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secretTags"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}}]}}]} as unknown as DocumentNode<GetSecretTagsQuery, GetSecretTagsQueryVariables>;
export const GetSecretsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetSecrets"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"tags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"tags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"ipAddress"}},{"kind":"Field","name":{"kind":"Name","value":"userAgent"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"username"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"override"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"folders"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"folderCount"}},{"kind":"Field","name":{"kind":"Name","value":"secretCount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"appEnvironments"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}},{"kind":"Field","name":{"kind":"Name","value":"environmentKeys"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"envSyncs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"options"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<GetSecretsQuery, GetSecretsQueryVariables>;
export const GetServiceTokensDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetServiceTokens"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceTokens"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"keys"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}}]}}]}}]} as unknown as DocumentNode<GetServiceTokensQuery, GetServiceTokensQueryVariables>;
export const GetOrganisationSyncsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOrganisationSyncs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"syncs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}},{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"provider"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"options"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"authentication"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"credentials"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"meta"}}]}}]}}]}}]} as unknown as DocumentNode<GetOrganisationSyncsQuery, GetOrganisationSyncsQueryVariables>;
export const GetAwsSecretsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAwsSecrets"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"awsSecrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"arn"}}]}}]}}]} as unknown as DocumentNode<GetAwsSecretsQuery, GetAwsSecretsQueryVariables>;
export const GetCfPagesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetCfPages"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cloudflarePagesProjects"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"deploymentId"}},{"kind":"Field","name":{"kind":"Name","value":"environments"}}]}}]}}]} as unknown as DocumentNode<GetCfPagesQuery, GetCfPagesQueryVariables>;
export const GetAppSyncStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppSyncStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"syncEnabled"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}]},{"kind":"Field","name":{"kind":"Name","value":"syncs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}},{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"provider"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"options"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"authentication"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"credentials"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"meta"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"serverPublicKey"}}]}}]} as unknown as DocumentNode<GetAppSyncStatusQuery, GetAppSyncStatusQueryVariables>;
export const GetProviderListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetProviderList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"providers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"expectedCredentials"}},{"kind":"Field","name":{"kind":"Name","value":"optionalCredentials"}},{"kind":"Field","name":{"kind":"Name","value":"authScheme"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serverPublicKey"}}]}}]} as unknown as DocumentNode<GetProviderListQuery, GetProviderListQueryVariables>;
export const GetSavedCredentialsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetSavedCredentials"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"savedCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"credentials"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"provider"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"expectedCredentials"}},{"kind":"Field","name":{"kind":"Name","value":"optionalCredentials"}}]}},{"kind":"Field","name":{"kind":"Name","value":"syncCount"}}]}}]}}]} as unknown as DocumentNode<GetSavedCredentialsQuery, GetSavedCredentialsQueryVariables>;
export const GetServerKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetServerKey"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serverPublicKey"}}]}}]} as unknown as DocumentNode<GetServerKeyQuery, GetServerKeyQueryVariables>;
export const GetServiceListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetServiceList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"services"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"provider"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<GetServiceListQuery, GetServiceListQueryVariables>;
export const GetGithubReposDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetGithubRepos"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"githubRepos"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"owner"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}}]}}]} as unknown as DocumentNode<GetGithubReposQuery, GetGithubReposQueryVariables>;
export const TestVaultAuthDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TestVaultAuth"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"testVaultCreds"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}]}]}}]} as unknown as DocumentNode<TestVaultAuthQuery, TestVaultAuthQueryVariables>;
export const GetUserTokensDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetUserTokens"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userTokens"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedKeyShare"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}}]}}]}}]} as unknown as DocumentNode<GetUserTokensQuery, GetUserTokensQueryVariables>;