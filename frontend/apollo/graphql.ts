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
   * The `Date` scalar type represents a Date
   * value as specified by
   * [iso8601](https://en.wikipedia.org/wiki/ISO_8601).
   */
  Date: { input: any; output: any; }
  /**
   * The `DateTime` scalar type represents a DateTime
   * value as specified by
   * [iso8601](https://en.wikipedia.org/wiki/ISO_8601).
   */
  DateTime: { input: any; output: any; }
  /**
   * The `GenericScalar` scalar type represents a generic
   * GraphQL scalar value that could be:
   * String, Boolean, Int, Float, List or Object.
   */
  GenericScalar: { input: any; output: any; }
  /**
   * Allows use of a JSON String for input / output from the GraphQL schema.
   *
   * Use of this type is *not recommended* as you lose the benefits of having a defined, static
   * schema (one of the key benefits of GraphQL).
   */
  JSONString: { input: any; output: any; }
};

export type AwsConfigInput = {
  groups?: InputMaybe<Scalars['String']['input']>;
  iamPath?: InputMaybe<Scalars['String']['input']>;
  permissionBoundaryArn?: InputMaybe<Scalars['String']['input']>;
  policyArns?: InputMaybe<Scalars['String']['input']>;
  policyDocument?: InputMaybe<Scalars['GenericScalar']['input']>;
  usernameTemplate: Scalars['String']['input'];
};

export type AwsConfigType = {
  __typename?: 'AWSConfigType';
  groups?: Maybe<Scalars['String']['output']>;
  iamPath?: Maybe<Scalars['String']['output']>;
  permissionBoundaryArn?: Maybe<Scalars['String']['output']>;
  policyArns?: Maybe<Scalars['String']['output']>;
  policyDocument?: Maybe<Scalars['GenericScalar']['output']>;
  usernameTemplate: Scalars['String']['output'];
};

export type AwsSecretType = {
  __typename?: 'AWSSecretType';
  arn?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
};

export type AwsValidationResultType = {
  __typename?: 'AWSValidationResultType';
  assumedRoleArn?: Maybe<Scalars['String']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  message: Scalars['String']['output'];
  method?: Maybe<Scalars['String']['output']>;
  valid: Scalars['Boolean']['output'];
};

export type AccountPolicyInput = {
  accountId: Scalars['ID']['input'];
  accountType: AccountTypeEnum;
  policyIds?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
};

export enum AccountTypeEnum {
  Service = 'SERVICE',
  User = 'USER'
}

export type ActivatedPhaseLicenseType = {
  __typename?: 'ActivatedPhaseLicenseType';
  activatedAt: Scalars['DateTime']['output'];
  customerName: Scalars['String']['output'];
  environment: Scalars['String']['output'];
  expiresAt: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  issuedAt: Scalars['DateTime']['output'];
  issuingAuthority: Scalars['String']['output'];
  licenseType: Scalars['String']['output'];
  metadata: Scalars['JSONString']['output'];
  organisation: OrganisationType;
  plan: ApiActivatedPhaseLicensePlanChoices;
  seats?: Maybe<Scalars['Int']['output']>;
  signatureDate: Scalars['Date']['output'];
  tokens?: Maybe<Scalars['Int']['output']>;
};

export type AddAppMemberMutation = {
  __typename?: 'AddAppMemberMutation';
  app?: Maybe<AppType>;
};

/** An enumeration. */
export enum ApiActivatedPhaseLicensePlanChoices {
  /** Enterprise */
  En = 'EN',
  /** Free */
  Fr = 'FR',
  /** Pro */
  Pr = 'PR'
}

/** An enumeration. */
export enum ApiDynamicSecretLeaseEventEventTypeChoices {
  /** Active */
  Active = 'ACTIVE',
  /** Created */
  Created = 'CREATED',
  /** Expired */
  Expired = 'EXPIRED',
  /** Renewed */
  Renewed = 'RENEWED',
  /** Revoked */
  Revoked = 'REVOKED'
}

/** An enumeration. */
export enum ApiDynamicSecretLeaseStatusChoices {
  /** Active */
  Active = 'ACTIVE',
  /** Created */
  Created = 'CREATED',
  /** Expired */
  Expired = 'EXPIRED',
  /** Renewed */
  Renewed = 'RENEWED',
  /** Revoked */
  Revoked = 'REVOKED'
}

/** An enumeration. */
export enum ApiDynamicSecretProviderChoices {
  /** AWS */
  Aws = 'AWS'
}

/** An enumeration. */
export enum ApiEnvironmentEnvTypeChoices {
  /** Custom */
  Custom = 'CUSTOM',
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

export type AppMemberInputType = {
  envKeys: Array<InputMaybe<EnvironmentKeyInput>>;
  memberId: Scalars['ID']['input'];
  memberType?: InputMaybe<MemberType>;
};

export type AppMembershipType = {
  __typename?: 'AppMembershipType';
  environments: Array<Maybe<EnvironmentType>>;
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  sseEnabled: Scalars['Boolean']['output'];
};

export type AppType = {
  __typename?: 'AppType';
  appSeed: Scalars['String']['output'];
  appToken: Scalars['String']['output'];
  appVersion: Scalars['Int']['output'];
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  environments: Array<Maybe<EnvironmentType>>;
  id: Scalars['String']['output'];
  identityKey: Scalars['String']['output'];
  members: Array<Maybe<OrganisationMemberType>>;
  name: Scalars['String']['output'];
  serviceAccounts: Array<Maybe<ServiceAccountType>>;
  sseEnabled: Scalars['Boolean']['output'];
  updatedAt: Scalars['DateTime']['output'];
  wrappedKeyShare: Scalars['String']['output'];
};

export type AwsCredentialsType = {
  __typename?: 'AwsCredentialsType';
  accessKeyId?: Maybe<Scalars['String']['output']>;
  secretAccessKey?: Maybe<Scalars['String']['output']>;
  username?: Maybe<Scalars['String']['output']>;
};

export type AwsIamConfigType = {
  __typename?: 'AwsIamConfigType';
  signatureTtlSeconds?: Maybe<Scalars['Int']['output']>;
  stsEndpoint?: Maybe<Scalars['String']['output']>;
  trustedPrincipals?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
};

export enum BillingPeriodEnum {
  Monthly = 'MONTHLY',
  Yearly = 'YEARLY'
}

export type BulkAddAppMembersMutation = {
  __typename?: 'BulkAddAppMembersMutation';
  app?: Maybe<AppType>;
};

export type BulkCreateSecretMutation = {
  __typename?: 'BulkCreateSecretMutation';
  secrets?: Maybe<Array<Maybe<SecretType>>>;
};

export type BulkDeleteSecretMutation = {
  __typename?: 'BulkDeleteSecretMutation';
  secrets?: Maybe<Array<Maybe<SecretType>>>;
};

export type BulkEditSecretMutation = {
  __typename?: 'BulkEditSecretMutation';
  secrets?: Maybe<Array<Maybe<SecretType>>>;
};

export type BulkInviteOrganisationMembersMutation = {
  __typename?: 'BulkInviteOrganisationMembersMutation';
  invites?: Maybe<Array<Maybe<OrganisationMemberInviteType>>>;
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

export type CloudflareWorkerType = {
  __typename?: 'CloudflareWorkerType';
  name?: Maybe<Scalars['String']['output']>;
  scriptId?: Maybe<Scalars['String']['output']>;
};

export type CreateAwsDynamicSecretMutation = {
  __typename?: 'CreateAWSDynamicSecretMutation';
  dynamicSecret?: Maybe<DynamicSecretType>;
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

export type CreateCloudflareWorkersSync = {
  __typename?: 'CreateCloudflareWorkersSync';
  sync?: Maybe<EnvironmentSyncType>;
};

export type CreateCustomRoleMutation = {
  __typename?: 'CreateCustomRoleMutation';
  role?: Maybe<RoleType>;
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

export type CreateGitHubDependabotSync = {
  __typename?: 'CreateGitHubDependabotSync';
  sync?: Maybe<EnvironmentSyncType>;
};

export type CreateGitLabCiSync = {
  __typename?: 'CreateGitLabCISync';
  sync?: Maybe<EnvironmentSyncType>;
};

export type CreateIdentityMutation = {
  __typename?: 'CreateIdentityMutation';
  identity?: Maybe<IdentityType>;
};

export type CreateLockboxMutation = {
  __typename?: 'CreateLockboxMutation';
  lockbox?: Maybe<LockboxType>;
};

export type CreateNetworkAccessPolicyMutation = {
  __typename?: 'CreateNetworkAccessPolicyMutation';
  networkAccessPolicy?: Maybe<NetworkAccessPolicyType>;
};

export type CreateNomadSync = {
  __typename?: 'CreateNomadSync';
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

export type CreateRailwaySync = {
  __typename?: 'CreateRailwaySync';
  sync?: Maybe<EnvironmentSyncType>;
};

export type CreateRenderSync = {
  __typename?: 'CreateRenderSync';
  sync?: Maybe<EnvironmentSyncType>;
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

export type CreateServiceAccountMutation = {
  __typename?: 'CreateServiceAccountMutation';
  serviceAccount?: Maybe<ServiceAccountType>;
};

export type CreateServiceAccountTokenMutation = {
  __typename?: 'CreateServiceAccountTokenMutation';
  token?: Maybe<ServiceAccountTokenType>;
};

export type CreateServiceTokenMutation = {
  __typename?: 'CreateServiceTokenMutation';
  serviceToken?: Maybe<ServiceTokenType>;
};

export type CreateSetupIntentMutation = {
  __typename?: 'CreateSetupIntentMutation';
  clientSecret?: Maybe<Scalars['String']['output']>;
};

export type CreateSubscriptionCheckoutSession = {
  __typename?: 'CreateSubscriptionCheckoutSession';
  clientSecret?: Maybe<Scalars['String']['output']>;
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

export type CreateVercelSync = {
  __typename?: 'CreateVercelSync';
  sync?: Maybe<EnvironmentSyncType>;
};

export type DeleteAppMutation = {
  __typename?: 'DeleteAppMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteCustomRoleMutation = {
  __typename?: 'DeleteCustomRoleMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteDynamicSecretMutation = {
  __typename?: 'DeleteDynamicSecretMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteEnvironmentMutation = {
  __typename?: 'DeleteEnvironmentMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteIdentityMutation = {
  __typename?: 'DeleteIdentityMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteInviteMutation = {
  __typename?: 'DeleteInviteMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteNetworkAccessPolicyMutation = {
  __typename?: 'DeleteNetworkAccessPolicyMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteOrganisationMemberMutation = {
  __typename?: 'DeleteOrganisationMemberMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeletePaymentMethodMutation = {
  __typename?: 'DeletePaymentMethodMutation';
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

export type DeleteServiceAccountMutation = {
  __typename?: 'DeleteServiceAccountMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type DeleteServiceAccountTokenMutation = {
  __typename?: 'DeleteServiceAccountTokenMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
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

export type DynamicSecretConfigUnion = AwsConfigType;

export type DynamicSecretLeaseEventType = {
  __typename?: 'DynamicSecretLeaseEventType';
  createdAt: Scalars['DateTime']['output'];
  eventType: ApiDynamicSecretLeaseEventEventTypeChoices;
  id: Scalars['ID']['output'];
  ipAddress?: Maybe<Scalars['String']['output']>;
  lease: DynamicSecretLeaseType;
  metadata: Scalars['JSONString']['output'];
  organisationMember?: Maybe<OrganisationMemberType>;
  serviceAccount?: Maybe<ServiceAccountType>;
  userAgent?: Maybe<Scalars['String']['output']>;
};

export type DynamicSecretLeaseType = {
  __typename?: 'DynamicSecretLeaseType';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  credentials?: Maybe<LeaseCredentialsUnion>;
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  events?: Maybe<Array<Maybe<DynamicSecretLeaseEventType>>>;
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  organisationMember?: Maybe<OrganisationMemberType>;
  revokedAt?: Maybe<Scalars['DateTime']['output']>;
  secret: DynamicSecretType;
  serviceAccount?: Maybe<ServiceAccountType>;
  /** Current status of the lease */
  status: ApiDynamicSecretLeaseStatusChoices;
  ttl?: Maybe<Scalars['Int']['output']>;
};

export type DynamicSecretProviderType = {
  __typename?: 'DynamicSecretProviderType';
  configMap: Scalars['GenericScalar']['output'];
  credentials: Scalars['GenericScalar']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type DynamicSecretType = {
  __typename?: 'DynamicSecretType';
  authentication?: Maybe<ProviderCredentialsType>;
  config?: Maybe<DynamicSecretConfigUnion>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  defaultTtlSeconds?: Maybe<Scalars['Int']['output']>;
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  description: Scalars['String']['output'];
  environment: EnvironmentType;
  folder?: Maybe<SecretFolderType>;
  id: Scalars['String']['output'];
  keyMap?: Maybe<Array<Maybe<KeyMap>>>;
  leases: Array<DynamicSecretLeaseType>;
  maxTtlSeconds?: Maybe<Scalars['Int']['output']>;
  name: Scalars['String']['output'];
  path: Scalars['String']['output'];
  /** Which provider this secret is associated with. */
  provider: ApiDynamicSecretProviderChoices;
  updatedAt: Scalars['DateTime']['output'];
};

export type EditSecretMutation = {
  __typename?: 'EditSecretMutation';
  secret?: Maybe<SecretType>;
};

export type EnableServiceAccountClientSideKeyManagementMutation = {
  __typename?: 'EnableServiceAccountClientSideKeyManagementMutation';
  serviceAccount?: Maybe<ServiceAccountType>;
};

export type EnableServiceAccountServerSideKeyManagementMutation = {
  __typename?: 'EnableServiceAccountServerSideKeyManagementMutation';
  serviceAccount?: Maybe<ServiceAccountType>;
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
  app: AppMembershipType;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  dynamicSecrets: Array<Maybe<DynamicSecretType>>;
  envType: ApiEnvironmentEnvTypeChoices;
  folderCount?: Maybe<Scalars['Int']['output']>;
  folders: Array<Maybe<SecretFolderType>>;
  id: Scalars['String']['output'];
  identityKey: Scalars['String']['output'];
  index: Scalars['Int']['output'];
  members: Array<Maybe<OrganisationMemberType>>;
  name: Scalars['String']['output'];
  secretCount?: Maybe<Scalars['Int']['output']>;
  secrets: Array<Maybe<SecretType>>;
  syncs: Array<Maybe<EnvironmentSyncType>>;
  updatedAt: Scalars['DateTime']['output'];
  wrappedSalt?: Maybe<Scalars['String']['output']>;
  wrappedSeed?: Maybe<Scalars['String']['output']>;
};


export type EnvironmentTypeDynamicSecretsArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};


export type EnvironmentTypeSecretsArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};

export type GitHubOrgType = {
  __typename?: 'GitHubOrgType';
  name?: Maybe<Scalars['String']['output']>;
  role?: Maybe<Scalars['String']['output']>;
};

export type GitHubRepoType = {
  __typename?: 'GitHubRepoType';
  name?: Maybe<Scalars['String']['output']>;
  owner?: Maybe<Scalars['String']['output']>;
  type?: Maybe<Scalars['String']['output']>;
};

export type GitLabGroupType = {
  __typename?: 'GitLabGroupType';
  autoDevopsEnabled?: Maybe<Scalars['Boolean']['output']>;
  avatarUrl?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  defaultBranch?: Maybe<Scalars['String']['output']>;
  defaultBranchProtection?: Maybe<Scalars['Int']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  emailsDisabled?: Maybe<Scalars['Boolean']['output']>;
  emailsEnabled?: Maybe<Scalars['Boolean']['output']>;
  fileTemplateProjectId?: Maybe<Scalars['ID']['output']>;
  fullName?: Maybe<Scalars['String']['output']>;
  fullPath?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  lfsEnabled?: Maybe<Scalars['Boolean']['output']>;
  mentionsDisabled?: Maybe<Scalars['Boolean']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  parentId?: Maybe<Scalars['ID']['output']>;
  path?: Maybe<Scalars['String']['output']>;
  projectCreationLevel?: Maybe<Scalars['String']['output']>;
  repositoryStorage?: Maybe<Scalars['String']['output']>;
  requestAccessEnabled?: Maybe<Scalars['Boolean']['output']>;
  requireTwoFactorAuthentication?: Maybe<Scalars['Boolean']['output']>;
  shareWithGroupLock?: Maybe<Scalars['Boolean']['output']>;
  subgroupCreationLevel?: Maybe<Scalars['String']['output']>;
  twoFactorGracePeriod?: Maybe<Scalars['Int']['output']>;
  visibility?: Maybe<Scalars['String']['output']>;
  webUrl?: Maybe<Scalars['String']['output']>;
};

export type GitLabProjectType = {
  __typename?: 'GitLabProjectType';
  avatarUrl?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  defaultBranch?: Maybe<Scalars['String']['output']>;
  httpUrlToRepo?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  lastActivityAt?: Maybe<Scalars['DateTime']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  nameWithNamespace?: Maybe<Scalars['String']['output']>;
  namespace?: Maybe<NamespaceType>;
  path?: Maybe<Scalars['String']['output']>;
  pathWithNamespace?: Maybe<Scalars['String']['output']>;
  sshUrlToRepo?: Maybe<Scalars['String']['output']>;
  starCount?: Maybe<Scalars['Int']['output']>;
  tagList?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  topics?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  webUrl?: Maybe<Scalars['String']['output']>;
};

export type IdentityConfigUnion = AwsIamConfigType;

export type IdentityProviderType = {
  __typename?: 'IdentityProviderType';
  description: Scalars['String']['output'];
  iconId: Scalars['String']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  supported: Scalars['Boolean']['output'];
};

export type IdentityType = {
  __typename?: 'IdentityType';
  config?: Maybe<IdentityConfigUnion>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  defaultTtlSeconds: Scalars['Int']['output'];
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  maxTtlSeconds: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  organisation: OrganisationType;
  provider: Scalars['String']['output'];
  serviceAccounts: Array<ServiceAccountType>;
  tokenNamePattern?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type InitEnvSync = {
  __typename?: 'InitEnvSync';
  app?: Maybe<AppType>;
};

export type InviteInput = {
  apps?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  email: Scalars['String']['input'];
  roleId: Scalars['ID']['input'];
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

export type KmsLogsResponseType = {
  __typename?: 'KMSLogsResponseType';
  count?: Maybe<Scalars['Int']['output']>;
  logs?: Maybe<Array<Maybe<KmsLogType>>>;
};

export type KeyMap = {
  __typename?: 'KeyMap';
  id?: Maybe<Scalars['String']['output']>;
  keyName?: Maybe<Scalars['String']['output']>;
  masked?: Maybe<Scalars['Boolean']['output']>;
};

export type KeyMapInput = {
  id: Scalars['String']['input'];
  keyName: Scalars['String']['input'];
};

export type LeaseCredentialsUnion = AwsCredentialsType;

export type LeaseDynamicSecret = {
  __typename?: 'LeaseDynamicSecret';
  lease?: Maybe<DynamicSecretLeaseType>;
};

export type LockboxInput = {
  allowedViews?: InputMaybe<Scalars['Int']['input']>;
  data?: InputMaybe<Scalars['JSONString']['input']>;
  expiry?: InputMaybe<Scalars['BigInt']['input']>;
};

export type LockboxType = {
  __typename?: 'LockboxType';
  allowedViews?: Maybe<Scalars['Int']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  data: Scalars['JSONString']['output'];
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  views: Scalars['Int']['output'];
};

export enum MemberType {
  Service = 'SERVICE',
  User = 'USER'
}

export type MigratePricingMutation = {
  __typename?: 'MigratePricingMutation';
  message?: Maybe<Scalars['String']['output']>;
  success?: Maybe<Scalars['Boolean']['output']>;
};

export type Mutation = {
  __typename?: 'Mutation';
  addAppMember?: Maybe<AddAppMemberMutation>;
  bulkAddAppMembers?: Maybe<BulkAddAppMembersMutation>;
  bulkInviteOrganisationMembers?: Maybe<BulkInviteOrganisationMembersMutation>;
  cancelSubscription?: Maybe<UpdateSubscriptionResponse>;
  createApp?: Maybe<CreateAppMutation>;
  createAwsDynamicSecret?: Maybe<CreateAwsDynamicSecretMutation>;
  createAwsSecretSync?: Maybe<CreateAwsSecretsManagerSync>;
  createCloudflarePagesSync?: Maybe<CreateCloudflarePagesSync>;
  createCloudflareWorkersSync?: Maybe<CreateCloudflareWorkersSync>;
  createCustomRole?: Maybe<CreateCustomRoleMutation>;
  createDynamicSecretLease?: Maybe<LeaseDynamicSecret>;
  createEnvironment?: Maybe<CreateEnvironmentMutation>;
  createEnvironmentKey?: Maybe<CreateEnvironmentKeyMutation>;
  createEnvironmentToken?: Maybe<CreateEnvironmentTokenMutation>;
  createGhActionsSync?: Maybe<CreateGitHubActionsSync>;
  createGhDependabotSync?: Maybe<CreateGitHubDependabotSync>;
  createGitlabCiSync?: Maybe<CreateGitLabCiSync>;
  createIdentity?: Maybe<CreateIdentityMutation>;
  createLockbox?: Maybe<CreateLockboxMutation>;
  createNetworkAccessPolicy?: Maybe<CreateNetworkAccessPolicyMutation>;
  createNomadSync?: Maybe<CreateNomadSync>;
  createOrganisation?: Maybe<CreateOrganisationMutation>;
  createOrganisationMember?: Maybe<CreateOrganisationMemberMutation>;
  createOverride?: Maybe<CreatePersonalSecretMutation>;
  createProviderCredentials?: Maybe<CreateProviderCredentials>;
  createRailwaySync?: Maybe<CreateRailwaySync>;
  createRenderSync?: Maybe<CreateRenderSync>;
  createSecret?: Maybe<CreateSecretMutation>;
  createSecretFolder?: Maybe<CreateSecretFolderMutation>;
  createSecretTag?: Maybe<CreateSecretTagMutation>;
  createSecrets?: Maybe<BulkCreateSecretMutation>;
  createServiceAccount?: Maybe<CreateServiceAccountMutation>;
  createServiceAccountToken?: Maybe<CreateServiceAccountTokenMutation>;
  createServiceToken?: Maybe<CreateServiceTokenMutation>;
  createSetupIntent?: Maybe<CreateSetupIntentMutation>;
  createSubscriptionCheckoutSession?: Maybe<CreateSubscriptionCheckoutSession>;
  createUserToken?: Maybe<CreateUserTokenMutation>;
  createVaultSync?: Maybe<CreateVaultSync>;
  createVercelSync?: Maybe<CreateVercelSync>;
  deleteApp?: Maybe<DeleteAppMutation>;
  deleteCustomRole?: Maybe<DeleteCustomRoleMutation>;
  deleteDynamicSecret?: Maybe<DeleteDynamicSecretMutation>;
  deleteEnvSync?: Maybe<DeleteSync>;
  deleteEnvironment?: Maybe<DeleteEnvironmentMutation>;
  deleteIdentity?: Maybe<DeleteIdentityMutation>;
  deleteInvitation?: Maybe<DeleteInviteMutation>;
  deleteNetworkAccessPolicy?: Maybe<DeleteNetworkAccessPolicyMutation>;
  deleteOrganisationMember?: Maybe<DeleteOrganisationMemberMutation>;
  deletePaymentMethod?: Maybe<DeletePaymentMethodMutation>;
  deleteProviderCredentials?: Maybe<DeleteProviderCredentials>;
  deleteSecret?: Maybe<DeleteSecretMutation>;
  deleteSecretFolder?: Maybe<DeleteSecretFolderMutation>;
  deleteSecrets?: Maybe<BulkDeleteSecretMutation>;
  deleteServiceAccount?: Maybe<DeleteServiceAccountMutation>;
  deleteServiceAccountToken?: Maybe<DeleteServiceAccountTokenMutation>;
  deleteServiceToken?: Maybe<DeleteServiceTokenMutation>;
  deleteUserToken?: Maybe<DeleteUserTokenMutation>;
  editSecret?: Maybe<EditSecretMutation>;
  editSecrets?: Maybe<BulkEditSecretMutation>;
  enableServiceAccountClientSideKeyManagement?: Maybe<EnableServiceAccountClientSideKeyManagementMutation>;
  enableServiceAccountServerSideKeyManagement?: Maybe<EnableServiceAccountServerSideKeyManagementMutation>;
  initEnvSync?: Maybe<InitEnvSync>;
  migratePricing?: Maybe<MigratePricingMutation>;
  modifySubscription?: Maybe<UpdateSubscriptionResponse>;
  readSecret?: Maybe<ReadSecretMutation>;
  removeAppMember?: Maybe<RemoveAppMemberMutation>;
  removeOverride?: Maybe<DeletePersonalSecretMutation>;
  renameEnvironment?: Maybe<RenameEnvironmentMutation>;
  renewDynamicSecretLease?: Maybe<RenewLeaseMutation>;
  resumeSubscription?: Maybe<UpdateSubscriptionResponse>;
  revokeDynamicSecretLease?: Maybe<RevokeLeaseMutation>;
  rotateAppKeys?: Maybe<RotateAppKeysMutation>;
  setDefaultPaymentMethod?: Maybe<SetDefaultPaymentMethodMutation>;
  swapEnvironmentOrder?: Maybe<SwapEnvironmentOrderMutation>;
  toggleSyncActive?: Maybe<ToggleSyncActive>;
  /**
   * Transfer organisation ownership from the current owner to another member.
   * The new owner must have global access (Admin role) to ensure they have all necessary keys.
   */
  transferOrganisationOwnership?: Maybe<TransferOrganisationOwnershipMutation>;
  triggerSync?: Maybe<TriggerSync>;
  updateAccountNetworkAccessPolicies?: Maybe<UpdateAccountNetworkAccessPolicies>;
  updateAppInfo?: Maybe<UpdateAppInfoMutation>;
  updateAwsDynamicSecret?: Maybe<UpdateAwsDynamicSecretMutation>;
  updateCustomRole?: Maybe<UpdateCustomRoleMutation>;
  updateEnvironmentOrder?: Maybe<UpdateEnvironmentOrderMutation>;
  updateIdentity?: Maybe<UpdateIdentityMutation>;
  updateMemberEnvironmentScope?: Maybe<UpdateMemberEnvScopeMutation>;
  updateMemberWrappedSecrets?: Maybe<UpdateUserWrappedSecretsMutation>;
  updateNetworkAccessPolicy?: Maybe<UpdateNetworkAccessPolicyMutation>;
  updateOrganisationMemberRole?: Maybe<UpdateOrganisationMemberRole>;
  updateProviderCredentials?: Maybe<UpdateProviderCredentials>;
  updateServiceAccount?: Maybe<UpdateServiceAccountMutation>;
  updateServiceAccountHandlers?: Maybe<UpdateServiceAccountHandlersMutation>;
  updateSyncAuthentication?: Maybe<UpdateSyncAuthentication>;
};


export type MutationAddAppMemberArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  envKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>>>;
  memberId?: InputMaybe<Scalars['ID']['input']>;
  memberType?: InputMaybe<MemberType>;
};


export type MutationBulkAddAppMembersArgs = {
  appId: Scalars['ID']['input'];
  members: Array<InputMaybe<AppMemberInputType>>;
};


export type MutationBulkInviteOrganisationMembersArgs = {
  invites: Array<InputMaybe<InviteInput>>;
  orgId: Scalars['ID']['input'];
};


export type MutationCancelSubscriptionArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
  subscriptionId: Scalars['String']['input'];
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


export type MutationCreateAwsDynamicSecretArgs = {
  authenticationId?: InputMaybe<Scalars['ID']['input']>;
  config: AwsConfigInput;
  defaultTtl?: InputMaybe<Scalars['Int']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  environmentId: Scalars['ID']['input'];
  keyMap: Array<InputMaybe<KeyMapInput>>;
  maxTtl?: InputMaybe<Scalars['Int']['input']>;
  name: Scalars['String']['input'];
  organisationId: Scalars['ID']['input'];
  path?: InputMaybe<Scalars['String']['input']>;
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


export type MutationCreateCloudflareWorkersSyncArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  workerName?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateCustomRoleArgs = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  organisationId: Scalars['ID']['input'];
  permissions?: InputMaybe<Scalars['JSONString']['input']>;
};


export type MutationCreateDynamicSecretLeaseArgs = {
  name?: InputMaybe<Scalars['String']['input']>;
  secretId: Scalars['ID']['input'];
  ttl?: InputMaybe<Scalars['Int']['input']>;
};


export type MutationCreateEnvironmentArgs = {
  adminKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>>>;
  environmentData: EnvironmentInput;
  wrappedSalt?: InputMaybe<Scalars['String']['input']>;
  wrappedSeed?: InputMaybe<Scalars['String']['input']>;
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
  environmentName?: InputMaybe<Scalars['String']['input']>;
  orgSync?: InputMaybe<Scalars['Boolean']['input']>;
  owner?: InputMaybe<Scalars['String']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  repoName?: InputMaybe<Scalars['String']['input']>;
  repoVisibility?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateGhDependabotSyncArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  orgSync?: InputMaybe<Scalars['Boolean']['input']>;
  owner?: InputMaybe<Scalars['String']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  repoName?: InputMaybe<Scalars['String']['input']>;
  repoVisibility?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateGitlabCiSyncArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  isGroup?: InputMaybe<Scalars['Boolean']['input']>;
  masked?: InputMaybe<Scalars['Boolean']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  protected?: InputMaybe<Scalars['Boolean']['input']>;
  resourceId?: InputMaybe<Scalars['String']['input']>;
  resourcePath?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateIdentityArgs = {
  defaultTtlSeconds: Scalars['Int']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  maxTtlSeconds: Scalars['Int']['input'];
  name: Scalars['String']['input'];
  organisationId: Scalars['ID']['input'];
  provider: Scalars['String']['input'];
  signatureTtlSeconds?: InputMaybe<Scalars['Int']['input']>;
  stsEndpoint?: InputMaybe<Scalars['String']['input']>;
  tokenNamePattern?: InputMaybe<Scalars['String']['input']>;
  trustedPrincipals: Scalars['String']['input'];
};


export type MutationCreateLockboxArgs = {
  input?: InputMaybe<LockboxInput>;
};


export type MutationCreateNetworkAccessPolicyArgs = {
  allowedIps: Scalars['String']['input'];
  isGlobal: Scalars['Boolean']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  organisationId: Scalars['ID']['input'];
};


export type MutationCreateNomadSyncArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  nomadNamespace?: InputMaybe<Scalars['String']['input']>;
  nomadPath?: InputMaybe<Scalars['String']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
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


export type MutationCreateRailwaySyncArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  railwayEnvironment?: InputMaybe<RailwayResourceInput>;
  railwayProject?: InputMaybe<RailwayResourceInput>;
  railwayService?: InputMaybe<RailwayResourceInput>;
};


export type MutationCreateRenderSyncArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  resourceId?: InputMaybe<Scalars['String']['input']>;
  resourceName?: InputMaybe<Scalars['String']['input']>;
  resourceType?: InputMaybe<RenderResourceType>;
  secretFileName?: InputMaybe<Scalars['String']['input']>;
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


export type MutationCreateSecretsArgs = {
  secretsData: Array<InputMaybe<SecretInput>>;
};


export type MutationCreateServiceAccountArgs = {
  handlers?: InputMaybe<Array<InputMaybe<ServiceAccountHandlerInput>>>;
  identityKey?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  organisationId?: InputMaybe<Scalars['ID']['input']>;
  roleId?: InputMaybe<Scalars['ID']['input']>;
  serverWrappedKeyring?: InputMaybe<Scalars['String']['input']>;
  serverWrappedRecovery?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateServiceAccountTokenArgs = {
  expiry?: InputMaybe<Scalars['BigInt']['input']>;
  identityKey: Scalars['String']['input'];
  name: Scalars['String']['input'];
  serviceAccountId?: InputMaybe<Scalars['ID']['input']>;
  token: Scalars['String']['input'];
  wrappedKeyShare: Scalars['String']['input'];
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


export type MutationCreateSetupIntentArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationCreateSubscriptionCheckoutSessionArgs = {
  billingPeriod?: InputMaybe<BillingPeriodEnum>;
  organisationId: Scalars['ID']['input'];
  planType?: InputMaybe<PlanTypeEnum>;
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


export type MutationCreateVercelSyncArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  environment?: InputMaybe<Scalars['String']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  projectId?: InputMaybe<Scalars['String']['input']>;
  projectName?: InputMaybe<Scalars['String']['input']>;
  secretType?: InputMaybe<Scalars['String']['input']>;
  teamId?: InputMaybe<Scalars['String']['input']>;
  teamName?: InputMaybe<Scalars['String']['input']>;
};


export type MutationDeleteAppArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteCustomRoleArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteDynamicSecretArgs = {
  secretId: Scalars['ID']['input'];
};


export type MutationDeleteEnvSyncArgs = {
  syncId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationDeleteEnvironmentArgs = {
  environmentId: Scalars['ID']['input'];
};


export type MutationDeleteIdentityArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteInvitationArgs = {
  inviteId: Scalars['ID']['input'];
};


export type MutationDeleteNetworkAccessPolicyArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteOrganisationMemberArgs = {
  memberId: Scalars['ID']['input'];
};


export type MutationDeletePaymentMethodArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
  paymentMethodId?: InputMaybe<Scalars['String']['input']>;
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


export type MutationDeleteSecretsArgs = {
  ids: Array<InputMaybe<Scalars['ID']['input']>>;
};


export type MutationDeleteServiceAccountArgs = {
  serviceAccountId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationDeleteServiceAccountTokenArgs = {
  tokenId?: InputMaybe<Scalars['ID']['input']>;
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


export type MutationEditSecretsArgs = {
  secretsData: Array<InputMaybe<SecretInput>>;
};


export type MutationEnableServiceAccountClientSideKeyManagementArgs = {
  serviceAccountId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationEnableServiceAccountServerSideKeyManagementArgs = {
  serverWrappedKeyring?: InputMaybe<Scalars['String']['input']>;
  serverWrappedRecovery?: InputMaybe<Scalars['String']['input']>;
  serviceAccountId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationInitEnvSyncArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  envKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>>>;
};


export type MutationMigratePricingArgs = {
  organisationId: Scalars['ID']['input'];
};


export type MutationModifySubscriptionArgs = {
  billingPeriod?: InputMaybe<BillingPeriodEnum>;
  organisationId: Scalars['ID']['input'];
  planType?: InputMaybe<PlanTypeEnum>;
  subscriptionId: Scalars['String']['input'];
};


export type MutationReadSecretArgs = {
  ids?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
};


export type MutationRemoveAppMemberArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  memberId?: InputMaybe<Scalars['ID']['input']>;
  memberType?: InputMaybe<MemberType>;
};


export type MutationRemoveOverrideArgs = {
  secretId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationRenameEnvironmentArgs = {
  environmentId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
};


export type MutationRenewDynamicSecretLeaseArgs = {
  leaseId: Scalars['ID']['input'];
  ttl?: InputMaybe<Scalars['Int']['input']>;
};


export type MutationResumeSubscriptionArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
  subscriptionId: Scalars['String']['input'];
};


export type MutationRevokeDynamicSecretLeaseArgs = {
  leaseId: Scalars['ID']['input'];
};


export type MutationRotateAppKeysArgs = {
  appToken: Scalars['String']['input'];
  id: Scalars['ID']['input'];
  wrappedKeyShare: Scalars['String']['input'];
};


export type MutationSetDefaultPaymentMethodArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
  paymentMethodId: Scalars['String']['input'];
};


export type MutationSwapEnvironmentOrderArgs = {
  environment1Id: Scalars['ID']['input'];
  environment2Id: Scalars['ID']['input'];
};


export type MutationToggleSyncActiveArgs = {
  syncId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationTransferOrganisationOwnershipArgs = {
  billingEmail?: InputMaybe<Scalars['String']['input']>;
  newOwnerId: Scalars['ID']['input'];
  organisationId: Scalars['ID']['input'];
};


export type MutationTriggerSyncArgs = {
  syncId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationUpdateAccountNetworkAccessPoliciesArgs = {
  accountInputs?: InputMaybe<Array<InputMaybe<AccountPolicyInput>>>;
  organisationId: Scalars['ID']['input'];
};


export type MutationUpdateAppInfoArgs = {
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
};


export type MutationUpdateAwsDynamicSecretArgs = {
  authenticationId?: InputMaybe<Scalars['ID']['input']>;
  config: AwsConfigInput;
  defaultTtl?: InputMaybe<Scalars['Int']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  dynamicSecretId: Scalars['ID']['input'];
  keyMap: Array<InputMaybe<KeyMapInput>>;
  maxTtl?: InputMaybe<Scalars['Int']['input']>;
  name: Scalars['String']['input'];
  organisationId: Scalars['ID']['input'];
  path?: InputMaybe<Scalars['String']['input']>;
};


export type MutationUpdateCustomRoleArgs = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  permissions?: InputMaybe<Scalars['JSONString']['input']>;
};


export type MutationUpdateEnvironmentOrderArgs = {
  appId: Scalars['ID']['input'];
  environmentOrder: Array<InputMaybe<Scalars['ID']['input']>>;
};


export type MutationUpdateIdentityArgs = {
  defaultTtlSeconds?: InputMaybe<Scalars['Int']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  maxTtlSeconds?: InputMaybe<Scalars['Int']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  signatureTtlSeconds?: InputMaybe<Scalars['Int']['input']>;
  stsEndpoint?: InputMaybe<Scalars['String']['input']>;
  tokenNamePattern?: InputMaybe<Scalars['String']['input']>;
  trustedPrincipals?: InputMaybe<Scalars['String']['input']>;
};


export type MutationUpdateMemberEnvironmentScopeArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  envKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>>>;
  memberId?: InputMaybe<Scalars['ID']['input']>;
  memberType?: InputMaybe<MemberType>;
};


export type MutationUpdateMemberWrappedSecretsArgs = {
  orgId: Scalars['ID']['input'];
  wrappedKeyring: Scalars['String']['input'];
  wrappedRecovery: Scalars['String']['input'];
};


export type MutationUpdateNetworkAccessPolicyArgs = {
  policyInputs?: InputMaybe<Array<InputMaybe<UpdatePolicyInput>>>;
};


export type MutationUpdateOrganisationMemberRoleArgs = {
  memberId: Scalars['ID']['input'];
  roleId: Scalars['ID']['input'];
};


export type MutationUpdateProviderCredentialsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  credentials?: InputMaybe<Scalars['JSONString']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};


export type MutationUpdateServiceAccountArgs = {
  identityIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  name?: InputMaybe<Scalars['String']['input']>;
  roleId?: InputMaybe<Scalars['ID']['input']>;
  serviceAccountId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationUpdateServiceAccountHandlersArgs = {
  handlers?: InputMaybe<Array<InputMaybe<ServiceAccountHandlerInput>>>;
  organisationId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationUpdateSyncAuthenticationArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  syncId?: InputMaybe<Scalars['ID']['input']>;
};

export type NamespaceType = {
  __typename?: 'NamespaceType';
  fullPath?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['ID']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  path?: Maybe<Scalars['String']['output']>;
};

export type NetworkAccessPolicyType = {
  __typename?: 'NetworkAccessPolicyType';
  /** Comma-separated list of IP addresses or CIDR ranges (e.g. 192.168.1.1, 10.0.0.0/24) */
  allowedIps: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  createdBy?: Maybe<OrganisationMemberType>;
  id: Scalars['String']['output'];
  isGlobal: Scalars['Boolean']['output'];
  members: Array<OrganisationMemberType>;
  name: Scalars['String']['output'];
  organisation: OrganisationType;
  organisationMembers?: Maybe<Array<OrganisationMemberType>>;
  serviceAccounts?: Maybe<Array<ServiceAccountType>>;
  updatedAt: Scalars['DateTime']['output'];
  updatedBy?: Maybe<OrganisationMemberType>;
};

/** An object with an ID */
export type Node = {
  /** The ID of the object */
  id: Scalars['ID']['output'];
};

export type OrganisationMemberInviteType = {
  __typename?: 'OrganisationMemberInviteType';
  apps: Array<AppMembershipType>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  expiresAt: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  invitedBy: OrganisationMemberType;
  inviteeEmail: Scalars['String']['output'];
  organisation: OrganisationType;
  role?: Maybe<RoleType>;
  updatedAt: Scalars['DateTime']['output'];
  valid: Scalars['Boolean']['output'];
};

export type OrganisationMemberType = {
  __typename?: 'OrganisationMemberType';
  appMemberships?: Maybe<Array<AppMembershipType>>;
  avatarUrl?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  email?: Maybe<Scalars['String']['output']>;
  fullName?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  identityKey?: Maybe<Scalars['String']['output']>;
  lastLogin?: Maybe<Scalars['DateTime']['output']>;
  networkPolicies?: Maybe<Array<NetworkAccessPolicyType>>;
  role?: Maybe<RoleType>;
  self?: Maybe<Scalars['Boolean']['output']>;
  tokens?: Maybe<Array<UserTokenType>>;
  updatedAt: Scalars['DateTime']['output'];
  username?: Maybe<Scalars['String']['output']>;
  wrappedKeyring: Scalars['String']['output'];
};

export type OrganisationPlanType = {
  __typename?: 'OrganisationPlanType';
  appCount?: Maybe<Scalars['Int']['output']>;
  maxApps?: Maybe<Scalars['Int']['output']>;
  maxEnvsPerApp?: Maybe<Scalars['Int']['output']>;
  maxUsers?: Maybe<Scalars['Int']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  seatLimit?: Maybe<Scalars['Int']['output']>;
  seatsUsed?: Maybe<SeatsUsed>;
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
  planDetail?: Maybe<OrganisationPlanType>;
  pricingVersion: Scalars['Int']['output'];
  recovery?: Maybe<Scalars['String']['output']>;
  role?: Maybe<RoleType>;
};

export type PaymentMethodDetails = {
  __typename?: 'PaymentMethodDetails';
  brand?: Maybe<Scalars['String']['output']>;
  expMonth?: Maybe<Scalars['Int']['output']>;
  expYear?: Maybe<Scalars['Int']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  isDefault?: Maybe<Scalars['Boolean']['output']>;
  last4?: Maybe<Scalars['String']['output']>;
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

export type PhaseLicenseType = {
  __typename?: 'PhaseLicenseType';
  customerName?: Maybe<Scalars['String']['output']>;
  environment?: Maybe<Scalars['String']['output']>;
  expiresAt?: Maybe<Scalars['Date']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  isActivated?: Maybe<Scalars['Boolean']['output']>;
  issuedAt?: Maybe<Scalars['Date']['output']>;
  issuingAuthority?: Maybe<Scalars['String']['output']>;
  licenseType?: Maybe<Scalars['String']['output']>;
  organisationName?: Maybe<Scalars['String']['output']>;
  organisationOwner?: Maybe<OrganisationMemberType>;
  plan?: Maybe<PlanTier>;
  seats?: Maybe<Scalars['Int']['output']>;
  signatureDate?: Maybe<Scalars['String']['output']>;
  tokens?: Maybe<Scalars['Int']['output']>;
};

export enum PlanTier {
  EnterprisePlan = 'ENTERPRISE_PLAN',
  ProPlan = 'PRO_PLAN'
}

export enum PlanTypeEnum {
  Enterprise = 'ENTERPRISE',
  Pro = 'PRO'
}

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
  appServiceAccounts?: Maybe<Array<Maybe<ServiceAccountType>>>;
  appUsers?: Maybe<Array<Maybe<OrganisationMemberType>>>;
  apps?: Maybe<Array<Maybe<AppType>>>;
  awsSecrets?: Maybe<Array<Maybe<AwsSecretType>>>;
  awsStsEndpoints?: Maybe<Array<Maybe<Scalars['JSONString']['output']>>>;
  clientIp?: Maybe<Scalars['String']['output']>;
  cloudflarePagesProjects?: Maybe<Array<Maybe<CloudFlarePagesType>>>;
  cloudflareWorkers?: Maybe<Array<Maybe<CloudflareWorkerType>>>;
  dynamicSecretProviders?: Maybe<Array<Maybe<DynamicSecretProviderType>>>;
  dynamicSecrets?: Maybe<Array<Maybe<DynamicSecretType>>>;
  envSyncs?: Maybe<Array<Maybe<EnvironmentSyncType>>>;
  environmentKeys?: Maybe<Array<Maybe<EnvironmentKeyType>>>;
  environmentTokens?: Maybe<Array<Maybe<EnvironmentTokenType>>>;
  estimateStripeSubscription?: Maybe<StripePlanEstimate>;
  folders?: Maybe<Array<Maybe<SecretFolderType>>>;
  githubEnvironments?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  githubOrgs?: Maybe<Array<Maybe<GitHubOrgType>>>;
  githubRepos?: Maybe<Array<Maybe<GitHubRepoType>>>;
  gitlabGroups?: Maybe<Array<Maybe<GitLabGroupType>>>;
  gitlabProjects?: Maybe<Array<Maybe<GitLabProjectType>>>;
  identities?: Maybe<Array<Maybe<IdentityType>>>;
  identityProviders?: Maybe<Array<Maybe<IdentityProviderType>>>;
  kmsLogs?: Maybe<KmsLogsResponseType>;
  license?: Maybe<PhaseLicenseType>;
  networkAccessPolicies?: Maybe<Array<Maybe<NetworkAccessPolicyType>>>;
  organisationGlobalAccessUsers?: Maybe<Array<Maybe<OrganisationMemberType>>>;
  organisationInvites?: Maybe<Array<Maybe<OrganisationMemberInviteType>>>;
  organisationLicense?: Maybe<ActivatedPhaseLicenseType>;
  organisationMembers?: Maybe<Array<Maybe<OrganisationMemberType>>>;
  organisationNameAvailable?: Maybe<Scalars['Boolean']['output']>;
  organisationPlan?: Maybe<OrganisationPlanType>;
  organisations?: Maybe<Array<Maybe<OrganisationType>>>;
  providers?: Maybe<Array<Maybe<ProviderType>>>;
  railwayProjects?: Maybe<Array<Maybe<RailwayProjectType>>>;
  renderEnvgroups?: Maybe<Array<Maybe<RenderEnvGroupType>>>;
  renderServices?: Maybe<Array<Maybe<RenderServiceType>>>;
  roles?: Maybe<Array<Maybe<RoleType>>>;
  savedCredentials?: Maybe<Array<Maybe<ProviderCredentialsType>>>;
  secretHistory?: Maybe<Array<Maybe<SecretEventType>>>;
  secretLogs?: Maybe<SecretLogsResponseType>;
  secretTags?: Maybe<Array<Maybe<SecretTagType>>>;
  secrets?: Maybe<Array<Maybe<SecretType>>>;
  serverPublicKey?: Maybe<Scalars['String']['output']>;
  serviceAccountHandlers?: Maybe<Array<Maybe<OrganisationMemberType>>>;
  serviceAccounts?: Maybe<Array<Maybe<ServiceAccountType>>>;
  serviceTokens?: Maybe<Array<Maybe<ServiceTokenType>>>;
  services?: Maybe<Array<Maybe<ServiceType>>>;
  sseEnabled?: Maybe<Scalars['Boolean']['output']>;
  stripeCheckoutDetails?: Maybe<StripeCheckoutDetails>;
  stripeCustomerPortalUrl?: Maybe<Scalars['String']['output']>;
  stripeSubscriptionDetails?: Maybe<StripeSubscriptionDetails>;
  syncs?: Maybe<Array<Maybe<EnvironmentSyncType>>>;
  testNomadCreds?: Maybe<Scalars['Boolean']['output']>;
  testVaultCreds?: Maybe<Scalars['Boolean']['output']>;
  testVercelCreds?: Maybe<Scalars['Boolean']['output']>;
  userTokens?: Maybe<Array<Maybe<UserTokenType>>>;
  validateAwsAssumeRoleAuth?: Maybe<AwsValidationResultType>;
  validateAwsAssumeRoleCredentials?: Maybe<AwsValidationResultType>;
  validateInvite?: Maybe<OrganisationMemberInviteType>;
  vercelProjects?: Maybe<Array<Maybe<VercelTeamProjectsType>>>;
};


export type QueryAppActivityChartArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  period?: InputMaybe<TimeRange>;
};


export type QueryAppEnvironmentsArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  environmentId?: InputMaybe<Scalars['ID']['input']>;
  memberId?: InputMaybe<Scalars['ID']['input']>;
  memberType?: InputMaybe<MemberType>;
};


export type QueryAppServiceAccountsArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
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


export type QueryCloudflareWorkersArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryDynamicSecretsArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  secretId?: InputMaybe<Scalars['ID']['input']>;
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


export type QueryEstimateStripeSubscriptionArgs = {
  billingPeriod: BillingPeriodEnum;
  organisationId: Scalars['ID']['input'];
  planType: PlanTypeEnum;
  previewV2?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryFoldersArgs = {
  envId?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
};


export type QueryGithubEnvironmentsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
  owner?: InputMaybe<Scalars['String']['input']>;
  repoName?: InputMaybe<Scalars['String']['input']>;
};


export type QueryGithubOrgsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryGithubReposArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryGitlabGroupsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryGitlabProjectsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryIdentitiesArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryKmsLogsArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  end?: InputMaybe<Scalars['BigInt']['input']>;
  start?: InputMaybe<Scalars['BigInt']['input']>;
};


export type QueryNetworkAccessPoliciesArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryOrganisationGlobalAccessUsersArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryOrganisationInvitesArgs = {
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryOrganisationLicenseArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryOrganisationMembersArgs = {
  memberId?: InputMaybe<Scalars['ID']['input']>;
  organisationId?: InputMaybe<Scalars['ID']['input']>;
  role?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryOrganisationNameAvailableArgs = {
  name?: InputMaybe<Scalars['String']['input']>;
};


export type QueryOrganisationPlanArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryRailwayProjectsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryRenderEnvgroupsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryRenderServicesArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryRolesArgs = {
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySavedCredentialsArgs = {
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySecretHistoryArgs = {
  secretId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySecretLogsArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  end?: InputMaybe<Scalars['BigInt']['input']>;
  environmentId?: InputMaybe<Scalars['ID']['input']>;
  eventTypes?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  memberId?: InputMaybe<Scalars['ID']['input']>;
  memberType?: InputMaybe<MemberType>;
  start?: InputMaybe<Scalars['BigInt']['input']>;
};


export type QuerySecretTagsArgs = {
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySecretsArgs = {
  envId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
};


export type QueryServiceAccountHandlersArgs = {
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryServiceAccountsArgs = {
  orgId?: InputMaybe<Scalars['ID']['input']>;
  serviceAccountId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryServiceTokensArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySseEnabledArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryStripeCheckoutDetailsArgs = {
  stripeSessionId: Scalars['String']['input'];
};


export type QueryStripeCustomerPortalUrlArgs = {
  organisationId: Scalars['ID']['input'];
};


export type QueryStripeSubscriptionDetailsArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
};


export type QuerySyncsArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  orgId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryTestNomadCredsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryTestVaultCredsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryTestVercelCredsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryUserTokensArgs = {
  organisationId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryValidateAwsAssumeRoleCredentialsArgs = {
  externalId?: InputMaybe<Scalars['String']['input']>;
  region?: InputMaybe<Scalars['String']['input']>;
  roleArn: Scalars['String']['input'];
};


export type QueryValidateInviteArgs = {
  inviteId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryVercelProjectsArgs = {
  credentialId?: InputMaybe<Scalars['ID']['input']>;
};

export type RailwayEnvironmentType = {
  __typename?: 'RailwayEnvironmentType';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  projectId: Scalars['ID']['output'];
};

export type RailwayProjectType = {
  __typename?: 'RailwayProjectType';
  environments: Array<RailwayEnvironmentType>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  services: Array<RailwayServiceType>;
};

export type RailwayResourceInput = {
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
};

export type RailwayServiceType = {
  __typename?: 'RailwayServiceType';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type ReadSecretMutation = {
  __typename?: 'ReadSecretMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type RemoveAppMemberMutation = {
  __typename?: 'RemoveAppMemberMutation';
  app?: Maybe<AppType>;
};

export type RenameEnvironmentMutation = {
  __typename?: 'RenameEnvironmentMutation';
  environment?: Maybe<EnvironmentType>;
};

export type RenderEnvGroupType = {
  __typename?: 'RenderEnvGroupType';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export enum RenderResourceType {
  EnvironmentGroup = 'ENVIRONMENT_GROUP',
  Service = 'SERVICE'
}

export type RenderServiceType = {
  __typename?: 'RenderServiceType';
  branch?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  region?: Maybe<Scalars['String']['output']>;
  repo?: Maybe<Scalars['String']['output']>;
  type?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['String']['output']>;
};

export type RenewLeaseMutation = {
  __typename?: 'RenewLeaseMutation';
  lease?: Maybe<DynamicSecretLeaseType>;
};

export type RevokeLeaseMutation = {
  __typename?: 'RevokeLeaseMutation';
  lease?: Maybe<DynamicSecretLeaseType>;
};

export type RoleType = {
  __typename?: 'RoleType';
  color?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  isDefault?: Maybe<Scalars['Boolean']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  permissions?: Maybe<Scalars['JSONString']['output']>;
};

export type RotateAppKeysMutation = {
  __typename?: 'RotateAppKeysMutation';
  app?: Maybe<AppType>;
};

export type SeatsUsed = {
  __typename?: 'SeatsUsed';
  serviceAccounts?: Maybe<Scalars['Int']['output']>;
  total?: Maybe<Scalars['Int']['output']>;
  users?: Maybe<Scalars['Int']['output']>;
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
  serviceAccount?: Maybe<ServiceAccountType>;
  serviceAccountToken?: Maybe<ServiceAccountTokenType>;
  serviceToken?: Maybe<ServiceTokenType>;
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
  id?: InputMaybe<Scalars['ID']['input']>;
  key: Scalars['String']['input'];
  keyDigest: Scalars['String']['input'];
  path?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  value: Scalars['String']['input'];
};

export type SecretLogsResponseType = {
  __typename?: 'SecretLogsResponseType';
  count?: Maybe<Scalars['Int']['output']>;
  logs?: Maybe<Array<Maybe<SecretEventType>>>;
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
  environment: EnvironmentType;
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

export type ServiceAccountHandlerInput = {
  memberId?: InputMaybe<Scalars['ID']['input']>;
  serviceAccountId?: InputMaybe<Scalars['ID']['input']>;
  wrappedKeyring: Scalars['String']['input'];
  wrappedRecovery: Scalars['String']['input'];
};

export type ServiceAccountHandlerType = {
  __typename?: 'ServiceAccountHandlerType';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  serviceAccount: ServiceAccountType;
  updatedAt: Scalars['DateTime']['output'];
  user: OrganisationMemberType;
  wrappedKeyring: Scalars['String']['output'];
  wrappedRecovery: Scalars['String']['output'];
};

export type ServiceAccountTokenType = {
  __typename?: 'ServiceAccountTokenType';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  createdBy?: Maybe<OrganisationMemberType>;
  createdByServiceAccount?: Maybe<ServiceAccountType>;
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  identityKey: Scalars['String']['output'];
  lastUsed?: Maybe<Scalars['DateTime']['output']>;
  name: Scalars['String']['output'];
  secreteventSet: Array<SecretEventType>;
  serviceAccount: ServiceAccountType;
  token: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  wrappedKeyShare: Scalars['String']['output'];
};

export type ServiceAccountType = {
  __typename?: 'ServiceAccountType';
  appMemberships?: Maybe<Array<AppMembershipType>>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  handlers?: Maybe<Array<Maybe<ServiceAccountHandlerType>>>;
  id: Scalars['String']['output'];
  identities?: Maybe<Array<IdentityType>>;
  identityKey?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  networkPolicies?: Maybe<Array<NetworkAccessPolicyType>>;
  role?: Maybe<RoleType>;
  serverSideKeyManagementEnabled?: Maybe<Scalars['Boolean']['output']>;
  tokens?: Maybe<Array<Maybe<ServiceAccountTokenType>>>;
  updatedAt: Scalars['DateTime']['output'];
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

export type SetDefaultPaymentMethodMutation = {
  __typename?: 'SetDefaultPaymentMethodMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type StripeCheckoutDetails = {
  __typename?: 'StripeCheckoutDetails';
  billingEndDate?: Maybe<Scalars['String']['output']>;
  billingStartDate?: Maybe<Scalars['String']['output']>;
  customerEmail?: Maybe<Scalars['String']['output']>;
  paymentStatus?: Maybe<Scalars['String']['output']>;
  planName?: Maybe<Scalars['String']['output']>;
  subscriptionId?: Maybe<Scalars['String']['output']>;
};

export type StripePlanEstimate = {
  __typename?: 'StripePlanEstimate';
  currency?: Maybe<Scalars['String']['output']>;
  estimatedTotal?: Maybe<Scalars['Float']['output']>;
  priceId?: Maybe<Scalars['String']['output']>;
  seatCount?: Maybe<Scalars['Int']['output']>;
  unitPrice?: Maybe<Scalars['Float']['output']>;
};

export type StripeSubscriptionDetails = {
  __typename?: 'StripeSubscriptionDetails';
  billingPeriod?: Maybe<BillingPeriodEnum>;
  cancelAt?: Maybe<Scalars['Int']['output']>;
  cancelAtPeriodEnd?: Maybe<Scalars['Boolean']['output']>;
  currentPeriodEnd?: Maybe<Scalars['Int']['output']>;
  currentPeriodStart?: Maybe<Scalars['Int']['output']>;
  nextPaymentAmount?: Maybe<Scalars['Float']['output']>;
  paymentMethods?: Maybe<Array<Maybe<PaymentMethodDetails>>>;
  planName?: Maybe<Scalars['String']['output']>;
  planType?: Maybe<PlanTypeEnum>;
  renewalDate?: Maybe<Scalars['Int']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  subscriptionId?: Maybe<Scalars['String']['output']>;
};

export type SwapEnvironmentOrderMutation = {
  __typename?: 'SwapEnvironmentOrderMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

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

/**
 * Transfer organisation ownership from the current owner to another member.
 * The new owner must have global access (Admin role) to ensure they have all necessary keys.
 */
export type TransferOrganisationOwnershipMutation = {
  __typename?: 'TransferOrganisationOwnershipMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type TriggerSync = {
  __typename?: 'TriggerSync';
  sync?: Maybe<EnvironmentSyncType>;
};

export type UpdateAwsDynamicSecretMutation = {
  __typename?: 'UpdateAWSDynamicSecretMutation';
  dynamicSecret?: Maybe<DynamicSecretType>;
};

export type UpdateAccountNetworkAccessPolicies = {
  __typename?: 'UpdateAccountNetworkAccessPolicies';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type UpdateAppInfoMutation = {
  __typename?: 'UpdateAppInfoMutation';
  app?: Maybe<AppType>;
};

export type UpdateCustomRoleMutation = {
  __typename?: 'UpdateCustomRoleMutation';
  role?: Maybe<RoleType>;
};

export type UpdateEnvironmentOrderMutation = {
  __typename?: 'UpdateEnvironmentOrderMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type UpdateIdentityMutation = {
  __typename?: 'UpdateIdentityMutation';
  identity?: Maybe<IdentityType>;
};

export type UpdateMemberEnvScopeMutation = {
  __typename?: 'UpdateMemberEnvScopeMutation';
  app?: Maybe<AppType>;
};

export type UpdateNetworkAccessPolicyMutation = {
  __typename?: 'UpdateNetworkAccessPolicyMutation';
  networkAccessPolicy?: Maybe<NetworkAccessPolicyType>;
};

export type UpdateOrganisationMemberRole = {
  __typename?: 'UpdateOrganisationMemberRole';
  orgMember?: Maybe<OrganisationMemberType>;
};

export type UpdatePolicyInput = {
  allowedIps?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  isGlobal?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateProviderCredentials = {
  __typename?: 'UpdateProviderCredentials';
  credential?: Maybe<ProviderCredentialsType>;
};

export type UpdateServiceAccountHandlersMutation = {
  __typename?: 'UpdateServiceAccountHandlersMutation';
  ok?: Maybe<Scalars['Boolean']['output']>;
};

export type UpdateServiceAccountMutation = {
  __typename?: 'UpdateServiceAccountMutation';
  serviceAccount?: Maybe<ServiceAccountType>;
};

export type UpdateSubscriptionResponse = {
  __typename?: 'UpdateSubscriptionResponse';
  cancelledAt?: Maybe<Scalars['String']['output']>;
  message?: Maybe<Scalars['String']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  success?: Maybe<Scalars['Boolean']['output']>;
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
  createdBy?: Maybe<OrganisationMemberType>;
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  identityKey: Scalars['String']['output'];
  name: Scalars['String']['output'];
  token: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  wrappedKeyShare: Scalars['String']['output'];
};

export type VercelEnvironmentType = {
  __typename?: 'VercelEnvironmentType';
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  type?: Maybe<Scalars['String']['output']>;
};

export type VercelProjectType = {
  __typename?: 'VercelProjectType';
  environments?: Maybe<Array<Maybe<VercelEnvironmentType>>>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type VercelTeamProjectsType = {
  __typename?: 'VercelTeamProjectsType';
  id: Scalars['String']['output'];
  projects?: Maybe<Array<Maybe<VercelProjectType>>>;
  teamName: Scalars['String']['output'];
};

export type CreateAccessPolicyMutationVariables = Exact<{
  name: Scalars['String']['input'];
  allowedIps: Scalars['String']['input'];
  isGlobal: Scalars['Boolean']['input'];
  organisationId: Scalars['ID']['input'];
}>;


export type CreateAccessPolicyMutation = { __typename?: 'Mutation', createNetworkAccessPolicy?: { __typename?: 'CreateNetworkAccessPolicyMutation', networkAccessPolicy?: { __typename?: 'NetworkAccessPolicyType', id: string } | null } | null };

export type CreateRoleMutationVariables = Exact<{
  name: Scalars['String']['input'];
  description: Scalars['String']['input'];
  color: Scalars['String']['input'];
  permissions: Scalars['JSONString']['input'];
  organisationId: Scalars['ID']['input'];
}>;


export type CreateRoleMutation = { __typename?: 'Mutation', createCustomRole?: { __typename?: 'CreateCustomRoleMutation', role?: { __typename?: 'RoleType', id: string } | null } | null };

export type DeleteAccessPolicyMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteAccessPolicyMutation = { __typename?: 'Mutation', deleteNetworkAccessPolicy?: { __typename?: 'DeleteNetworkAccessPolicyMutation', ok?: boolean | null } | null };

export type DeleteRoleMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteRoleMutation = { __typename?: 'Mutation', deleteCustomRole?: { __typename?: 'DeleteCustomRoleMutation', ok?: boolean | null } | null };

export type UpdateAccountNetworkPolicyMutationVariables = Exact<{
  accounts?: InputMaybe<Array<InputMaybe<AccountPolicyInput>> | InputMaybe<AccountPolicyInput>>;
  organisationId: Scalars['ID']['input'];
}>;


export type UpdateAccountNetworkPolicyMutation = { __typename?: 'Mutation', updateAccountNetworkAccessPolicies?: { __typename?: 'UpdateAccountNetworkAccessPolicies', ok?: boolean | null } | null };

export type UpdateAccessPoliciesMutationVariables = Exact<{
  inputs?: InputMaybe<Array<InputMaybe<UpdatePolicyInput>> | InputMaybe<UpdatePolicyInput>>;
}>;


export type UpdateAccessPoliciesMutation = { __typename?: 'Mutation', updateNetworkAccessPolicy?: { __typename?: 'UpdateNetworkAccessPolicyMutation', networkAccessPolicy?: { __typename?: 'NetworkAccessPolicyType', id: string } | null } | null };

export type UpdateRoleMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  description: Scalars['String']['input'];
  color: Scalars['String']['input'];
  permissions: Scalars['JSONString']['input'];
}>;


export type UpdateRoleMutation = { __typename?: 'Mutation', updateCustomRole?: { __typename?: 'UpdateCustomRoleMutation', role?: { __typename?: 'RoleType', id: string } | null } | null };

export type AddMemberToAppMutationVariables = Exact<{
  memberId: Scalars['ID']['input'];
  memberType?: InputMaybe<MemberType>;
  appId: Scalars['ID']['input'];
  envKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>> | InputMaybe<EnvironmentKeyInput>>;
}>;


export type AddMemberToAppMutation = { __typename?: 'Mutation', addAppMember?: { __typename?: 'AddAppMemberMutation', app?: { __typename?: 'AppType', id: string } | null } | null };

export type BulkAddMembersToAppMutationVariables = Exact<{
  appId: Scalars['ID']['input'];
  members: Array<AppMemberInputType> | AppMemberInputType;
}>;


export type BulkAddMembersToAppMutation = { __typename?: 'Mutation', bulkAddAppMembers?: { __typename?: 'BulkAddAppMembersMutation', app?: { __typename?: 'AppType', id: string } | null } | null };

export type RemoveMemberFromAppMutationVariables = Exact<{
  memberId: Scalars['ID']['input'];
  memberType?: InputMaybe<MemberType>;
  appId: Scalars['ID']['input'];
}>;


export type RemoveMemberFromAppMutation = { __typename?: 'Mutation', removeAppMember?: { __typename?: 'RemoveAppMemberMutation', app?: { __typename?: 'AppType', id: string } | null } | null };

export type UpdateAppInfoOpMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
}>;


export type UpdateAppInfoOpMutation = { __typename?: 'Mutation', updateAppInfo?: { __typename?: 'UpdateAppInfoMutation', app?: { __typename?: 'AppType', id: string, name: string, description?: string | null } | null } | null };

export type UpdateEnvScopeMutationVariables = Exact<{
  memberId: Scalars['ID']['input'];
  memberType?: InputMaybe<MemberType>;
  appId: Scalars['ID']['input'];
  envKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>> | InputMaybe<EnvironmentKeyInput>>;
}>;


export type UpdateEnvScopeMutation = { __typename?: 'Mutation', updateMemberEnvironmentScope?: { __typename?: 'UpdateMemberEnvScopeMutation', app?: { __typename?: 'AppType', id: string } | null } | null };

export type CancelStripeSubscriptionMutationVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  subscriptionId: Scalars['String']['input'];
}>;


export type CancelStripeSubscriptionMutation = { __typename?: 'Mutation', cancelSubscription?: { __typename?: 'UpdateSubscriptionResponse', success?: boolean | null } | null };

export type CreateStripeSetupIntentOpMutationVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type CreateStripeSetupIntentOpMutation = { __typename?: 'Mutation', createSetupIntent?: { __typename?: 'CreateSetupIntentMutation', clientSecret?: string | null } | null };

export type DeleteStripePaymentMethodMutationVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  paymentMethodId: Scalars['String']['input'];
}>;


export type DeleteStripePaymentMethodMutation = { __typename?: 'Mutation', deletePaymentMethod?: { __typename?: 'DeletePaymentMethodMutation', ok?: boolean | null } | null };

export type InitStripeUpgradeCheckoutMutationVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  planType: PlanTypeEnum;
  billingPeriod: BillingPeriodEnum;
}>;


export type InitStripeUpgradeCheckoutMutation = { __typename?: 'Mutation', createSubscriptionCheckoutSession?: { __typename?: 'CreateSubscriptionCheckoutSession', clientSecret?: string | null } | null };

export type MigratePricingOpMutationVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type MigratePricingOpMutation = { __typename?: 'Mutation', migratePricing?: { __typename?: 'MigratePricingMutation', success?: boolean | null, message?: string | null } | null };

export type ModifyStripeSubscriptionMutationVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  subscriptionId: Scalars['String']['input'];
  planType: PlanTypeEnum;
  billingPeriod: BillingPeriodEnum;
}>;


export type ModifyStripeSubscriptionMutation = { __typename?: 'Mutation', modifySubscription?: { __typename?: 'UpdateSubscriptionResponse', success?: boolean | null, message?: string | null, status?: string | null } | null };

export type ResumeStripeSubscriptionMutationVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  subscriptionId: Scalars['String']['input'];
}>;


export type ResumeStripeSubscriptionMutation = { __typename?: 'Mutation', resumeSubscription?: { __typename?: 'UpdateSubscriptionResponse', success?: boolean | null, message?: string | null, cancelledAt?: string | null, status?: string | null } | null };

export type SetDefaultStripePaymentMethodOpMutationVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  paymentMethodId: Scalars['String']['input'];
}>;


export type SetDefaultStripePaymentMethodOpMutation = { __typename?: 'Mutation', setDefaultPaymentMethod?: { __typename?: 'SetDefaultPaymentMethodMutation', ok?: boolean | null } | null };

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


export type CreateOrgMutation = { __typename?: 'Mutation', createOrganisation?: { __typename?: 'CreateOrganisationMutation', organisation?: { __typename?: 'OrganisationType', id: string, name: string, memberId?: string | null } | null } | null };

export type DeleteApplicationMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteApplicationMutation = { __typename?: 'Mutation', deleteApp?: { __typename?: 'DeleteAppMutation', ok?: boolean | null } | null };

export type BulkProcessSecretsMutationVariables = Exact<{
  secretsToCreate: Array<SecretInput> | SecretInput;
  secretsToUpdate: Array<SecretInput> | SecretInput;
  secretsToDelete: Array<Scalars['ID']['input']> | Scalars['ID']['input'];
}>;


export type BulkProcessSecretsMutation = { __typename?: 'Mutation', createSecrets?: { __typename?: 'BulkCreateSecretMutation', secrets?: Array<{ __typename?: 'SecretType', id: string } | null> | null } | null, editSecrets?: { __typename?: 'BulkEditSecretMutation', secrets?: Array<{ __typename?: 'SecretType', id: string } | null> | null } | null, deleteSecrets?: { __typename?: 'BulkDeleteSecretMutation', secrets?: Array<{ __typename?: 'SecretType', id: string } | null> | null } | null };

export type CreateEnvMutationVariables = Exact<{
  envInput: EnvironmentInput;
  adminKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>> | InputMaybe<EnvironmentKeyInput>>;
  wrappedSeed?: InputMaybe<Scalars['String']['input']>;
  wrappedSalt?: InputMaybe<Scalars['String']['input']>;
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

export type DeleteEnvMutationVariables = Exact<{
  environmentId: Scalars['ID']['input'];
}>;


export type DeleteEnvMutation = { __typename?: 'Mutation', deleteEnvironment?: { __typename?: 'DeleteEnvironmentMutation', ok?: boolean | null } | null };

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

export type LogSecretReadsMutationVariables = Exact<{
  ids: Array<InputMaybe<Scalars['ID']['input']>> | InputMaybe<Scalars['ID']['input']>;
}>;


export type LogSecretReadsMutation = { __typename?: 'Mutation', readSecret?: { __typename?: 'ReadSecretMutation', ok?: boolean | null } | null };

export type RemovePersonalSecretMutationVariables = Exact<{
  secretId: Scalars['ID']['input'];
}>;


export type RemovePersonalSecretMutation = { __typename?: 'Mutation', removeOverride?: { __typename?: 'DeletePersonalSecretMutation', ok?: boolean | null } | null };

export type RenameEnvMutationVariables = Exact<{
  environmentId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
}>;


export type RenameEnvMutation = { __typename?: 'Mutation', renameEnvironment?: { __typename?: 'RenameEnvironmentMutation', environment?: { __typename?: 'EnvironmentType', id: string, name: string, updatedAt: any } | null } | null };

export type CreateNewAwsDynamicSecretMutationVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  environmentId: Scalars['ID']['input'];
  path?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  defaultTtl?: InputMaybe<Scalars['Int']['input']>;
  maxTtl?: InputMaybe<Scalars['Int']['input']>;
  authenticationId?: InputMaybe<Scalars['ID']['input']>;
  config: AwsConfigInput;
  keyMap: Array<InputMaybe<KeyMapInput>> | InputMaybe<KeyMapInput>;
}>;


export type CreateNewAwsDynamicSecretMutation = { __typename?: 'Mutation', createAwsDynamicSecret?: { __typename?: 'CreateAWSDynamicSecretMutation', dynamicSecret?: { __typename?: 'DynamicSecretType', id: string, name: string, description: string, provider: ApiDynamicSecretProviderChoices, createdAt?: any | null, updatedAt: any } | null } | null };

export type CreateDynamicSecretLeaseMutationVariables = Exact<{
  secretId: Scalars['ID']['input'];
  ttl: Scalars['Int']['input'];
  name: Scalars['String']['input'];
}>;


export type CreateDynamicSecretLeaseMutation = { __typename?: 'Mutation', createDynamicSecretLease?: { __typename?: 'LeaseDynamicSecret', lease?: { __typename?: 'DynamicSecretLeaseType', id: string, name: string, expiresAt?: any | null, credentials?: { __typename?: 'AwsCredentialsType', accessKeyId?: string | null, secretAccessKey?: string | null, username?: string | null } | null } | null } | null };

export type DeleteDynamicSecretOpMutationVariables = Exact<{
  secretId: Scalars['ID']['input'];
}>;


export type DeleteDynamicSecretOpMutation = { __typename?: 'Mutation', deleteDynamicSecret?: { __typename?: 'DeleteDynamicSecretMutation', ok?: boolean | null } | null };

export type RenewDynamicSecretLeaseOpMutationVariables = Exact<{
  leaseId: Scalars['ID']['input'];
  ttl: Scalars['Int']['input'];
}>;


export type RenewDynamicSecretLeaseOpMutation = { __typename?: 'Mutation', renewDynamicSecretLease?: { __typename?: 'RenewLeaseMutation', lease?: { __typename?: 'DynamicSecretLeaseType', id: string, name: string, expiresAt?: any | null, status: ApiDynamicSecretLeaseStatusChoices } | null } | null };

export type RevokeDynamicSecretLeaseOpMutationVariables = Exact<{
  leaseId: Scalars['ID']['input'];
}>;


export type RevokeDynamicSecretLeaseOpMutation = { __typename?: 'Mutation', revokeDynamicSecretLease?: { __typename?: 'RevokeLeaseMutation', lease?: { __typename?: 'DynamicSecretLeaseType', id: string, name: string, expiresAt?: any | null, revokedAt?: any | null, status: ApiDynamicSecretLeaseStatusChoices } | null } | null };

export type UpdateDynamicSecretMutationVariables = Exact<{
  dynamicSecretId: Scalars['ID']['input'];
  organisationId: Scalars['ID']['input'];
  path?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  defaultTtl?: InputMaybe<Scalars['Int']['input']>;
  maxTtl?: InputMaybe<Scalars['Int']['input']>;
  authenticationId?: InputMaybe<Scalars['ID']['input']>;
  config: AwsConfigInput;
  keyMap: Array<InputMaybe<KeyMapInput>> | InputMaybe<KeyMapInput>;
}>;


export type UpdateDynamicSecretMutation = { __typename?: 'Mutation', updateAwsDynamicSecret?: { __typename?: 'UpdateAWSDynamicSecretMutation', dynamicSecret?: { __typename?: 'DynamicSecretType', id: string, name: string, description: string, provider: ApiDynamicSecretProviderChoices, createdAt?: any | null, updatedAt: any } | null } | null };

export type CreateSharedSecretMutationVariables = Exact<{
  input: LockboxInput;
}>;


export type CreateSharedSecretMutation = { __typename?: 'Mutation', createLockbox?: { __typename?: 'CreateLockboxMutation', lockbox?: { __typename?: 'LockboxType', id: string, allowedViews?: number | null, expiresAt?: any | null } | null } | null };

export type SwapEnvOrderMutationVariables = Exact<{
  environment1Id: Scalars['ID']['input'];
  environment2Id: Scalars['ID']['input'];
}>;


export type SwapEnvOrderMutation = { __typename?: 'Mutation', swapEnvironmentOrder?: { __typename?: 'SwapEnvironmentOrderMutation', ok?: boolean | null } | null };

export type UpdateEnvOrderMutationVariables = Exact<{
  appId: Scalars['ID']['input'];
  environmentOrder: Array<InputMaybe<Scalars['ID']['input']>> | InputMaybe<Scalars['ID']['input']>;
}>;


export type UpdateEnvOrderMutation = { __typename?: 'Mutation', updateEnvironmentOrder?: { __typename?: 'UpdateEnvironmentOrderMutation', ok?: boolean | null } | null };

export type CreateExtIdentityMutationVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  provider: Scalars['String']['input'];
  name: Scalars['String']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  trustedPrincipals: Scalars['String']['input'];
  signatureTtlSeconds?: InputMaybe<Scalars['Int']['input']>;
  stsEndpoint?: InputMaybe<Scalars['String']['input']>;
  tokenNamePattern?: InputMaybe<Scalars['String']['input']>;
  defaultTtlSeconds: Scalars['Int']['input'];
  maxTtlSeconds: Scalars['Int']['input'];
}>;


export type CreateExtIdentityMutation = { __typename?: 'Mutation', createIdentity?: { __typename?: 'CreateIdentityMutation', identity?: { __typename?: 'IdentityType', id: string, provider: string, name: string, description?: string | null, tokenNamePattern?: string | null, defaultTtlSeconds: number, maxTtlSeconds: number, config?: { __typename?: 'AwsIamConfigType', trustedPrincipals?: Array<string | null> | null, signatureTtlSeconds?: number | null, stsEndpoint?: string | null } | null } | null } | null };

export type DeleteExtIdentityMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteExtIdentityMutation = { __typename?: 'Mutation', deleteIdentity?: { __typename?: 'DeleteIdentityMutation', ok?: boolean | null } | null };

export type UpdateExtIdentityMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  trustedPrincipals?: InputMaybe<Scalars['String']['input']>;
  signatureTtlSeconds?: InputMaybe<Scalars['Int']['input']>;
  stsEndpoint?: InputMaybe<Scalars['String']['input']>;
  tokenNamePattern?: InputMaybe<Scalars['String']['input']>;
  defaultTtlSeconds?: InputMaybe<Scalars['Int']['input']>;
  maxTtlSeconds?: InputMaybe<Scalars['Int']['input']>;
}>;


export type UpdateExtIdentityMutation = { __typename?: 'Mutation', updateIdentity?: { __typename?: 'UpdateIdentityMutation', identity?: { __typename?: 'IdentityType', id: string, name: string, description?: string | null, tokenNamePattern?: string | null, defaultTtlSeconds: number, maxTtlSeconds: number, config?: { __typename?: 'AwsIamConfigType', trustedPrincipals?: Array<string | null> | null, signatureTtlSeconds?: number | null, stsEndpoint?: string | null } | null } | null } | null };

export type AcceptOrganisationInviteMutationVariables = Exact<{
  orgId: Scalars['ID']['input'];
  identityKey: Scalars['String']['input'];
  wrappedKeyring: Scalars['String']['input'];
  wrappedRecovery: Scalars['String']['input'];
  inviteId: Scalars['ID']['input'];
}>;


export type AcceptOrganisationInviteMutation = { __typename?: 'Mutation', createOrganisationMember?: { __typename?: 'CreateOrganisationMemberMutation', orgMember?: { __typename?: 'OrganisationMemberType', id: string, email?: string | null, createdAt?: any | null, role?: { __typename?: 'RoleType', name?: string | null } | null } | null } | null };

export type BulkInviteMembersMutationVariables = Exact<{
  orgId: Scalars['ID']['input'];
  invites: Array<InviteInput> | InviteInput;
}>;


export type BulkInviteMembersMutation = { __typename?: 'Mutation', bulkInviteOrganisationMembers?: { __typename?: 'BulkInviteOrganisationMembersMutation', invites?: Array<{ __typename?: 'OrganisationMemberInviteType', id: string, inviteeEmail: string, expiresAt: any } | null> | null } | null };

export type DeleteOrgInviteMutationVariables = Exact<{
  inviteId: Scalars['ID']['input'];
}>;


export type DeleteOrgInviteMutation = { __typename?: 'Mutation', deleteInvitation?: { __typename?: 'DeleteInviteMutation', ok?: boolean | null } | null };

export type RemoveMemberMutationVariables = Exact<{
  memberId: Scalars['ID']['input'];
}>;


export type RemoveMemberMutation = { __typename?: 'Mutation', deleteOrganisationMember?: { __typename?: 'DeleteOrganisationMemberMutation', ok?: boolean | null } | null };

export type TransferOrgOwnershipMutationVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  newOwnerId: Scalars['ID']['input'];
  billingEmail?: InputMaybe<Scalars['String']['input']>;
}>;


export type TransferOrgOwnershipMutation = { __typename?: 'Mutation', transferOrganisationOwnership?: { __typename?: 'TransferOrganisationOwnershipMutation', ok?: boolean | null } | null };

export type UpdateMemberRoleMutationVariables = Exact<{
  memberId: Scalars['ID']['input'];
  roleId: Scalars['ID']['input'];
}>;


export type UpdateMemberRoleMutation = { __typename?: 'Mutation', updateOrganisationMemberRole?: { __typename?: 'UpdateOrganisationMemberRole', orgMember?: { __typename?: 'OrganisationMemberType', id: string, role?: { __typename?: 'RoleType', name?: string | null } | null } | null } | null };

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

export type CreateServiceAccountOpMutationVariables = Exact<{
  name: Scalars['String']['input'];
  orgId: Scalars['ID']['input'];
  roleId: Scalars['ID']['input'];
  identityKey: Scalars['String']['input'];
  handlers?: InputMaybe<Array<InputMaybe<ServiceAccountHandlerInput>> | InputMaybe<ServiceAccountHandlerInput>>;
  serverWrappedKeyring?: InputMaybe<Scalars['String']['input']>;
  serverWrappedRecovery?: InputMaybe<Scalars['String']['input']>;
}>;


export type CreateServiceAccountOpMutation = { __typename?: 'Mutation', createServiceAccount?: { __typename?: 'CreateServiceAccountMutation', serviceAccount?: { __typename?: 'ServiceAccountType', id: string } | null } | null };

export type CreateSaTokenMutationVariables = Exact<{
  serviceAccountId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  identityKey: Scalars['String']['input'];
  token: Scalars['String']['input'];
  wrappedKeyShare: Scalars['String']['input'];
  expiry?: InputMaybe<Scalars['BigInt']['input']>;
}>;


export type CreateSaTokenMutation = { __typename?: 'Mutation', createServiceAccountToken?: { __typename?: 'CreateServiceAccountTokenMutation', token?: { __typename?: 'ServiceAccountTokenType', id: string } | null } | null };

export type DeleteServiceAccountOpMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteServiceAccountOpMutation = { __typename?: 'Mutation', deleteServiceAccount?: { __typename?: 'DeleteServiceAccountMutation', ok?: boolean | null } | null };

export type DeleteServiceAccountTokenOpMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteServiceAccountTokenOpMutation = { __typename?: 'Mutation', deleteServiceAccountToken?: { __typename?: 'DeleteServiceAccountTokenMutation', ok?: boolean | null } | null };

export type EnableSaClientKeyManagementMutationVariables = Exact<{
  serviceAccountId: Scalars['ID']['input'];
}>;


export type EnableSaClientKeyManagementMutation = { __typename?: 'Mutation', enableServiceAccountClientSideKeyManagement?: { __typename?: 'EnableServiceAccountClientSideKeyManagementMutation', serviceAccount?: { __typename?: 'ServiceAccountType', id: string, name: string, identityKey?: string | null, serverSideKeyManagementEnabled?: boolean | null } | null } | null };

export type EnableSaServerKeyManagementMutationVariables = Exact<{
  serviceAccountId: Scalars['ID']['input'];
  serverWrappedKeyring: Scalars['String']['input'];
  serverWrappedRecovery: Scalars['String']['input'];
}>;


export type EnableSaServerKeyManagementMutation = { __typename?: 'Mutation', enableServiceAccountServerSideKeyManagement?: { __typename?: 'EnableServiceAccountServerSideKeyManagementMutation', serviceAccount?: { __typename?: 'ServiceAccountType', id: string, name: string, serverSideKeyManagementEnabled?: boolean | null } | null } | null };

export type UpdateServiceAccountHandlerKeysMutationVariables = Exact<{
  orgId: Scalars['ID']['input'];
  handlers?: InputMaybe<Array<InputMaybe<ServiceAccountHandlerInput>> | InputMaybe<ServiceAccountHandlerInput>>;
}>;


export type UpdateServiceAccountHandlerKeysMutation = { __typename?: 'Mutation', updateServiceAccountHandlers?: { __typename?: 'UpdateServiceAccountHandlersMutation', ok?: boolean | null } | null };

export type UpdateServiceAccountOpMutationVariables = Exact<{
  serviceAccountId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  roleId: Scalars['ID']['input'];
  identityIds?: InputMaybe<Array<Scalars['ID']['input']> | Scalars['ID']['input']>;
}>;


export type UpdateServiceAccountOpMutation = { __typename?: 'Mutation', updateServiceAccount?: { __typename?: 'UpdateServiceAccountMutation', serviceAccount?: { __typename?: 'ServiceAccountType', id: string, name: string, role?: { __typename?: 'RoleType', id: string, name?: string | null, description?: string | null, permissions?: any | null } | null, identities?: Array<{ __typename?: 'IdentityType', id: string, name: string }> | null } | null } | null };

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

export type CreateNewCfWorkersSyncMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  path: Scalars['String']['input'];
  workerName: Scalars['String']['input'];
  credentialId: Scalars['ID']['input'];
}>;


export type CreateNewCfWorkersSyncMutation = { __typename?: 'Mutation', createCloudflareWorkersSync?: { __typename?: 'CreateCloudflareWorkersSync', sync?: { __typename?: 'EnvironmentSyncType', id: string, isActive: boolean, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null } | null };

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
  repoName?: InputMaybe<Scalars['String']['input']>;
  owner: Scalars['String']['input'];
  credentialId: Scalars['ID']['input'];
  environmentName?: InputMaybe<Scalars['String']['input']>;
  orgSync?: InputMaybe<Scalars['Boolean']['input']>;
  repoVisibility?: InputMaybe<Scalars['String']['input']>;
}>;


export type CreateNewGhActionsSyncMutation = { __typename?: 'Mutation', createGhActionsSync?: { __typename?: 'CreateGitHubActionsSync', sync?: { __typename?: 'EnvironmentSyncType', id: string, isActive: boolean, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null } | null };

export type CreateNewGhDependabotSyncMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  path: Scalars['String']['input'];
  repoName?: InputMaybe<Scalars['String']['input']>;
  owner: Scalars['String']['input'];
  credentialId: Scalars['ID']['input'];
  orgSync?: InputMaybe<Scalars['Boolean']['input']>;
  repoVisibility?: InputMaybe<Scalars['String']['input']>;
}>;


export type CreateNewGhDependabotSyncMutation = { __typename?: 'Mutation', createGhDependabotSync?: { __typename?: 'CreateGitHubDependabotSync', sync?: { __typename?: 'EnvironmentSyncType', id: string, isActive: boolean, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null } | null };

export type CreateNewGitlabCiSyncMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  path: Scalars['String']['input'];
  credentialId: Scalars['ID']['input'];
  resourcePath: Scalars['String']['input'];
  resourceId: Scalars['String']['input'];
  isGroup: Scalars['Boolean']['input'];
  isMasked: Scalars['Boolean']['input'];
  isProtected: Scalars['Boolean']['input'];
}>;


export type CreateNewGitlabCiSyncMutation = { __typename?: 'Mutation', createGitlabCiSync?: { __typename?: 'CreateGitLabCISync', sync?: { __typename?: 'EnvironmentSyncType', id: string, isActive: boolean, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null } | null };

export type InitAppSyncingMutationVariables = Exact<{
  appId: Scalars['ID']['input'];
  envKeys?: InputMaybe<Array<InputMaybe<EnvironmentKeyInput>> | InputMaybe<EnvironmentKeyInput>>;
}>;


export type InitAppSyncingMutation = { __typename?: 'Mutation', initEnvSync?: { __typename?: 'InitEnvSync', app?: { __typename?: 'AppType', id: string, sseEnabled: boolean } | null } | null };

export type CreateNewNomadSyncMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  path: Scalars['String']['input'];
  nomadPath: Scalars['String']['input'];
  nomadNamespace: Scalars['String']['input'];
  credentialId: Scalars['ID']['input'];
}>;


export type CreateNewNomadSyncMutation = { __typename?: 'Mutation', createNomadSync?: { __typename?: 'CreateNomadSync', sync?: { __typename?: 'EnvironmentSyncType', id: string, isActive: boolean, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null } | null };

export type CreateNewRailwaySyncMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  path: Scalars['String']['input'];
  credentialId: Scalars['ID']['input'];
  railwayProject: RailwayResourceInput;
  railwayEnvironment: RailwayResourceInput;
  railwayService?: InputMaybe<RailwayResourceInput>;
}>;


export type CreateNewRailwaySyncMutation = { __typename?: 'Mutation', createRailwaySync?: { __typename?: 'CreateRailwaySync', sync?: { __typename?: 'EnvironmentSyncType', id: string, isActive: boolean, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null } | null };

export type CreateNewRenderServiceSyncMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  path: Scalars['String']['input'];
  credentialId: Scalars['ID']['input'];
  resourceId: Scalars['String']['input'];
  resourceName: Scalars['String']['input'];
  resourceType: RenderResourceType;
  secretFileName?: InputMaybe<Scalars['String']['input']>;
}>;


export type CreateNewRenderServiceSyncMutation = { __typename?: 'Mutation', createRenderSync?: { __typename?: 'CreateRenderSync', sync?: { __typename?: 'EnvironmentSyncType', id: string, isActive: boolean, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null } | null };

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

export type CreateNewVercelSyncMutationVariables = Exact<{
  envId: Scalars['ID']['input'];
  path: Scalars['String']['input'];
  credentialId: Scalars['ID']['input'];
  projectId: Scalars['String']['input'];
  projectName: Scalars['String']['input'];
  teamId: Scalars['String']['input'];
  teamName: Scalars['String']['input'];
  environment: Scalars['String']['input'];
  secretType: Scalars['String']['input'];
}>;


export type CreateNewVercelSyncMutation = { __typename?: 'Mutation', createVercelSync?: { __typename?: 'CreateVercelSync', sync?: { __typename?: 'EnvironmentSyncType', id: string, isActive: boolean, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null } | null };

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

export type GetIpQueryVariables = Exact<{ [key: string]: never; }>;


export type GetIpQuery = { __typename?: 'Query', clientIp?: string | null };

export type GetNetworkPoliciesQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetNetworkPoliciesQuery = { __typename?: 'Query', clientIp?: string | null, networkAccessPolicies?: Array<{ __typename?: 'NetworkAccessPolicyType', id: string, name: string, allowedIps: string, isGlobal: boolean, createdAt: any, updatedAt: any, createdBy?: { __typename?: 'OrganisationMemberType', fullName?: string | null, avatarUrl?: string | null, self?: boolean | null } | null, updatedBy?: { __typename?: 'OrganisationMemberType', fullName?: string | null, avatarUrl?: string | null, self?: boolean | null } | null } | null> | null };

export type GetAppAccountsQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
}>;


export type GetAppAccountsQuery = { __typename?: 'Query', appUsers?: Array<{ __typename?: 'OrganisationMemberType', id: string, identityKey?: string | null, email?: string | null, fullName?: string | null, avatarUrl?: string | null, createdAt?: any | null, role?: { __typename?: 'RoleType', id: string, name?: string | null, description?: string | null, permissions?: any | null, color?: string | null } | null } | null> | null, appServiceAccounts?: Array<{ __typename?: 'ServiceAccountType', id: string, identityKey?: string | null, name: string, createdAt?: any | null, role?: { __typename?: 'RoleType', id: string, name?: string | null, description?: string | null, permissions?: any | null, color?: string | null } | null, tokens?: Array<{ __typename?: 'ServiceAccountTokenType', id: string, name: string } | null> | null } | null> | null };

export type GetAppMembersQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
}>;


export type GetAppMembersQuery = { __typename?: 'Query', appUsers?: Array<{ __typename?: 'OrganisationMemberType', id: string, identityKey?: string | null, email?: string | null, fullName?: string | null, avatarUrl?: string | null, createdAt?: any | null, role?: { __typename?: 'RoleType', id: string, name?: string | null, description?: string | null, permissions?: any | null, color?: string | null } | null } | null> | null };

export type GetAppServiceAccountsQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
}>;


export type GetAppServiceAccountsQuery = { __typename?: 'Query', appServiceAccounts?: Array<{ __typename?: 'ServiceAccountType', id: string, identityKey?: string | null, name: string, createdAt?: any | null, role?: { __typename?: 'RoleType', id: string, name?: string | null, description?: string | null, permissions?: any | null, color?: string | null } | null, tokens?: Array<{ __typename?: 'ServiceAccountTokenType', id: string, name: string } | null> | null } | null> | null };

export type GetCheckoutDetailsQueryVariables = Exact<{
  stripeSessionId: Scalars['String']['input'];
}>;


export type GetCheckoutDetailsQuery = { __typename?: 'Query', stripeCheckoutDetails?: { __typename?: 'StripeCheckoutDetails', paymentStatus?: string | null, customerEmail?: string | null, billingStartDate?: string | null, billingEndDate?: string | null, subscriptionId?: string | null, planName?: string | null } | null };

export type GetCustomerPortalLinkQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetCustomerPortalLinkQuery = { __typename?: 'Query', stripeCustomerPortalUrl?: string | null };

export type GetSubscriptionDetailsQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetSubscriptionDetailsQuery = { __typename?: 'Query', stripeSubscriptionDetails?: { __typename?: 'StripeSubscriptionDetails', subscriptionId?: string | null, planName?: string | null, planType?: PlanTypeEnum | null, billingPeriod?: BillingPeriodEnum | null, status?: string | null, nextPaymentAmount?: number | null, currentPeriodStart?: number | null, currentPeriodEnd?: number | null, renewalDate?: number | null, cancelAt?: number | null, cancelAtPeriodEnd?: boolean | null, paymentMethods?: Array<{ __typename?: 'PaymentMethodDetails', id?: string | null, brand?: string | null, last4?: string | null, expMonth?: number | null, expYear?: number | null, isDefault?: boolean | null } | null> | null } | null };

export type GetStripeSubscriptionEstimateQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  planType: PlanTypeEnum;
  billingPeriod: BillingPeriodEnum;
  previewV2?: InputMaybe<Scalars['Boolean']['input']>;
}>;


export type GetStripeSubscriptionEstimateQuery = { __typename?: 'Query', estimateStripeSubscription?: { __typename?: 'StripePlanEstimate', estimatedTotal?: number | null, seatCount?: number | null, unitPrice?: number | null, currency?: string | null, priceId?: string | null } | null };

export type GetAppActivityChartQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
  period?: InputMaybe<TimeRange>;
}>;


export type GetAppActivityChartQuery = { __typename?: 'Query', appActivityChart?: Array<{ __typename?: 'ChartDataPointType', index?: number | null, date?: any | null, data?: number | null } | null> | null };

export type GetAppDetailQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  appId: Scalars['ID']['input'];
}>;


export type GetAppDetailQuery = { __typename?: 'Query', apps?: Array<{ __typename?: 'AppType', id: string, name: string, description?: string | null, identityKey: string, createdAt?: any | null, appToken: string, appSeed: string, appVersion: number, sseEnabled: boolean } | null> | null };

export type GetAppKmsLogsQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
  start?: InputMaybe<Scalars['BigInt']['input']>;
  end?: InputMaybe<Scalars['BigInt']['input']>;
}>;


export type GetAppKmsLogsQuery = { __typename?: 'Query', kmsLogs?: { __typename?: 'KMSLogsResponseType', count?: number | null, logs?: Array<{ __typename?: 'KMSLogType', id: string, timestamp?: any | null, phaseNode?: string | null, eventType?: string | null, ipAddress?: string | null, country?: string | null, city?: string | null, phSize?: number | null } | null> | null } | null };

export type GetAppsQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  appId?: InputMaybe<Scalars['ID']['input']>;
}>;


export type GetAppsQuery = { __typename?: 'Query', apps?: Array<{ __typename?: 'AppType', id: string, name: string, description?: string | null, identityKey: string, createdAt?: any | null, updatedAt: any, sseEnabled: boolean, members: Array<{ __typename?: 'OrganisationMemberType', id: string, email?: string | null, fullName?: string | null, avatarUrl?: string | null } | null>, serviceAccounts: Array<{ __typename?: 'ServiceAccountType', id: string, name: string } | null>, environments: Array<{ __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices, syncs: Array<{ __typename?: 'EnvironmentSyncType', id: string, status: ApiEnvironmentSyncStatusChoices, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null, provider?: { __typename?: 'ProviderType', id: string, name: string } | null } | null } | null> } | null> } | null> | null };

export type GetDashboardQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetDashboardQuery = { __typename?: 'Query', apps?: Array<{ __typename?: 'AppType', id: string, name: string, sseEnabled: boolean } | null> | null, userTokens?: Array<{ __typename?: 'UserTokenType', id: string } | null> | null, organisationInvites?: Array<{ __typename?: 'OrganisationMemberInviteType', id: string } | null> | null, organisationMembers?: Array<{ __typename?: 'OrganisationMemberType', id: string } | null> | null, savedCredentials?: Array<{ __typename?: 'ProviderCredentialsType', id: string } | null> | null, syncs?: Array<{ __typename?: 'EnvironmentSyncType', id: string } | null> | null };

export type GetOrganisationsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetOrganisationsQuery = { __typename?: 'Query', organisations?: Array<{ __typename?: 'OrganisationType', id: string, name: string, identityKey: string, createdAt?: any | null, plan: ApiOrganisationPlanChoices, memberId?: string | null, keyring?: string | null, recovery?: string | null, pricingVersion: number, planDetail?: { __typename?: 'OrganisationPlanType', name?: string | null, maxUsers?: number | null, maxApps?: number | null, maxEnvsPerApp?: number | null, appCount?: number | null, seatsUsed?: { __typename?: 'SeatsUsed', users?: number | null, serviceAccounts?: number | null, total?: number | null } | null } | null, role?: { __typename?: 'RoleType', name?: string | null, description?: string | null, color?: string | null, permissions?: any | null } | null } | null> | null };

export type GetAwsStsEndpointsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetAwsStsEndpointsQuery = { __typename?: 'Query', awsStsEndpoints?: Array<any | null> | null };

export type GetIdentityProvidersQueryVariables = Exact<{ [key: string]: never; }>;


export type GetIdentityProvidersQuery = { __typename?: 'Query', identityProviders?: Array<{ __typename?: 'IdentityProviderType', id: string, name: string, description: string, iconId: string, supported: boolean } | null> | null };

export type GetOrganisationIdentitiesQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetOrganisationIdentitiesQuery = { __typename?: 'Query', identities?: Array<{ __typename?: 'IdentityType', id: string, provider: string, name: string, description?: string | null, tokenNamePattern?: string | null, defaultTtlSeconds: number, maxTtlSeconds: number, createdAt?: any | null, config?: { __typename?: 'AwsIamConfigType', trustedPrincipals?: Array<string | null> | null, signatureTtlSeconds?: number | null, stsEndpoint?: string | null } | null } | null> | null };

export type CheckOrganisationNameAvailabilityQueryVariables = Exact<{
  name: Scalars['String']['input'];
}>;


export type CheckOrganisationNameAvailabilityQuery = { __typename?: 'Query', organisationNameAvailable?: boolean | null };

export type GetGlobalAccessUsersQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetGlobalAccessUsersQuery = { __typename?: 'Query', organisationGlobalAccessUsers?: Array<{ __typename?: 'OrganisationMemberType', id: string, identityKey?: string | null, self?: boolean | null, role?: { __typename?: 'RoleType', name?: string | null, permissions?: any | null } | null } | null> | null };

export type GetInvitesQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
}>;


export type GetInvitesQuery = { __typename?: 'Query', organisationInvites?: Array<{ __typename?: 'OrganisationMemberInviteType', id: string, createdAt?: any | null, expiresAt: any, inviteeEmail: string, invitedBy: { __typename?: 'OrganisationMemberType', email?: string | null, fullName?: string | null, self?: boolean | null }, role?: { __typename?: 'RoleType', id: string, name?: string | null, description?: string | null, color?: string | null } | null } | null> | null };

export type GetLicenseDataQueryVariables = Exact<{ [key: string]: never; }>;


export type GetLicenseDataQuery = { __typename?: 'Query', license?: { __typename?: 'PhaseLicenseType', id?: string | null, customerName?: string | null, organisationName?: string | null, expiresAt?: any | null, plan?: PlanTier | null, seats?: number | null, isActivated?: boolean | null, organisationOwner?: { __typename?: 'OrganisationMemberType', fullName?: string | null, email?: string | null } | null } | null };

export type GetOrgLicenseQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetOrgLicenseQuery = { __typename?: 'Query', organisationLicense?: { __typename?: 'ActivatedPhaseLicenseType', id: string, customerName: string, issuedAt: any, expiresAt: any, activatedAt: any, plan: ApiActivatedPhaseLicensePlanChoices, seats?: number | null, tokens?: number | null } | null };

export type GetOrganisationMembersQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  role?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>> | InputMaybe<Scalars['String']['input']>>;
}>;


export type GetOrganisationMembersQuery = { __typename?: 'Query', organisationMembers?: Array<{ __typename?: 'OrganisationMemberType', id: string, identityKey?: string | null, email?: string | null, fullName?: string | null, avatarUrl?: string | null, createdAt?: any | null, lastLogin?: any | null, self?: boolean | null, role?: { __typename?: 'RoleType', id: string, name?: string | null, description?: string | null, permissions?: any | null, color?: string | null } | null } | null> | null };

export type GetOrganisationPlanQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetOrganisationPlanQuery = { __typename?: 'Query', organisationPlan?: { __typename?: 'OrganisationPlanType', name?: string | null, maxUsers?: number | null, maxApps?: number | null, maxEnvsPerApp?: number | null, seatLimit?: number | null, appCount?: number | null, seatsUsed?: { __typename?: 'SeatsUsed', users?: number | null, serviceAccounts?: number | null, total?: number | null } | null } | null };

export type GetRolesQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
}>;


export type GetRolesQuery = { __typename?: 'Query', roles?: Array<{ __typename?: 'RoleType', id: string, name?: string | null, description?: string | null, color?: string | null, permissions?: any | null, isDefault?: boolean | null } | null> | null };

export type VerifyInviteQueryVariables = Exact<{
  inviteId: Scalars['ID']['input'];
}>;


export type VerifyInviteQuery = { __typename?: 'Query', validateInvite?: { __typename?: 'OrganisationMemberInviteType', id: string, inviteeEmail: string, organisation: { __typename?: 'OrganisationType', id: string, name: string }, invitedBy: { __typename?: 'OrganisationMemberType', fullName?: string | null, email?: string | null }, apps: Array<{ __typename?: 'AppMembershipType', id: string, name: string }> } | null };

export type GetDynamicSecretsQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
  appId?: InputMaybe<Scalars['ID']['input']>;
  envId?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetDynamicSecretsQuery = { __typename?: 'Query', dynamicSecrets?: Array<{ __typename?: 'DynamicSecretType', id: string, name: string, path: string, description: string, provider: ApiDynamicSecretProviderChoices, defaultTtlSeconds?: number | null, maxTtlSeconds?: number | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, index: number, app: { __typename?: 'AppMembershipType', id: string, name: string } }, config?: { __typename?: 'AWSConfigType', usernameTemplate: string, iamPath?: string | null } | null, keyMap?: Array<{ __typename?: 'KeyMap', id?: string | null, keyName?: string | null, masked?: boolean | null } | null> | null, authentication?: { __typename?: 'ProviderCredentialsType', id: string, name: string } | null } | null> | null };

export type GetDynamicSecretProvidersQueryVariables = Exact<{ [key: string]: never; }>;


export type GetDynamicSecretProvidersQuery = { __typename?: 'Query', dynamicSecretProviders?: Array<{ __typename?: 'DynamicSecretProviderType', id: string, name: string, credentials: any, configMap: any } | null> | null };

export type GetDynamicSecretLeasesQueryVariables = Exact<{
  secretId: Scalars['ID']['input'];
  orgId: Scalars['ID']['input'];
}>;


export type GetDynamicSecretLeasesQuery = { __typename?: 'Query', dynamicSecrets?: Array<{ __typename?: 'DynamicSecretType', id: string, leases: Array<{ __typename?: 'DynamicSecretLeaseType', id: string, name: string, ttl?: number | null, createdAt?: any | null, expiresAt?: any | null, revokedAt?: any | null, status: ApiDynamicSecretLeaseStatusChoices, organisationMember?: { __typename?: 'OrganisationMemberType', id: string, fullName?: string | null, email?: string | null, avatarUrl?: string | null, self?: boolean | null } | null, serviceAccount?: { __typename?: 'ServiceAccountType', id: string, name: string } | null, events?: Array<{ __typename?: 'DynamicSecretLeaseEventType', id: string, eventType: ApiDynamicSecretLeaseEventEventTypeChoices, createdAt: any, metadata: any, ipAddress?: string | null, userAgent?: string | null, organisationMember?: { __typename?: 'OrganisationMemberType', id: string, fullName?: string | null, email?: string | null, avatarUrl?: string | null, self?: boolean | null } | null, serviceAccount?: { __typename?: 'ServiceAccountType', id: string, name: string } | null } | null> | null }> } | null> | null };

export type GetAppEnvironmentsQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
  memberId?: InputMaybe<Scalars['ID']['input']>;
  memberType?: InputMaybe<MemberType>;
}>;


export type GetAppEnvironmentsQuery = { __typename?: 'Query', sseEnabled?: boolean | null, serverPublicKey?: string | null, appEnvironments?: Array<{ __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices, identityKey: string, wrappedSeed?: string | null, wrappedSalt?: string | null, createdAt?: any | null, secretCount?: number | null, folderCount?: number | null, index: number, app: { __typename?: 'AppMembershipType', name: string, id: string }, members: Array<{ __typename?: 'OrganisationMemberType', email?: string | null, fullName?: string | null, avatarUrl?: string | null } | null> } | null> | null };

export type GetAppSecretsQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
  memberId?: InputMaybe<Scalars['ID']['input']>;
  memberType?: InputMaybe<MemberType>;
  path?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetAppSecretsQuery = { __typename?: 'Query', sseEnabled?: boolean | null, serverPublicKey?: string | null, appEnvironments?: Array<{ __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices, identityKey: string, wrappedSeed?: string | null, wrappedSalt?: string | null, createdAt?: any | null, secretCount?: number | null, folderCount?: number | null, index: number, app: { __typename?: 'AppMembershipType', name: string, id: string }, members: Array<{ __typename?: 'OrganisationMemberType', email?: string | null, fullName?: string | null, avatarUrl?: string | null } | null>, folders: Array<{ __typename?: 'SecretFolderType', id: string, name: string, path: string } | null>, secrets: Array<{ __typename?: 'SecretType', id: string, key: string, value: string, comment: string, path: string, tags: Array<{ __typename?: 'SecretTagType', id: string, name: string, color: string }> } | null>, dynamicSecrets: Array<{ __typename?: 'DynamicSecretType', id: string, name: string, path: string, description: string, provider: ApiDynamicSecretProviderChoices, keyMap?: Array<{ __typename?: 'KeyMap', id?: string | null, keyName?: string | null } | null> | null } | null> } | null> | null };

export type GetAppSecretsLogsQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
  start?: InputMaybe<Scalars['BigInt']['input']>;
  end?: InputMaybe<Scalars['BigInt']['input']>;
  eventTypes?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>> | InputMaybe<Scalars['String']['input']>>;
  memberId?: InputMaybe<Scalars['ID']['input']>;
  memberType?: InputMaybe<MemberType>;
  environmentId?: InputMaybe<Scalars['ID']['input']>;
}>;


export type GetAppSecretsLogsQuery = { __typename?: 'Query', secretLogs?: { __typename?: 'SecretLogsResponseType', count?: number | null, logs?: Array<{ __typename?: 'SecretEventType', id: string, path: string, key: string, value: string, version: number, comment: string, timestamp: any, ipAddress?: string | null, userAgent?: string | null, eventType: ApiSecretEventEventTypeChoices, tags: Array<{ __typename?: 'SecretTagType', id: string, name: string, color: string }>, user?: { __typename?: 'OrganisationMemberType', email?: string | null, username?: string | null, fullName?: string | null, avatarUrl?: string | null } | null, serviceToken?: { __typename?: 'ServiceTokenType', id: string, name: string } | null, serviceAccount?: { __typename?: 'ServiceAccountType', id: string, name: string, deletedAt?: any | null } | null, serviceAccountToken?: { __typename?: 'ServiceAccountTokenType', id: string, name: string, deletedAt?: any | null } | null, environment: { __typename?: 'EnvironmentType', id: string, envType: ApiEnvironmentEnvTypeChoices, name: string }, secret: { __typename?: 'SecretType', id: string, path: string } } | null> | null } | null, environmentKeys?: Array<{ __typename?: 'EnvironmentKeyType', id: string, identityKey: string, wrappedSeed: string, wrappedSalt: string, environment: { __typename?: 'EnvironmentType', id: string } } | null> | null };

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

export type GetOrgSecretKeysQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetOrgSecretKeysQuery = { __typename?: 'Query', apps?: Array<{ __typename?: 'AppType', id: string, name: string, environments: Array<{ __typename?: 'EnvironmentType', id: string, name: string, wrappedSeed?: string | null, wrappedSalt?: string | null, secrets: Array<{ __typename?: 'SecretType', id: string, key: string, path: string } | null> } | null> } | null> | null };

export type GetSecretHistoryQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
  envId: Scalars['ID']['input'];
  id: Scalars['ID']['input'];
}>;


export type GetSecretHistoryQuery = { __typename?: 'Query', secrets?: Array<{ __typename?: 'SecretType', id: string, history?: Array<{ __typename?: 'SecretEventType', id: string, key: string, value: string, path: string, version: number, comment: string, timestamp: any, ipAddress?: string | null, userAgent?: string | null, eventType: ApiSecretEventEventTypeChoices, tags: Array<{ __typename?: 'SecretTagType', id: string, name: string, color: string }>, user?: { __typename?: 'OrganisationMemberType', email?: string | null, username?: string | null, fullName?: string | null, avatarUrl?: string | null } | null, serviceToken?: { __typename?: 'ServiceTokenType', id: string, name: string } | null, serviceAccount?: { __typename?: 'ServiceAccountType', id: string, name: string, deletedAt?: any | null } | null } | null> | null } | null> | null, environmentKeys?: Array<{ __typename?: 'EnvironmentKeyType', id: string, identityKey: string, wrappedSeed: string, wrappedSalt: string } | null> | null };

export type GetEnvSecretsKvQueryVariables = Exact<{
  envId: Scalars['ID']['input'];
}>;


export type GetEnvSecretsKvQuery = { __typename?: 'Query', folders?: Array<{ __typename?: 'SecretFolderType', id: string, name: string } | null> | null, secrets?: Array<{ __typename?: 'SecretType', id: string, key: string, value: string, comment: string, path: string } | null> | null, environmentKeys?: Array<{ __typename?: 'EnvironmentKeyType', id: string, identityKey: string, wrappedSeed: string, wrappedSalt: string } | null> | null };

export type GetSecretTagsQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
}>;


export type GetSecretTagsQuery = { __typename?: 'Query', secretTags?: Array<{ __typename?: 'SecretTagType', id: string, name: string, color: string } | null> | null };

export type GetSecretsQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
  envId: Scalars['ID']['input'];
  path?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetSecretsQuery = { __typename?: 'Query', secrets?: Array<{ __typename?: 'SecretType', id: string, key: string, value: string, path: string, comment: string, createdAt?: any | null, updatedAt: any, tags: Array<{ __typename?: 'SecretTagType', id: string, name: string, color: string }>, override?: { __typename?: 'PersonalSecretType', value?: string | null, isActive: boolean } | null, environment: { __typename?: 'EnvironmentType', id: string, app: { __typename?: 'AppMembershipType', id: string } } } | null> | null, folders?: Array<{ __typename?: 'SecretFolderType', id: string, name: string, path: string, createdAt?: any | null, folderCount?: number | null, secretCount?: number | null } | null> | null, appEnvironments?: Array<{ __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices, identityKey: string, app: { __typename?: 'AppMembershipType', id: string, name: string, sseEnabled: boolean } } | null> | null, environmentKeys?: Array<{ __typename?: 'EnvironmentKeyType', id: string, identityKey: string, wrappedSeed: string, wrappedSalt: string } | null> | null, envSyncs?: Array<{ __typename?: 'EnvironmentSyncType', id: string, options: any, isActive: boolean, status: ApiEnvironmentSyncStatusChoices, lastSync?: any | null, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null } | null } | null> | null, dynamicSecrets?: Array<{ __typename?: 'DynamicSecretType', id: string, name: string, path: string, description: string, provider: ApiDynamicSecretProviderChoices, defaultTtlSeconds?: number | null, maxTtlSeconds?: number | null, createdAt?: any | null, keyMap?: Array<{ __typename?: 'KeyMap', id?: string | null, keyName?: string | null, masked?: boolean | null } | null> | null, config?: { __typename?: 'AWSConfigType', usernameTemplate: string, groups?: string | null, iamPath?: string | null, permissionBoundaryArn?: string | null, policyArns?: string | null, policyDocument?: any | null } | null, authentication?: { __typename?: 'ProviderCredentialsType', id: string, name: string } | null } | null> | null };

export type GetServiceTokensQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
}>;


export type GetServiceTokensQuery = { __typename?: 'Query', serviceTokens?: Array<{ __typename?: 'ServiceTokenType', id: string, name: string, createdAt?: any | null, expiresAt?: any | null, createdBy?: { __typename?: 'OrganisationMemberType', fullName?: string | null, avatarUrl?: string | null, self?: boolean | null } | null, keys: Array<{ __typename?: 'ServerEnvironmentKeyType', id: string, identityKey: string }> } | null> | null };

export type GetServiceAccountDetailQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
}>;


export type GetServiceAccountDetailQuery = { __typename?: 'Query', serviceAccounts?: Array<{ __typename?: 'ServiceAccountType', id: string, name: string, identityKey?: string | null, serverSideKeyManagementEnabled?: boolean | null, createdAt?: any | null, role?: { __typename?: 'RoleType', id: string, name?: string | null, description?: string | null, color?: string | null, permissions?: any | null } | null, handlers?: Array<{ __typename?: 'ServiceAccountHandlerType', id: string, wrappedKeyring: string, wrappedRecovery: string, user: { __typename?: 'OrganisationMemberType', self?: boolean | null } } | null> | null, appMemberships?: Array<{ __typename?: 'AppMembershipType', id: string, name: string, sseEnabled: boolean, environments: Array<{ __typename?: 'EnvironmentType', id: string, name: string } | null> }> | null, networkPolicies?: Array<{ __typename?: 'NetworkAccessPolicyType', id: string, name: string, allowedIps: string, isGlobal: boolean }> | null, identities?: Array<{ __typename?: 'IdentityType', id: string, name: string, description?: string | null }> | null } | null> | null };

export type GetServiceAccountHandlersQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
}>;


export type GetServiceAccountHandlersQuery = { __typename?: 'Query', serviceAccountHandlers?: Array<{ __typename?: 'OrganisationMemberType', id: string, email?: string | null, identityKey?: string | null, self?: boolean | null, role?: { __typename?: 'RoleType', name?: string | null, permissions?: any | null } | null } | null> | null };

export type GetServiceAccountTokensQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
}>;


export type GetServiceAccountTokensQuery = { __typename?: 'Query', serviceAccounts?: Array<{ __typename?: 'ServiceAccountType', id: string, tokens?: Array<{ __typename?: 'ServiceAccountTokenType', id: string, name: string, createdAt?: any | null, expiresAt?: any | null, lastUsed?: any | null, createdBy?: { __typename?: 'OrganisationMemberType', fullName?: string | null, avatarUrl?: string | null, self?: boolean | null } | null, createdByServiceAccount?: { __typename?: 'ServiceAccountType', id: string, name: string, identityKey?: string | null } | null } | null> | null } | null> | null };

export type GetServiceAccountsQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
}>;


export type GetServiceAccountsQuery = { __typename?: 'Query', serviceAccounts?: Array<{ __typename?: 'ServiceAccountType', id: string, name: string, identityKey?: string | null, createdAt?: any | null, role?: { __typename?: 'RoleType', id: string, name?: string | null, description?: string | null, color?: string | null } | null, handlers?: Array<{ __typename?: 'ServiceAccountHandlerType', id: string, wrappedKeyring: string, wrappedRecovery: string, user: { __typename?: 'OrganisationMemberType', self?: boolean | null } } | null> | null } | null> | null };

export type GetOrganisationSyncsQueryVariables = Exact<{
  orgId: Scalars['ID']['input'];
}>;


export type GetOrganisationSyncsQuery = { __typename?: 'Query', syncs?: Array<{ __typename?: 'EnvironmentSyncType', id: string, path: string, options: any, isActive: boolean, lastSync?: any | null, status: ApiEnvironmentSyncStatusChoices, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices, app: { __typename?: 'AppMembershipType', id: string, name: string } }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null, provider?: { __typename?: 'ProviderType', id: string } | null } | null, authentication?: { __typename?: 'ProviderCredentialsType', id: string, name: string, credentials: any } | null, history: Array<{ __typename?: 'EnvironmentSyncEventType', id: string, status: ApiEnvironmentSyncEventStatusChoices, createdAt?: any | null, completedAt?: any | null, meta?: any | null }> } | null> | null, savedCredentials?: Array<{ __typename?: 'ProviderCredentialsType', id: string, name: string, credentials: any, createdAt?: any | null, syncCount?: number | null, provider?: { __typename?: 'ProviderType', id: string, name: string, expectedCredentials: Array<string>, optionalCredentials: Array<string> } | null } | null> | null, apps?: Array<{ __typename?: 'AppType', id: string, name: string, identityKey: string, createdAt?: any | null, sseEnabled: boolean, members: Array<{ __typename?: 'OrganisationMemberType', id: string, fullName?: string | null, avatarUrl?: string | null, email?: string | null } | null>, serviceAccounts: Array<{ __typename?: 'ServiceAccountType', id: string, name: string } | null>, environments: Array<{ __typename?: 'EnvironmentType', id: string, name: string, syncs: Array<{ __typename?: 'EnvironmentSyncType', id: string, status: ApiEnvironmentSyncStatusChoices, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null, provider?: { __typename?: 'ProviderType', id: string, name: string } | null } | null } | null> } | null> } | null> | null };

export type GetAwsSecretsQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type GetAwsSecretsQuery = { __typename?: 'Query', awsSecrets?: Array<{ __typename?: 'AWSSecretType', name?: string | null, arn?: string | null } | null> | null };

export type ValidateAwsAssumeRoleAuthQueryVariables = Exact<{ [key: string]: never; }>;


export type ValidateAwsAssumeRoleAuthQuery = { __typename?: 'Query', validateAwsAssumeRoleAuth?: { __typename?: 'AWSValidationResultType', valid: boolean, message: string, method?: string | null, error?: string | null } | null };

export type ValidateAwsAssumeRoleCredentialsQueryVariables = Exact<{
  roleArn: Scalars['String']['input'];
  region?: InputMaybe<Scalars['String']['input']>;
  externalId?: InputMaybe<Scalars['String']['input']>;
}>;


export type ValidateAwsAssumeRoleCredentialsQuery = { __typename?: 'Query', validateAwsAssumeRoleCredentials?: { __typename?: 'AWSValidationResultType', valid: boolean, message: string, error?: string | null, assumedRoleArn?: string | null } | null };

export type GetCfPagesQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type GetCfPagesQuery = { __typename?: 'Query', cloudflarePagesProjects?: Array<{ __typename?: 'CloudFlarePagesType', name?: string | null, deploymentId?: string | null, environments?: Array<string | null> | null } | null> | null };

export type GetCfWorkersQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type GetCfWorkersQuery = { __typename?: 'Query', cloudflareWorkers?: Array<{ __typename?: 'CloudflareWorkerType', name?: string | null, scriptId?: string | null } | null> | null };

export type GetAppSyncStatusQueryVariables = Exact<{
  appId: Scalars['ID']['input'];
}>;


export type GetAppSyncStatusQuery = { __typename?: 'Query', sseEnabled?: boolean | null, serverPublicKey?: string | null, syncs?: Array<{ __typename?: 'EnvironmentSyncType', id: string, path: string, options: any, isActive: boolean, lastSync?: any | null, status: ApiEnvironmentSyncStatusChoices, createdAt?: any | null, environment: { __typename?: 'EnvironmentType', id: string, name: string, envType: ApiEnvironmentEnvTypeChoices, app: { __typename?: 'AppMembershipType', id: string, name: string } }, serviceInfo?: { __typename?: 'ServiceType', id?: string | null, name?: string | null, provider?: { __typename?: 'ProviderType', id: string } | null } | null, authentication?: { __typename?: 'ProviderCredentialsType', id: string, name: string, credentials: any } | null, history: Array<{ __typename?: 'EnvironmentSyncEventType', id: string, status: ApiEnvironmentSyncEventStatusChoices, createdAt?: any | null, completedAt?: any | null, meta?: any | null }> } | null> | null };

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

export type GetGithubEnvironmentsQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
  owner: Scalars['String']['input'];
  repoName: Scalars['String']['input'];
}>;


export type GetGithubEnvironmentsQuery = { __typename?: 'Query', githubEnvironments?: Array<string | null> | null };

export type GetGithubOrgsQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type GetGithubOrgsQuery = { __typename?: 'Query', githubOrgs?: Array<{ __typename?: 'GitHubOrgType', name?: string | null, role?: string | null } | null> | null };

export type GetGithubReposQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type GetGithubReposQuery = { __typename?: 'Query', githubRepos?: Array<{ __typename?: 'GitHubRepoType', name?: string | null, owner?: string | null, type?: string | null } | null> | null };

export type GetGitLabResourcesQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type GetGitLabResourcesQuery = { __typename?: 'Query', gitlabProjects?: Array<{ __typename?: 'GitLabProjectType', id?: string | null, name?: string | null, pathWithNamespace?: string | null, webUrl?: string | null, namespace?: { __typename?: 'NamespaceType', name?: string | null, fullPath?: string | null } | null } | null> | null, gitlabGroups?: Array<{ __typename?: 'GitLabGroupType', id?: string | null, fullName?: string | null, fullPath?: string | null, webUrl?: string | null } | null> | null };

export type TestNomadAuthQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type TestNomadAuthQuery = { __typename?: 'Query', testNomadCreds?: boolean | null };

export type GetRailwayProjectsQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type GetRailwayProjectsQuery = { __typename?: 'Query', railwayProjects?: Array<{ __typename?: 'RailwayProjectType', id: string, name: string, environments: Array<{ __typename?: 'RailwayEnvironmentType', id: string, name: string }>, services: Array<{ __typename?: 'RailwayServiceType', id: string, name: string }> } | null> | null };

export type GetRenderResourcesQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type GetRenderResourcesQuery = { __typename?: 'Query', renderServices?: Array<{ __typename?: 'RenderServiceType', id: string, name: string, type?: string | null } | null> | null, renderEnvgroups?: Array<{ __typename?: 'RenderEnvGroupType', id: string, name: string } | null> | null };

export type TestVaultAuthQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type TestVaultAuthQuery = { __typename?: 'Query', testVaultCreds?: boolean | null };

export type GetVercelProjectsQueryVariables = Exact<{
  credentialId: Scalars['ID']['input'];
}>;


export type GetVercelProjectsQuery = { __typename?: 'Query', vercelProjects?: Array<{ __typename?: 'VercelTeamProjectsType', id: string, teamName: string, projects?: Array<{ __typename?: 'VercelProjectType', id: string, name: string, environments?: Array<{ __typename?: 'VercelEnvironmentType', id: string, name: string, slug: string, type?: string | null } | null> | null } | null> | null } | null> | null };

export type GetOrganisationMemberDetailQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
}>;


export type GetOrganisationMemberDetailQuery = { __typename?: 'Query', organisationMembers?: Array<{ __typename?: 'OrganisationMemberType', id: string, identityKey?: string | null, email?: string | null, fullName?: string | null, avatarUrl?: string | null, createdAt?: any | null, lastLogin?: any | null, self?: boolean | null, role?: { __typename?: 'RoleType', id: string, name?: string | null, description?: string | null, permissions?: any | null, color?: string | null } | null, appMemberships?: Array<{ __typename?: 'AppMembershipType', id: string, name: string, sseEnabled: boolean, environments: Array<{ __typename?: 'EnvironmentType', id: string, name: string } | null> }> | null, tokens?: Array<{ __typename?: 'UserTokenType', id: string, name: string, createdAt?: any | null, expiresAt?: any | null }> | null, networkPolicies?: Array<{ __typename?: 'NetworkAccessPolicyType', id: string, name: string, allowedIps: string, isGlobal: boolean }> | null } | null> | null };

export type GetUserTokensQueryVariables = Exact<{
  organisationId: Scalars['ID']['input'];
}>;


export type GetUserTokensQuery = { __typename?: 'Query', userTokens?: Array<{ __typename?: 'UserTokenType', id: string, name: string, wrappedKeyShare: string, createdAt?: any | null, expiresAt?: any | null } | null> | null };


export const CreateAccessPolicyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateAccessPolicy"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"allowedIps"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"isGlobal"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createNetworkAccessPolicy"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"allowedIps"},"value":{"kind":"Variable","name":{"kind":"Name","value":"allowedIps"}}},{"kind":"Argument","name":{"kind":"Name","value":"isGlobal"},"value":{"kind":"Variable","name":{"kind":"Name","value":"isGlobal"}}},{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"networkAccessPolicy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<CreateAccessPolicyMutation, CreateAccessPolicyMutationVariables>;
export const CreateRoleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateRole"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"description"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"color"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"permissions"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"JSONString"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createCustomRole"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"description"},"value":{"kind":"Variable","name":{"kind":"Name","value":"description"}}},{"kind":"Argument","name":{"kind":"Name","value":"color"},"value":{"kind":"Variable","name":{"kind":"Name","value":"color"}}},{"kind":"Argument","name":{"kind":"Name","value":"permissions"},"value":{"kind":"Variable","name":{"kind":"Name","value":"permissions"}}},{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<CreateRoleMutation, CreateRoleMutationVariables>;
export const DeleteAccessPolicyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteAccessPolicy"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteNetworkAccessPolicy"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteAccessPolicyMutation, DeleteAccessPolicyMutationVariables>;
export const DeleteRoleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteRole"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteCustomRole"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteRoleMutation, DeleteRoleMutationVariables>;
export const UpdateAccountNetworkPolicyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAccountNetworkPolicy"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"accounts"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AccountPolicyInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAccountNetworkAccessPolicies"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"accountInputs"},"value":{"kind":"Variable","name":{"kind":"Name","value":"accounts"}}},{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<UpdateAccountNetworkPolicyMutation, UpdateAccountNetworkPolicyMutationVariables>;
export const UpdateAccessPoliciesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAccessPolicies"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"inputs"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdatePolicyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateNetworkAccessPolicy"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"policyInputs"},"value":{"kind":"Variable","name":{"kind":"Name","value":"inputs"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"networkAccessPolicy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateAccessPoliciesMutation, UpdateAccessPoliciesMutationVariables>;
export const UpdateRoleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateRole"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"description"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"color"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"permissions"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"JSONString"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateCustomRole"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"description"},"value":{"kind":"Variable","name":{"kind":"Name","value":"description"}}},{"kind":"Argument","name":{"kind":"Name","value":"color"},"value":{"kind":"Variable","name":{"kind":"Name","value":"color"}}},{"kind":"Argument","name":{"kind":"Name","value":"permissions"},"value":{"kind":"Variable","name":{"kind":"Name","value":"permissions"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateRoleMutation, UpdateRoleMutationVariables>;
export const AddMemberToAppDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddMemberToApp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberType"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MemberType"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addAppMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}},{"kind":"Argument","name":{"kind":"Name","value":"memberType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberType"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"envKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envKeys"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<AddMemberToAppMutation, AddMemberToAppMutationVariables>;
export const BulkAddMembersToAppDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"BulkAddMembersToApp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"members"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AppMemberInputType"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bulkAddAppMembers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"members"},"value":{"kind":"Variable","name":{"kind":"Name","value":"members"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<BulkAddMembersToAppMutation, BulkAddMembersToAppMutationVariables>;
export const RemoveMemberFromAppDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveMemberFromApp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberType"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MemberType"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeAppMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}},{"kind":"Argument","name":{"kind":"Name","value":"memberType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberType"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<RemoveMemberFromAppMutation, RemoveMemberFromAppMutationVariables>;
export const UpdateAppInfoOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAppInfoOp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"description"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAppInfo"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"description"},"value":{"kind":"Variable","name":{"kind":"Name","value":"description"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateAppInfoOpMutation, UpdateAppInfoOpMutationVariables>;
export const UpdateEnvScopeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateEnvScope"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberType"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MemberType"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateMemberEnvironmentScope"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}},{"kind":"Argument","name":{"kind":"Name","value":"memberType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberType"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"envKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envKeys"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateEnvScopeMutation, UpdateEnvScopeMutationVariables>;
export const CancelStripeSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CancelStripeSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"subscriptionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cancelSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"subscriptionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"subscriptionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"success"}}]}}]}}]} as unknown as DocumentNode<CancelStripeSubscriptionMutation, CancelStripeSubscriptionMutationVariables>;
export const CreateStripeSetupIntentOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateStripeSetupIntentOp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSetupIntent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clientSecret"}}]}}]}}]} as unknown as DocumentNode<CreateStripeSetupIntentOpMutation, CreateStripeSetupIntentOpMutationVariables>;
export const DeleteStripePaymentMethodDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteStripePaymentMethod"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"paymentMethodId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deletePaymentMethod"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"paymentMethodId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"paymentMethodId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteStripePaymentMethodMutation, DeleteStripePaymentMethodMutationVariables>;
export const InitStripeUpgradeCheckoutDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"InitStripeUpgradeCheckout"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"planType"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PlanTypeEnum"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"billingPeriod"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BillingPeriodEnum"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSubscriptionCheckoutSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"planType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"planType"}}},{"kind":"Argument","name":{"kind":"Name","value":"billingPeriod"},"value":{"kind":"Variable","name":{"kind":"Name","value":"billingPeriod"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clientSecret"}}]}}]}}]} as unknown as DocumentNode<InitStripeUpgradeCheckoutMutation, InitStripeUpgradeCheckoutMutationVariables>;
export const MigratePricingOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MigratePricingOp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"migratePricing"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"success"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]} as unknown as DocumentNode<MigratePricingOpMutation, MigratePricingOpMutationVariables>;
export const ModifyStripeSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ModifyStripeSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"subscriptionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"planType"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PlanTypeEnum"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"billingPeriod"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BillingPeriodEnum"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"modifySubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"subscriptionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"subscriptionId"}}},{"kind":"Argument","name":{"kind":"Name","value":"planType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"planType"}}},{"kind":"Argument","name":{"kind":"Name","value":"billingPeriod"},"value":{"kind":"Variable","name":{"kind":"Name","value":"billingPeriod"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"success"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<ModifyStripeSubscriptionMutation, ModifyStripeSubscriptionMutationVariables>;
export const ResumeStripeSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ResumeStripeSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"subscriptionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resumeSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"subscriptionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"subscriptionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"success"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"cancelledAt"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<ResumeStripeSubscriptionMutation, ResumeStripeSubscriptionMutationVariables>;
export const SetDefaultStripePaymentMethodOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetDefaultStripePaymentMethodOp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"paymentMethodId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setDefaultPaymentMethod"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"paymentMethodId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"paymentMethodId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<SetDefaultStripePaymentMethodOpMutation, SetDefaultStripePaymentMethodOpMutationVariables>;
export const CreateApplicationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateApplication"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appToken"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appSeed"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appVersion"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createApp"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"appToken"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appToken"}}},{"kind":"Argument","name":{"kind":"Name","value":"appSeed"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appSeed"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyShare"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}}},{"kind":"Argument","name":{"kind":"Name","value":"appVersion"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appVersion"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}}]}}]}}]} as unknown as DocumentNode<CreateApplicationMutation, CreateApplicationMutationVariables>;
export const CreateOrgDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateOrg"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyring"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedRecovery"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOrganisation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyring"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyring"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedRecovery"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedRecovery"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"memberId"}}]}}]}}]}}]} as unknown as DocumentNode<CreateOrgMutation, CreateOrgMutationVariables>;
export const DeleteApplicationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteApplication"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteApp"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteApplicationMutation, DeleteApplicationMutationVariables>;
export const BulkProcessSecretsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"BulkProcessSecrets"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretsToCreate"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SecretInput"}}}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretsToUpdate"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SecretInput"}}}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretsToDelete"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSecrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"secretsData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretsToCreate"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secrets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"editSecrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"secretsData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretsToUpdate"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secrets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"deleteSecrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"ids"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretsToDelete"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secrets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<BulkProcessSecretsMutation, BulkProcessSecretsMutationVariables>;
export const CreateEnvDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateEnv"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envInput"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"adminKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedSeed"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedSalt"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createEnvironment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envInput"}}},{"kind":"Argument","name":{"kind":"Name","value":"adminKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"adminKeys"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedSeed"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedSeed"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedSalt"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedSalt"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}}]}}]}}]} as unknown as DocumentNode<CreateEnvMutation, CreateEnvMutationVariables>;
export const CreateEnvKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateEnvKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedSeed"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedSalt"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createEnvironmentKey"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedSeed"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedSeed"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedSalt"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedSalt"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environmentKey"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateEnvKeyMutation, CreateEnvKeyMutationVariables>;
export const CreateEnvTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateEnvToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"token"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createEnvironmentToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"token"},"value":{"kind":"Variable","name":{"kind":"Name","value":"token"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyShare"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environmentToken"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateEnvTokenMutation, CreateEnvTokenMutationVariables>;
export const CreateNewSecretFolderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewSecretFolder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSecretFolder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"folder"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"path"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewSecretFolderMutation, CreateNewSecretFolderMutationVariables>;
export const CreateNewPersonalSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewPersonalSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"newPersonalSecret"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PersonalSecretInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOverride"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"overrideData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"newPersonalSecret"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"override"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"secret"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewPersonalSecretMutation, CreateNewPersonalSecretMutationVariables>;
export const CreateNewSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"newSecret"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SecretInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"secretData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"newSecret"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secret"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewSecretMutation, CreateNewSecretMutationVariables>;
export const CreateNewSecretTagDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewSecretTag"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"color"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSecretTag"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"color"},"value":{"kind":"Variable","name":{"kind":"Name","value":"color"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tag"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewSecretTagMutation, CreateNewSecretTagMutationVariables>;
export const CreateNewServiceTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewServiceToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"environmentKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"token"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"expiry"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createServiceToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"environmentKeys"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"token"},"value":{"kind":"Variable","name":{"kind":"Name","value":"token"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyShare"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"expiry"},"value":{"kind":"Variable","name":{"kind":"Name","value":"expiry"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceToken"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewServiceTokenMutation, CreateNewServiceTokenMutationVariables>;
export const DeleteEnvDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteEnv"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"environmentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteEnvironment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"environmentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteEnvMutation, DeleteEnvMutationVariables>;
export const DeleteFolderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteFolder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"folderId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSecretFolder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"folderId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"folderId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteFolderMutation, DeleteFolderMutationVariables>;
export const DeleteSecretOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSecretOp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secret"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<DeleteSecretOpMutation, DeleteSecretOpMutationVariables>;
export const RevokeServiceTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeServiceToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tokenId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteServiceToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tokenId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tokenId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<RevokeServiceTokenMutation, RevokeServiceTokenMutationVariables>;
export const UpdateSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretData"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SecretInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"editSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"secretData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretData"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secret"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateSecretMutation, UpdateSecretMutationVariables>;
export const InitAppEnvironmentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"InitAppEnvironments"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"devEnv"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"stagingEnv"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"prodEnv"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"devAdminKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"stagAdminKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"prodAdminKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"devEnvironment"},"name":{"kind":"Name","value":"createEnvironment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"devEnv"}}},{"kind":"Argument","name":{"kind":"Name","value":"adminKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"devAdminKeys"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}}]}},{"kind":"Field","alias":{"kind":"Name","value":"stagingEnvironment"},"name":{"kind":"Name","value":"createEnvironment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"stagingEnv"}}},{"kind":"Argument","name":{"kind":"Name","value":"adminKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"stagAdminKeys"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}}]}},{"kind":"Field","alias":{"kind":"Name","value":"prodEnvironment"},"name":{"kind":"Name","value":"createEnvironment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentData"},"value":{"kind":"Variable","name":{"kind":"Name","value":"prodEnv"}}},{"kind":"Argument","name":{"kind":"Name","value":"adminKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"prodAdminKeys"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}}]}}]}}]} as unknown as DocumentNode<InitAppEnvironmentsMutation, InitAppEnvironmentsMutationVariables>;
export const LogSecretReadsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LogSecretReads"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"ids"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"readSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"ids"},"value":{"kind":"Variable","name":{"kind":"Name","value":"ids"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<LogSecretReadsMutation, LogSecretReadsMutationVariables>;
export const RemovePersonalSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemovePersonalSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeOverride"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"secretId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<RemovePersonalSecretMutation, RemovePersonalSecretMutationVariables>;
export const RenameEnvDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RenameEnv"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"environmentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"renameEnvironment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"environmentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<RenameEnvMutation, RenameEnvMutationVariables>;
export const CreateNewAwsDynamicSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewAWSDynamicSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"environmentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"description"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"defaultTtl"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"maxTtl"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"authenticationId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"config"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AWSConfigInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"keyMap"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"KeyMapInput"}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAwsDynamicSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"environmentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"description"},"value":{"kind":"Variable","name":{"kind":"Name","value":"description"}}},{"kind":"Argument","name":{"kind":"Name","value":"defaultTtl"},"value":{"kind":"Variable","name":{"kind":"Name","value":"defaultTtl"}}},{"kind":"Argument","name":{"kind":"Name","value":"maxTtl"},"value":{"kind":"Variable","name":{"kind":"Name","value":"maxTtl"}}},{"kind":"Argument","name":{"kind":"Name","value":"authenticationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"authenticationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"config"},"value":{"kind":"Variable","name":{"kind":"Name","value":"config"}}},{"kind":"Argument","name":{"kind":"Name","value":"keyMap"},"value":{"kind":"Variable","name":{"kind":"Name","value":"keyMap"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"dynamicSecret"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewAwsDynamicSecretMutation, CreateNewAwsDynamicSecretMutationVariables>;
export const CreateDynamicSecretLeaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateDynamicSecretLease"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"ttl"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createDynamicSecretLease"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"secretId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretId"}}},{"kind":"Argument","name":{"kind":"Name","value":"ttl"},"value":{"kind":"Variable","name":{"kind":"Name","value":"ttl"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lease"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"credentials"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AwsCredentialsType"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"accessKeyId"}},{"kind":"Field","name":{"kind":"Name","value":"secretAccessKey"}},{"kind":"Field","name":{"kind":"Name","value":"username"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateDynamicSecretLeaseMutation, CreateDynamicSecretLeaseMutationVariables>;
export const DeleteDynamicSecretOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteDynamicSecretOP"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteDynamicSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"secretId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteDynamicSecretOpMutation, DeleteDynamicSecretOpMutationVariables>;
export const RenewDynamicSecretLeaseOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RenewDynamicSecretLeaseOP"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"leaseId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"ttl"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"renewDynamicSecretLease"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"leaseId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"leaseId"}}},{"kind":"Argument","name":{"kind":"Name","value":"ttl"},"value":{"kind":"Variable","name":{"kind":"Name","value":"ttl"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lease"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]} as unknown as DocumentNode<RenewDynamicSecretLeaseOpMutation, RenewDynamicSecretLeaseOpMutationVariables>;
export const RevokeDynamicSecretLeaseOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeDynamicSecretLeaseOP"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"leaseId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokeDynamicSecretLease"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"leaseId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"leaseId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lease"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"revokedAt"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]} as unknown as DocumentNode<RevokeDynamicSecretLeaseOpMutation, RevokeDynamicSecretLeaseOpMutationVariables>;
export const UpdateDynamicSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateDynamicSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"dynamicSecretId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"description"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"defaultTtl"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"maxTtl"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"authenticationId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"config"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AWSConfigInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"keyMap"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"KeyMapInput"}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAwsDynamicSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"dynamicSecretId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"dynamicSecretId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"description"},"value":{"kind":"Variable","name":{"kind":"Name","value":"description"}}},{"kind":"Argument","name":{"kind":"Name","value":"defaultTtl"},"value":{"kind":"Variable","name":{"kind":"Name","value":"defaultTtl"}}},{"kind":"Argument","name":{"kind":"Name","value":"maxTtl"},"value":{"kind":"Variable","name":{"kind":"Name","value":"maxTtl"}}},{"kind":"Argument","name":{"kind":"Name","value":"authenticationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"authenticationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"config"},"value":{"kind":"Variable","name":{"kind":"Name","value":"config"}}},{"kind":"Argument","name":{"kind":"Name","value":"keyMap"},"value":{"kind":"Variable","name":{"kind":"Name","value":"keyMap"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"dynamicSecret"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateDynamicSecretMutation, UpdateDynamicSecretMutationVariables>;
export const CreateSharedSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateSharedSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"LockboxInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createLockbox"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lockbox"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"allowedViews"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateSharedSecretMutation, CreateSharedSecretMutationVariables>;
export const SwapEnvOrderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SwapEnvOrder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"environment1Id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"environment2Id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"swapEnvironmentOrder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environment1Id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"environment1Id"}}},{"kind":"Argument","name":{"kind":"Name","value":"environment2Id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"environment2Id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<SwapEnvOrderMutation, SwapEnvOrderMutationVariables>;
export const UpdateEnvOrderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateEnvOrder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"environmentOrder"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateEnvironmentOrder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentOrder"},"value":{"kind":"Variable","name":{"kind":"Name","value":"environmentOrder"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<UpdateEnvOrderMutation, UpdateEnvOrderMutationVariables>;
export const CreateExtIdentityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateExtIdentity"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"provider"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"description"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"trustedPrincipals"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"signatureTtlSeconds"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"stsEndpoint"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tokenNamePattern"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"defaultTtlSeconds"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"maxTtlSeconds"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createIdentity"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"provider"},"value":{"kind":"Variable","name":{"kind":"Name","value":"provider"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"description"},"value":{"kind":"Variable","name":{"kind":"Name","value":"description"}}},{"kind":"Argument","name":{"kind":"Name","value":"trustedPrincipals"},"value":{"kind":"Variable","name":{"kind":"Name","value":"trustedPrincipals"}}},{"kind":"Argument","name":{"kind":"Name","value":"signatureTtlSeconds"},"value":{"kind":"Variable","name":{"kind":"Name","value":"signatureTtlSeconds"}}},{"kind":"Argument","name":{"kind":"Name","value":"stsEndpoint"},"value":{"kind":"Variable","name":{"kind":"Name","value":"stsEndpoint"}}},{"kind":"Argument","name":{"kind":"Name","value":"tokenNamePattern"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tokenNamePattern"}}},{"kind":"Argument","name":{"kind":"Name","value":"defaultTtlSeconds"},"value":{"kind":"Variable","name":{"kind":"Name","value":"defaultTtlSeconds"}}},{"kind":"Argument","name":{"kind":"Name","value":"maxTtlSeconds"},"value":{"kind":"Variable","name":{"kind":"Name","value":"maxTtlSeconds"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"config"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AwsIamConfigType"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"trustedPrincipals"}},{"kind":"Field","name":{"kind":"Name","value":"signatureTtlSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"stsEndpoint"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"tokenNamePattern"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTtlSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"maxTtlSeconds"}}]}}]}}]}}]} as unknown as DocumentNode<CreateExtIdentityMutation, CreateExtIdentityMutationVariables>;
export const DeleteExtIdentityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteExtIdentity"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteIdentity"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteExtIdentityMutation, DeleteExtIdentityMutationVariables>;
export const UpdateExtIdentityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateExtIdentity"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"description"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"trustedPrincipals"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"signatureTtlSeconds"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"stsEndpoint"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tokenNamePattern"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"defaultTtlSeconds"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"maxTtlSeconds"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateIdentity"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"description"},"value":{"kind":"Variable","name":{"kind":"Name","value":"description"}}},{"kind":"Argument","name":{"kind":"Name","value":"trustedPrincipals"},"value":{"kind":"Variable","name":{"kind":"Name","value":"trustedPrincipals"}}},{"kind":"Argument","name":{"kind":"Name","value":"signatureTtlSeconds"},"value":{"kind":"Variable","name":{"kind":"Name","value":"signatureTtlSeconds"}}},{"kind":"Argument","name":{"kind":"Name","value":"stsEndpoint"},"value":{"kind":"Variable","name":{"kind":"Name","value":"stsEndpoint"}}},{"kind":"Argument","name":{"kind":"Name","value":"tokenNamePattern"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tokenNamePattern"}}},{"kind":"Argument","name":{"kind":"Name","value":"defaultTtlSeconds"},"value":{"kind":"Variable","name":{"kind":"Name","value":"defaultTtlSeconds"}}},{"kind":"Argument","name":{"kind":"Name","value":"maxTtlSeconds"},"value":{"kind":"Variable","name":{"kind":"Name","value":"maxTtlSeconds"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"config"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AwsIamConfigType"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"trustedPrincipals"}},{"kind":"Field","name":{"kind":"Name","value":"signatureTtlSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"stsEndpoint"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"tokenNamePattern"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTtlSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"maxTtlSeconds"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateExtIdentityMutation, UpdateExtIdentityMutationVariables>;
export const AcceptOrganisationInviteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AcceptOrganisationInvite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyring"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedRecovery"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"inviteId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOrganisationMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyring"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyring"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedRecovery"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedRecovery"}}},{"kind":"Argument","name":{"kind":"Name","value":"inviteId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"inviteId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orgMember"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]}}]} as unknown as DocumentNode<AcceptOrganisationInviteMutation, AcceptOrganisationInviteMutationVariables>;
export const BulkInviteMembersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"BulkInviteMembers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"invites"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"InviteInput"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bulkInviteOrganisationMembers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"invites"},"value":{"kind":"Variable","name":{"kind":"Name","value":"invites"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"invites"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"inviteeEmail"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}}]}}]}}]}}]} as unknown as DocumentNode<BulkInviteMembersMutation, BulkInviteMembersMutationVariables>;
export const DeleteOrgInviteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteOrgInvite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"inviteId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteInvitation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"inviteId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"inviteId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteOrgInviteMutation, DeleteOrgInviteMutationVariables>;
export const RemoveMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteOrganisationMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<RemoveMemberMutation, RemoveMemberMutationVariables>;
export const TransferOrgOwnershipDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"TransferOrgOwnership"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"newOwnerId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"billingEmail"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transferOrganisationOwnership"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"newOwnerId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"newOwnerId"}}},{"kind":"Argument","name":{"kind":"Name","value":"billingEmail"},"value":{"kind":"Variable","name":{"kind":"Name","value":"billingEmail"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<TransferOrgOwnershipMutation, TransferOrgOwnershipMutationVariables>;
export const UpdateMemberRoleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateMemberRole"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"roleId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateOrganisationMemberRole"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}},{"kind":"Argument","name":{"kind":"Name","value":"roleId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"roleId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orgMember"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UpdateMemberRoleMutation, UpdateMemberRoleMutationVariables>;
export const UpdateWrappedSecretsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateWrappedSecrets"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyring"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedRecovery"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateMemberWrappedSecrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyring"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyring"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedRecovery"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedRecovery"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orgMember"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateWrappedSecretsMutation, UpdateWrappedSecretsMutationVariables>;
export const RotateAppKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RotateAppKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appToken"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rotateAppKeys"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"appToken"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appToken"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyShare"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<RotateAppKeyMutation, RotateAppKeyMutationVariables>;
export const CreateServiceAccountOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateServiceAccountOp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"roleId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"handlers"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ServiceAccountHandlerInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"serverWrappedKeyring"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"serverWrappedRecovery"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createServiceAccount"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"roleId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"roleId"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"handlers"},"value":{"kind":"Variable","name":{"kind":"Name","value":"handlers"}}},{"kind":"Argument","name":{"kind":"Name","value":"serverWrappedKeyring"},"value":{"kind":"Variable","name":{"kind":"Name","value":"serverWrappedKeyring"}}},{"kind":"Argument","name":{"kind":"Name","value":"serverWrappedRecovery"},"value":{"kind":"Variable","name":{"kind":"Name","value":"serverWrappedRecovery"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceAccount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<CreateServiceAccountOpMutation, CreateServiceAccountOpMutationVariables>;
export const CreateSaTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateSAToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"serviceAccountId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"token"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"expiry"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createServiceAccountToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"serviceAccountId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"serviceAccountId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"token"},"value":{"kind":"Variable","name":{"kind":"Name","value":"token"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyShare"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}}},{"kind":"Argument","name":{"kind":"Name","value":"expiry"},"value":{"kind":"Variable","name":{"kind":"Name","value":"expiry"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"token"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<CreateSaTokenMutation, CreateSaTokenMutationVariables>;
export const DeleteServiceAccountOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteServiceAccountOp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteServiceAccount"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"serviceAccountId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteServiceAccountOpMutation, DeleteServiceAccountOpMutationVariables>;
export const DeleteServiceAccountTokenOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteServiceAccountTokenOp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteServiceAccountToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tokenId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteServiceAccountTokenOpMutation, DeleteServiceAccountTokenOpMutationVariables>;
export const EnableSaClientKeyManagementDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"EnableSAClientKeyManagement"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"serviceAccountId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"enableServiceAccountClientSideKeyManagement"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"serviceAccountId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"serviceAccountId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceAccount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"serverSideKeyManagementEnabled"}}]}}]}}]}}]} as unknown as DocumentNode<EnableSaClientKeyManagementMutation, EnableSaClientKeyManagementMutationVariables>;
export const EnableSaServerKeyManagementDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"EnableSAServerKeyManagement"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"serviceAccountId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"serverWrappedKeyring"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"serverWrappedRecovery"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"enableServiceAccountServerSideKeyManagement"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"serviceAccountId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"serviceAccountId"}}},{"kind":"Argument","name":{"kind":"Name","value":"serverWrappedKeyring"},"value":{"kind":"Variable","name":{"kind":"Name","value":"serverWrappedKeyring"}}},{"kind":"Argument","name":{"kind":"Name","value":"serverWrappedRecovery"},"value":{"kind":"Variable","name":{"kind":"Name","value":"serverWrappedRecovery"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceAccount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"serverSideKeyManagementEnabled"}}]}}]}}]}}]} as unknown as DocumentNode<EnableSaServerKeyManagementMutation, EnableSaServerKeyManagementMutationVariables>;
export const UpdateServiceAccountHandlerKeysDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateServiceAccountHandlerKeys"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"handlers"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ServiceAccountHandlerInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateServiceAccountHandlers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"handlers"},"value":{"kind":"Variable","name":{"kind":"Name","value":"handlers"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<UpdateServiceAccountHandlerKeysMutation, UpdateServiceAccountHandlerKeysMutationVariables>;
export const UpdateServiceAccountOpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateServiceAccountOp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"serviceAccountId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"roleId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityIds"}},"type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateServiceAccount"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"serviceAccountId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"serviceAccountId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"roleId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"roleId"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityIds"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityIds"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceAccount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}}]}},{"kind":"Field","name":{"kind":"Name","value":"identities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UpdateServiceAccountOpMutation, UpdateServiceAccountOpMutationVariables>;
export const CreateNewAwsSecretsSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewAWSSecretsSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"kmsId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAwsSecretSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}},{"kind":"Argument","name":{"kind":"Name","value":"secretName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretName"}}},{"kind":"Argument","name":{"kind":"Name","value":"kmsId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"kmsId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewAwsSecretsSyncMutation, CreateNewAwsSecretsSyncMutationVariables>;
export const CreateNewCfPagesSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewCfPagesSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"deploymentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectEnv"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createCloudflarePagesSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"projectName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectName"}}},{"kind":"Argument","name":{"kind":"Name","value":"deploymentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"deploymentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"projectEnv"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectEnv"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewCfPagesSyncMutation, CreateNewCfPagesSyncMutationVariables>;
export const CreateNewCfWorkersSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewCfWorkersSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"workerName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createCloudflareWorkersSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"workerName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"workerName"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewCfWorkersSyncMutation, CreateNewCfWorkersSyncMutationVariables>;
export const DeleteProviderCredsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteProviderCreds"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteProviderCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteProviderCredsMutation, DeleteProviderCredsMutationVariables>;
export const DeleteSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteEnvSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"syncId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<DeleteSyncMutation, DeleteSyncMutationVariables>;
export const CreateNewGhActionsSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewGhActionsSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"repoName"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"owner"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"environmentName"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgSync"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"repoVisibility"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createGhActionsSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"repoName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"repoName"}}},{"kind":"Argument","name":{"kind":"Name","value":"owner"},"value":{"kind":"Variable","name":{"kind":"Name","value":"owner"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"environmentName"}}},{"kind":"Argument","name":{"kind":"Name","value":"orgSync"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgSync"}}},{"kind":"Argument","name":{"kind":"Name","value":"repoVisibility"},"value":{"kind":"Variable","name":{"kind":"Name","value":"repoVisibility"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewGhActionsSyncMutation, CreateNewGhActionsSyncMutationVariables>;
export const CreateNewGhDependabotSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewGhDependabotSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"repoName"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"owner"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgSync"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"repoVisibility"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createGhDependabotSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"repoName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"repoName"}}},{"kind":"Argument","name":{"kind":"Name","value":"owner"},"value":{"kind":"Variable","name":{"kind":"Name","value":"owner"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}},{"kind":"Argument","name":{"kind":"Name","value":"orgSync"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgSync"}}},{"kind":"Argument","name":{"kind":"Name","value":"repoVisibility"},"value":{"kind":"Variable","name":{"kind":"Name","value":"repoVisibility"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewGhDependabotSyncMutation, CreateNewGhDependabotSyncMutationVariables>;
export const CreateNewGitlabCiSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewGitlabCiSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"resourcePath"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"resourceId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"isGroup"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"isMasked"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"isProtected"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createGitlabCiSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}},{"kind":"Argument","name":{"kind":"Name","value":"resourcePath"},"value":{"kind":"Variable","name":{"kind":"Name","value":"resourcePath"}}},{"kind":"Argument","name":{"kind":"Name","value":"resourceId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"resourceId"}}},{"kind":"Argument","name":{"kind":"Name","value":"isGroup"},"value":{"kind":"Variable","name":{"kind":"Name","value":"isGroup"}}},{"kind":"Argument","name":{"kind":"Name","value":"masked"},"value":{"kind":"Variable","name":{"kind":"Name","value":"isMasked"}}},{"kind":"Argument","name":{"kind":"Name","value":"protected"},"value":{"kind":"Variable","name":{"kind":"Name","value":"isProtected"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewGitlabCiSyncMutation, CreateNewGitlabCiSyncMutationVariables>;
export const InitAppSyncingDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"InitAppSyncing"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envKeys"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnvironmentKeyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"initEnvSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"envKeys"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envKeys"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sseEnabled"}}]}}]}}]}}]} as unknown as DocumentNode<InitAppSyncingMutation, InitAppSyncingMutationVariables>;
export const CreateNewNomadSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewNomadSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"nomadPath"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"nomadNamespace"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createNomadSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"nomadPath"},"value":{"kind":"Variable","name":{"kind":"Name","value":"nomadPath"}}},{"kind":"Argument","name":{"kind":"Name","value":"nomadNamespace"},"value":{"kind":"Variable","name":{"kind":"Name","value":"nomadNamespace"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewNomadSyncMutation, CreateNewNomadSyncMutationVariables>;
export const CreateNewRailwaySyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewRailwaySync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"railwayProject"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RailwayResourceInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"railwayEnvironment"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RailwayResourceInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"railwayService"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"RailwayResourceInput"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createRailwaySync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}},{"kind":"Argument","name":{"kind":"Name","value":"railwayProject"},"value":{"kind":"Variable","name":{"kind":"Name","value":"railwayProject"}}},{"kind":"Argument","name":{"kind":"Name","value":"railwayEnvironment"},"value":{"kind":"Variable","name":{"kind":"Name","value":"railwayEnvironment"}}},{"kind":"Argument","name":{"kind":"Name","value":"railwayService"},"value":{"kind":"Variable","name":{"kind":"Name","value":"railwayService"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewRailwaySyncMutation, CreateNewRailwaySyncMutationVariables>;
export const CreateNewRenderServiceSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewRenderServiceSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"resourceId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"resourceName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"resourceType"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RenderResourceType"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretFileName"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createRenderSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}},{"kind":"Argument","name":{"kind":"Name","value":"resourceId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"resourceId"}}},{"kind":"Argument","name":{"kind":"Name","value":"resourceName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"resourceName"}}},{"kind":"Argument","name":{"kind":"Name","value":"resourceType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"resourceType"}}},{"kind":"Argument","name":{"kind":"Name","value":"secretFileName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretFileName"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewRenderServiceSyncMutation, CreateNewRenderServiceSyncMutationVariables>;
export const SaveNewProviderCredsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SaveNewProviderCreds"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"provider"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"JSONString"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createProviderCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"provider"},"value":{"kind":"Variable","name":{"kind":"Name","value":"provider"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentials"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"credential"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<SaveNewProviderCredsMutation, SaveNewProviderCredsMutationVariables>;
export const ToggleSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ToggleSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"toggleSyncActive"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"syncId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<ToggleSyncMutation, ToggleSyncMutationVariables>;
export const TriggerEnvSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"TriggerEnvSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"triggerSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"syncId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]} as unknown as DocumentNode<TriggerEnvSyncMutation, TriggerEnvSyncMutationVariables>;
export const UpdateProviderCredsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProviderCreds"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"JSONString"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProviderCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentials"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"credential"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateProviderCredsMutation, UpdateProviderCredsMutationVariables>;
export const UpdateSyncAuthDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSyncAuth"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateSyncAuthentication"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"syncId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"syncId"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]} as unknown as DocumentNode<UpdateSyncAuthMutation, UpdateSyncAuthMutationVariables>;
export const CreateNewVaultSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewVaultSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"engine"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"vaultPath"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createVaultSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"engine"},"value":{"kind":"Variable","name":{"kind":"Name","value":"engine"}}},{"kind":"Argument","name":{"kind":"Name","value":"vaultPath"},"value":{"kind":"Variable","name":{"kind":"Name","value":"vaultPath"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewVaultSyncMutation, CreateNewVaultSyncMutationVariables>;
export const CreateNewVercelSyncDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewVercelSync"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"environment"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretType"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createVercelSync"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}},{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"projectName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectName"}}},{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}},{"kind":"Argument","name":{"kind":"Name","value":"teamName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamName"}}},{"kind":"Argument","name":{"kind":"Name","value":"environment"},"value":{"kind":"Variable","name":{"kind":"Name","value":"environment"}}},{"kind":"Argument","name":{"kind":"Name","value":"secretType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretType"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sync"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CreateNewVercelSyncMutation, CreateNewVercelSyncMutationVariables>;
export const CreateNewUserTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateNewUserToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"token"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"expiry"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"identityKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identityKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"token"},"value":{"kind":"Variable","name":{"kind":"Name","value":"token"}}},{"kind":"Argument","name":{"kind":"Name","value":"wrappedKeyShare"},"value":{"kind":"Variable","name":{"kind":"Name","value":"wrappedKeyShare"}}},{"kind":"Argument","name":{"kind":"Name","value":"expiry"},"value":{"kind":"Variable","name":{"kind":"Name","value":"expiry"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<CreateNewUserTokenMutation, CreateNewUserTokenMutationVariables>;
export const RevokeUserTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeUserToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tokenId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tokenId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tokenId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<RevokeUserTokenMutation, RevokeUserTokenMutationVariables>;
export const GetIpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetIP"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clientIp"}}]}}]} as unknown as DocumentNode<GetIpQuery, GetIpQueryVariables>;
export const GetNetworkPoliciesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetNetworkPolicies"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"networkAccessPolicies"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"allowedIps"}},{"kind":"Field","name":{"kind":"Name","value":"isGlobal"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"clientIp"}}]}}]} as unknown as DocumentNode<GetNetworkPoliciesQuery, GetNetworkPoliciesQueryVariables>;
export const GetAppAccountsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppAccounts"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"appUsers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"appServiceAccounts"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"tokens"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<GetAppAccountsQuery, GetAppAccountsQueryVariables>;
export const GetAppMembersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppMembers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"appUsers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}}]}}]}}]} as unknown as DocumentNode<GetAppMembersQuery, GetAppMembersQueryVariables>;
export const GetAppServiceAccountsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppServiceAccounts"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"appServiceAccounts"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"tokens"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<GetAppServiceAccountsQuery, GetAppServiceAccountsQueryVariables>;
export const GetCheckoutDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetCheckoutDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"stripeSessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"stripeCheckoutDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"stripeSessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"stripeSessionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"paymentStatus"}},{"kind":"Field","name":{"kind":"Name","value":"customerEmail"}},{"kind":"Field","name":{"kind":"Name","value":"billingStartDate"}},{"kind":"Field","name":{"kind":"Name","value":"billingEndDate"}},{"kind":"Field","name":{"kind":"Name","value":"subscriptionId"}},{"kind":"Field","name":{"kind":"Name","value":"planName"}}]}}]}}]} as unknown as DocumentNode<GetCheckoutDetailsQuery, GetCheckoutDetailsQueryVariables>;
export const GetCustomerPortalLinkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetCustomerPortalLink"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"stripeCustomerPortalUrl"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}]}]}}]} as unknown as DocumentNode<GetCustomerPortalLinkQuery, GetCustomerPortalLinkQueryVariables>;
export const GetSubscriptionDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetSubscriptionDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"stripeSubscriptionDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"subscriptionId"}},{"kind":"Field","name":{"kind":"Name","value":"planName"}},{"kind":"Field","name":{"kind":"Name","value":"planType"}},{"kind":"Field","name":{"kind":"Name","value":"billingPeriod"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"nextPaymentAmount"}},{"kind":"Field","name":{"kind":"Name","value":"currentPeriodStart"}},{"kind":"Field","name":{"kind":"Name","value":"currentPeriodEnd"}},{"kind":"Field","name":{"kind":"Name","value":"renewalDate"}},{"kind":"Field","name":{"kind":"Name","value":"cancelAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelAtPeriodEnd"}},{"kind":"Field","name":{"kind":"Name","value":"paymentMethods"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"brand"}},{"kind":"Field","name":{"kind":"Name","value":"last4"}},{"kind":"Field","name":{"kind":"Name","value":"expMonth"}},{"kind":"Field","name":{"kind":"Name","value":"expYear"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}}]}}]}}]}}]} as unknown as DocumentNode<GetSubscriptionDetailsQuery, GetSubscriptionDetailsQueryVariables>;
export const GetStripeSubscriptionEstimateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetStripeSubscriptionEstimate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"planType"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PlanTypeEnum"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"billingPeriod"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BillingPeriodEnum"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"previewV2"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"estimateStripeSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"planType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"planType"}}},{"kind":"Argument","name":{"kind":"Name","value":"billingPeriod"},"value":{"kind":"Variable","name":{"kind":"Name","value":"billingPeriod"}}},{"kind":"Argument","name":{"kind":"Name","value":"previewV2"},"value":{"kind":"Variable","name":{"kind":"Name","value":"previewV2"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"estimatedTotal"}},{"kind":"Field","name":{"kind":"Name","value":"seatCount"}},{"kind":"Field","name":{"kind":"Name","value":"unitPrice"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"priceId"}}]}}]}}]} as unknown as DocumentNode<GetStripeSubscriptionEstimateQuery, GetStripeSubscriptionEstimateQueryVariables>;
export const GetAppActivityChartDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppActivityChart"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"period"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"TimeRange"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"appActivityChart"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"period"},"value":{"kind":"Variable","name":{"kind":"Name","value":"period"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"index"}},{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"data"}}]}}]}}]} as unknown as DocumentNode<GetAppActivityChartQuery, GetAppActivityChartQueryVariables>;
export const GetAppDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"appToken"}},{"kind":"Field","name":{"kind":"Name","value":"appSeed"}},{"kind":"Field","name":{"kind":"Name","value":"appVersion"}},{"kind":"Field","name":{"kind":"Name","value":"sseEnabled"}}]}}]}}]} as unknown as DocumentNode<GetAppDetailQuery, GetAppDetailQueryVariables>;
export const GetAppKmsLogsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppKmsLogs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"start"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"end"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kmsLogs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"start"},"value":{"kind":"Variable","name":{"kind":"Name","value":"start"}}},{"kind":"Argument","name":{"kind":"Name","value":"end"},"value":{"kind":"Variable","name":{"kind":"Name","value":"end"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"logs"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"phaseNode"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"ipAddress"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"city"}},{"kind":"Field","name":{"kind":"Name","value":"phSize"}}]}},{"kind":"Field","name":{"kind":"Name","value":"count"}}]}}]}}]} as unknown as DocumentNode<GetAppKmsLogsQuery, GetAppKmsLogsQueryVariables>;
export const GetAppsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetApps"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"sseEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"members"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceAccounts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"environments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}},{"kind":"Field","name":{"kind":"Name","value":"syncs"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"provider"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}}]} as unknown as DocumentNode<GetAppsQuery, GetAppsQueryVariables>;
export const GetDashboardDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetDashboard"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"sseEnabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userTokens"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"organisationInvites"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"organisationMembers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"role"},"value":{"kind":"NullValue"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"savedCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"syncs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<GetDashboardQuery, GetDashboardQueryVariables>;
export const GetOrganisationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOrganisations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"planDetail"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"maxUsers"}},{"kind":"Field","name":{"kind":"Name","value":"maxApps"}},{"kind":"Field","name":{"kind":"Name","value":"maxEnvsPerApp"}},{"kind":"Field","name":{"kind":"Name","value":"seatsUsed"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"users"}},{"kind":"Field","name":{"kind":"Name","value":"serviceAccounts"}},{"kind":"Field","name":{"kind":"Name","value":"total"}}]}},{"kind":"Field","name":{"kind":"Name","value":"appCount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}}]}},{"kind":"Field","name":{"kind":"Name","value":"memberId"}},{"kind":"Field","name":{"kind":"Name","value":"keyring"}},{"kind":"Field","name":{"kind":"Name","value":"recovery"}},{"kind":"Field","name":{"kind":"Name","value":"pricingVersion"}}]}}]}}]} as unknown as DocumentNode<GetOrganisationsQuery, GetOrganisationsQueryVariables>;
export const GetAwsStsEndpointsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAwsStsEndpoints"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"awsStsEndpoints"}}]}}]} as unknown as DocumentNode<GetAwsStsEndpointsQuery, GetAwsStsEndpointsQueryVariables>;
export const GetIdentityProvidersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetIdentityProviders"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identityProviders"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"iconId"}},{"kind":"Field","name":{"kind":"Name","value":"supported"}}]}}]}}]} as unknown as DocumentNode<GetIdentityProvidersQuery, GetIdentityProvidersQueryVariables>;
export const GetOrganisationIdentitiesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOrganisationIdentities"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identities"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"config"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AwsIamConfigType"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"trustedPrincipals"}},{"kind":"Field","name":{"kind":"Name","value":"signatureTtlSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"stsEndpoint"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"tokenNamePattern"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTtlSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"maxTtlSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<GetOrganisationIdentitiesQuery, GetOrganisationIdentitiesQueryVariables>;
export const CheckOrganisationNameAvailabilityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CheckOrganisationNameAvailability"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisationNameAvailable"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}}]}]}}]} as unknown as DocumentNode<CheckOrganisationNameAvailabilityQuery, CheckOrganisationNameAvailabilityQueryVariables>;
export const GetGlobalAccessUsersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetGlobalAccessUsers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisationGlobalAccessUsers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}}]}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}}]}}]} as unknown as DocumentNode<GetGlobalAccessUsersQuery, GetGlobalAccessUsersQueryVariables>;
export const GetInvitesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetInvites"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisationInvites"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"invitedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}},{"kind":"Field","name":{"kind":"Name","value":"inviteeEmail"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}}]}}]}}]} as unknown as DocumentNode<GetInvitesQuery, GetInvitesQueryVariables>;
export const GetLicenseDataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetLicenseData"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"license"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"customerName"}},{"kind":"Field","name":{"kind":"Name","value":"organisationName"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"seats"}},{"kind":"Field","name":{"kind":"Name","value":"isActivated"}},{"kind":"Field","name":{"kind":"Name","value":"organisationOwner"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}}]}}]}}]}}]} as unknown as DocumentNode<GetLicenseDataQuery, GetLicenseDataQueryVariables>;
export const GetOrgLicenseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOrgLicense"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisationLicense"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"customerName"}},{"kind":"Field","name":{"kind":"Name","value":"issuedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"activatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"seats"}},{"kind":"Field","name":{"kind":"Name","value":"tokens"}}]}}]}}]} as unknown as DocumentNode<GetOrgLicenseQuery, GetOrgLicenseQueryVariables>;
export const GetOrganisationMembersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOrganisationMembers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"role"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisationMembers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"role"},"value":{"kind":"Variable","name":{"kind":"Name","value":"role"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastLogin"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}}]}}]} as unknown as DocumentNode<GetOrganisationMembersQuery, GetOrganisationMembersQueryVariables>;
export const GetOrganisationPlanDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOrganisationPlan"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisationPlan"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"maxUsers"}},{"kind":"Field","name":{"kind":"Name","value":"maxApps"}},{"kind":"Field","name":{"kind":"Name","value":"maxEnvsPerApp"}},{"kind":"Field","name":{"kind":"Name","value":"seatsUsed"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"users"}},{"kind":"Field","name":{"kind":"Name","value":"serviceAccounts"}},{"kind":"Field","name":{"kind":"Name","value":"total"}}]}},{"kind":"Field","name":{"kind":"Name","value":"seatLimit"}},{"kind":"Field","name":{"kind":"Name","value":"appCount"}}]}}]}}]} as unknown as DocumentNode<GetOrganisationPlanQuery, GetOrganisationPlanQueryVariables>;
export const GetRolesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetRoles"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"roles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}}]}}]}}]} as unknown as DocumentNode<GetRolesQuery, GetRolesQueryVariables>;
export const VerifyInviteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"VerifyInvite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"inviteId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"validateInvite"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"inviteId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"inviteId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"organisation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"inviteeEmail"}},{"kind":"Field","name":{"kind":"Name","value":"invitedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}}]}},{"kind":"Field","name":{"kind":"Name","value":"apps"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<VerifyInviteQuery, VerifyInviteQueryVariables>;
export const GetDynamicSecretsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetDynamicSecrets"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"dynamicSecrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"index"}},{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"config"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AWSConfigType"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"usernameTemplate"}},{"kind":"Field","name":{"kind":"Name","value":"iamPath"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"keyMap"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"keyName"}},{"kind":"Field","name":{"kind":"Name","value":"masked"}}]}},{"kind":"Field","name":{"kind":"Name","value":"defaultTtlSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"maxTtlSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"authentication"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<GetDynamicSecretsQuery, GetDynamicSecretsQueryVariables>;
export const GetDynamicSecretProvidersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetDynamicSecretProviders"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"dynamicSecretProviders"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"credentials"}},{"kind":"Field","name":{"kind":"Name","value":"configMap"}}]}}]}}]} as unknown as DocumentNode<GetDynamicSecretProvidersQuery, GetDynamicSecretProvidersQueryVariables>;
export const GetDynamicSecretLeasesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetDynamicSecretLeases"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"secretId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"dynamicSecrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"secretId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"secretId"}}},{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"leases"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ttl"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"revokedAt"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"organisationMember"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceAccount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"events"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"ipAddress"}},{"kind":"Field","name":{"kind":"Name","value":"userAgent"}},{"kind":"Field","name":{"kind":"Name","value":"organisationMember"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceAccount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<GetDynamicSecretLeasesQuery, GetDynamicSecretLeasesQueryVariables>;
export const GetAppEnvironmentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppEnvironments"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberType"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MemberType"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"appEnvironments"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"NullValue"}},{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}},{"kind":"Argument","name":{"kind":"Name","value":"memberType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberType"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"secretCount"}},{"kind":"Field","name":{"kind":"Name","value":"folderCount"}},{"kind":"Field","name":{"kind":"Name","value":"index"}},{"kind":"Field","name":{"kind":"Name","value":"members"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"sseEnabled"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}]},{"kind":"Field","name":{"kind":"Name","value":"serverPublicKey"}}]}}]} as unknown as DocumentNode<GetAppEnvironmentsQuery, GetAppEnvironmentsQueryVariables>;
export const GetAppSecretsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppSecrets"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberType"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MemberType"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"appEnvironments"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"NullValue"}},{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}},{"kind":"Argument","name":{"kind":"Name","value":"memberType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberType"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"secretCount"}},{"kind":"Field","name":{"kind":"Name","value":"folderCount"}},{"kind":"Field","name":{"kind":"Name","value":"index"}},{"kind":"Field","name":{"kind":"Name","value":"members"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"folders"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"path"}}]}},{"kind":"Field","name":{"kind":"Name","value":"secrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"tags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"dynamicSecrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"keyMap"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"keyName"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"sseEnabled"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}]},{"kind":"Field","name":{"kind":"Name","value":"serverPublicKey"}}]}}]} as unknown as DocumentNode<GetAppSecretsQuery, GetAppSecretsQueryVariables>;
export const GetAppSecretsLogsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppSecretsLogs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"start"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"end"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BigInt"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"eventTypes"}},"type":{"kind":"ListType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memberType"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MemberType"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"environmentId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secretLogs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"start"},"value":{"kind":"Variable","name":{"kind":"Name","value":"start"}}},{"kind":"Argument","name":{"kind":"Name","value":"end"},"value":{"kind":"Variable","name":{"kind":"Name","value":"end"}}},{"kind":"Argument","name":{"kind":"Name","value":"eventTypes"},"value":{"kind":"Variable","name":{"kind":"Name","value":"eventTypes"}}},{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberId"}}},{"kind":"Argument","name":{"kind":"Name","value":"memberType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memberType"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"environmentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"logs"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"tags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"ipAddress"}},{"kind":"Field","name":{"kind":"Name","value":"userAgent"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"username"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceToken"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceAccount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceAccountToken"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"secret"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"path"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"count"}}]}},{"kind":"Field","name":{"kind":"Name","value":"environmentKeys"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<GetAppSecretsLogsQuery, GetAppSecretsLogsQueryVariables>;
export const GetEnvironmentKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetEnvironmentKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environmentKeys"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}}]}}]}}]} as unknown as DocumentNode<GetEnvironmentKeyQuery, GetEnvironmentKeyQueryVariables>;
export const GetEnvironmentTokensDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetEnvironmentTokens"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"environmentTokens"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedKeyShare"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<GetEnvironmentTokensQuery, GetEnvironmentTokensQueryVariables>;
export const GetFoldersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetFolders"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"folders"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"folderCount"}},{"kind":"Field","name":{"kind":"Name","value":"secretCount"}}]}}]}}]} as unknown as DocumentNode<GetFoldersQuery, GetFoldersQueryVariables>;
export const GetOrgSecretKeysDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOrgSecretKeys"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"environments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}},{"kind":"Field","name":{"kind":"Name","value":"secrets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"path"}}]}}]}}]}}]}}]} as unknown as DocumentNode<GetOrgSecretKeysQuery, GetOrgSecretKeysQueryVariables>;
export const GetSecretHistoryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetSecretHistory"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"tags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"ipAddress"}},{"kind":"Field","name":{"kind":"Name","value":"userAgent"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"username"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceToken"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceAccount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"environmentKeys"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}}]}}]}}]} as unknown as DocumentNode<GetSecretHistoryQuery, GetSecretHistoryQueryVariables>;
export const GetEnvSecretsKvDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetEnvSecretsKV"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"folders"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"StringValue","value":"/","block":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"secrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"StringValue","value":"/","block":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"path"}}]}},{"kind":"Field","name":{"kind":"Name","value":"environmentKeys"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}}]}}]}}]} as unknown as DocumentNode<GetEnvSecretsKvQuery, GetEnvSecretsKvQueryVariables>;
export const GetSecretTagsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetSecretTags"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secretTags"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}}]}}]} as unknown as DocumentNode<GetSecretTagsQuery, GetSecretTagsQueryVariables>;
export const GetSecretsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetSecrets"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"envId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"path"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"tags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"override"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}}]}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"folders"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"folderCount"}},{"kind":"Field","name":{"kind":"Name","value":"secretCount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"appEnvironments"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"sseEnabled"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"environmentKeys"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}},{"kind":"Argument","name":{"kind":"Name","value":"environmentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSeed"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedSalt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"envSyncs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"options"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"dynamicSecrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"envId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"envId"}}},{"kind":"Argument","name":{"kind":"Name","value":"path"},"value":{"kind":"Variable","name":{"kind":"Name","value":"path"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"keyMap"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"keyName"}},{"kind":"Field","name":{"kind":"Name","value":"masked"}}]}},{"kind":"Field","name":{"kind":"Name","value":"config"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AWSConfigType"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"usernameTemplate"}},{"kind":"Field","name":{"kind":"Name","value":"groups"}},{"kind":"Field","name":{"kind":"Name","value":"iamPath"}},{"kind":"Field","name":{"kind":"Name","value":"permissionBoundaryArn"}},{"kind":"Field","name":{"kind":"Name","value":"policyArns"}},{"kind":"Field","name":{"kind":"Name","value":"policyDocument"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"defaultTtlSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"maxTtlSeconds"}},{"kind":"Field","name":{"kind":"Name","value":"authentication"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<GetSecretsQuery, GetSecretsQueryVariables>;
export const GetServiceTokensDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetServiceTokens"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceTokens"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"keys"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}}]}}]}}]} as unknown as DocumentNode<GetServiceTokensQuery, GetServiceTokensQueryVariables>;
export const GetServiceAccountDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetServiceAccountDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceAccounts"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"serviceAccountId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"serverSideKeyManagementEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"handlers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedKeyring"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedRecovery"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"self"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"appMemberships"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"environments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sseEnabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"networkPolicies"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"allowedIps"}},{"kind":"Field","name":{"kind":"Name","value":"isGlobal"}}]}},{"kind":"Field","name":{"kind":"Name","value":"identities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}}]}}]}}]}}]} as unknown as DocumentNode<GetServiceAccountDetailQuery, GetServiceAccountDetailQueryVariables>;
export const GetServiceAccountHandlersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetServiceAccountHandlers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceAccountHandlers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}}]}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}}]}}]} as unknown as DocumentNode<GetServiceAccountHandlersQuery, GetServiceAccountHandlersQueryVariables>;
export const GetServiceAccountTokensDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetServiceAccountTokens"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceAccounts"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"serviceAccountId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tokens"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"self"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdByServiceAccount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}}]}},{"kind":"Field","name":{"kind":"Name","value":"lastUsed"}}]}}]}}]}}]} as unknown as DocumentNode<GetServiceAccountTokensQuery, GetServiceAccountTokensQueryVariables>;
export const GetServiceAccountsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetServiceAccounts"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serviceAccounts"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"serviceAccountId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"handlers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedKeyring"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedRecovery"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"self"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<GetServiceAccountsQuery, GetServiceAccountsQueryVariables>;
export const GetOrganisationSyncsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOrganisationSyncs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"syncs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}},{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"provider"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"options"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"authentication"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"credentials"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"meta"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"savedCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"credentials"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"provider"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"expectedCredentials"}},{"kind":"Field","name":{"kind":"Name","value":"optionalCredentials"}}]}},{"kind":"Field","name":{"kind":"Name","value":"syncCount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"apps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}},{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"NullValue"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"sseEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"members"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"email"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serviceAccounts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"environments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"syncs"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"provider"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}}]} as unknown as DocumentNode<GetOrganisationSyncsQuery, GetOrganisationSyncsQueryVariables>;
export const GetAwsSecretsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAwsSecrets"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"awsSecrets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"arn"}}]}}]}}]} as unknown as DocumentNode<GetAwsSecretsQuery, GetAwsSecretsQueryVariables>;
export const ValidateAwsAssumeRoleAuthDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ValidateAWSAssumeRoleAuth"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"validateAwsAssumeRoleAuth"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"valid"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"method"}},{"kind":"Field","name":{"kind":"Name","value":"error"}}]}}]}}]} as unknown as DocumentNode<ValidateAwsAssumeRoleAuthQuery, ValidateAwsAssumeRoleAuthQueryVariables>;
export const ValidateAwsAssumeRoleCredentialsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ValidateAWSAssumeRoleCredentials"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"roleArn"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"region"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"externalId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"validateAwsAssumeRoleCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"roleArn"},"value":{"kind":"Variable","name":{"kind":"Name","value":"roleArn"}}},{"kind":"Argument","name":{"kind":"Name","value":"region"},"value":{"kind":"Variable","name":{"kind":"Name","value":"region"}}},{"kind":"Argument","name":{"kind":"Name","value":"externalId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"externalId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"valid"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"assumedRoleArn"}}]}}]}}]} as unknown as DocumentNode<ValidateAwsAssumeRoleCredentialsQuery, ValidateAwsAssumeRoleCredentialsQueryVariables>;
export const GetCfPagesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetCfPages"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cloudflarePagesProjects"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"deploymentId"}},{"kind":"Field","name":{"kind":"Name","value":"environments"}}]}}]}}]} as unknown as DocumentNode<GetCfPagesQuery, GetCfPagesQueryVariables>;
export const GetCfWorkersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetCfWorkers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cloudflareWorkers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"scriptId"}}]}}]}}]} as unknown as DocumentNode<GetCfWorkersQuery, GetCfWorkersQueryVariables>;
export const GetAppSyncStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAppSyncStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"appId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sseEnabled"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}]},{"kind":"Field","name":{"kind":"Name","value":"syncs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"appId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"appId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"environment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"envType"}},{"kind":"Field","name":{"kind":"Name","value":"app"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"serviceInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"provider"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"options"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"lastSync"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"authentication"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"credentials"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"meta"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"serverPublicKey"}}]}}]} as unknown as DocumentNode<GetAppSyncStatusQuery, GetAppSyncStatusQueryVariables>;
export const GetProviderListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetProviderList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"providers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"expectedCredentials"}},{"kind":"Field","name":{"kind":"Name","value":"optionalCredentials"}},{"kind":"Field","name":{"kind":"Name","value":"authScheme"}}]}},{"kind":"Field","name":{"kind":"Name","value":"serverPublicKey"}}]}}]} as unknown as DocumentNode<GetProviderListQuery, GetProviderListQueryVariables>;
export const GetSavedCredentialsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetSavedCredentials"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"savedCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orgId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"orgId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"credentials"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"provider"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"expectedCredentials"}},{"kind":"Field","name":{"kind":"Name","value":"optionalCredentials"}}]}},{"kind":"Field","name":{"kind":"Name","value":"syncCount"}}]}}]}}]} as unknown as DocumentNode<GetSavedCredentialsQuery, GetSavedCredentialsQueryVariables>;
export const GetServerKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetServerKey"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"serverPublicKey"}}]}}]} as unknown as DocumentNode<GetServerKeyQuery, GetServerKeyQueryVariables>;
export const GetServiceListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetServiceList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"services"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"provider"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<GetServiceListQuery, GetServiceListQueryVariables>;
export const GetGithubEnvironmentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetGithubEnvironments"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"owner"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"repoName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"githubEnvironments"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}},{"kind":"Argument","name":{"kind":"Name","value":"owner"},"value":{"kind":"Variable","name":{"kind":"Name","value":"owner"}}},{"kind":"Argument","name":{"kind":"Name","value":"repoName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"repoName"}}}]}]}}]} as unknown as DocumentNode<GetGithubEnvironmentsQuery, GetGithubEnvironmentsQueryVariables>;
export const GetGithubOrgsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetGithubOrgs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"githubOrgs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"}}]}}]}}]} as unknown as DocumentNode<GetGithubOrgsQuery, GetGithubOrgsQueryVariables>;
export const GetGithubReposDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetGithubRepos"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"githubRepos"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"owner"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}}]}}]} as unknown as DocumentNode<GetGithubReposQuery, GetGithubReposQueryVariables>;
export const GetGitLabResourcesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetGitLabResources"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"gitlabProjects"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"namespace"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"fullPath"}}]}},{"kind":"Field","name":{"kind":"Name","value":"pathWithNamespace"}},{"kind":"Field","name":{"kind":"Name","value":"webUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"gitlabGroups"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"fullPath"}},{"kind":"Field","name":{"kind":"Name","value":"webUrl"}}]}}]}}]} as unknown as DocumentNode<GetGitLabResourcesQuery, GetGitLabResourcesQueryVariables>;
export const TestNomadAuthDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TestNomadAuth"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"testNomadCreds"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}]}]}}]} as unknown as DocumentNode<TestNomadAuthQuery, TestNomadAuthQueryVariables>;
export const GetRailwayProjectsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetRailwayProjects"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"railwayProjects"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"environments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"services"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<GetRailwayProjectsQuery, GetRailwayProjectsQueryVariables>;
export const GetRenderResourcesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetRenderResources"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"renderServices"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}},{"kind":"Field","name":{"kind":"Name","value":"renderEnvgroups"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]} as unknown as DocumentNode<GetRenderResourcesQuery, GetRenderResourcesQueryVariables>;
export const TestVaultAuthDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TestVaultAuth"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"testVaultCreds"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}]}]}}]} as unknown as DocumentNode<TestVaultAuthQuery, TestVaultAuthQueryVariables>;
export const GetVercelProjectsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetVercelProjects"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"vercelProjects"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentialId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentialId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"teamName"}},{"kind":"Field","name":{"kind":"Name","value":"projects"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"environments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}}]}}]}}]}}]} as unknown as DocumentNode<GetVercelProjectsQuery, GetVercelProjectsQueryVariables>;
export const GetOrganisationMemberDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOrganisationMemberDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisationMembers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"memberId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"identityKey"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastLogin"}},{"kind":"Field","name":{"kind":"Name","value":"self"}},{"kind":"Field","name":{"kind":"Name","value":"appMemberships"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"sseEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"environments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"tokens"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"networkPolicies"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"allowedIps"}},{"kind":"Field","name":{"kind":"Name","value":"isGlobal"}}]}}]}}]}}]} as unknown as DocumentNode<GetOrganisationMemberDetailQuery, GetOrganisationMemberDetailQueryVariables>;
export const GetUserTokensDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetUserTokens"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userTokens"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"organisationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"organisationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"wrappedKeyShare"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}}]}}]}}]} as unknown as DocumentNode<GetUserTokensQuery, GetUserTokensQueryVariables>;