/* eslint-disable */
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  /**
   * The `BigInt` scalar type represents non-fractional whole numeric values.
   * `BigInt` is not constrained to 32-bit like the `Int` type and thus is a less
   * compatible type.
   */
  BigInt: any;
  /**
   * The `DateTime` scalar type represents a DateTime
   * value as specified by
   * [iso8601](https://en.wikipedia.org/wiki/ISO_8601).
   */
  DateTime: any;
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
  appSeed: Scalars['String'];
  appToken: Scalars['String'];
  appVersion: Scalars['Int'];
  createdAt?: Maybe<Scalars['DateTime']>;
  id: Scalars['String'];
  identityKey: Scalars['String'];
  name: Scalars['String'];
  wrappedKeyShare: Scalars['String'];
};

export type ChartDataPointType = {
  __typename?: 'ChartDataPointType';
  data?: Maybe<Scalars['Int']>;
  date?: Maybe<Scalars['BigInt']>;
  index?: Maybe<Scalars['Int']>;
};

export type CreateAppMutation = {
  __typename?: 'CreateAppMutation';
  app?: Maybe<AppType>;
};

export type CreateEnvironmentKeyMutation = {
  __typename?: 'CreateEnvironmentKeyMutation';
  environmentKey?: Maybe<EnvironmentKeyType>;
};

export type CreateEnvironmentMutation = {
  __typename?: 'CreateEnvironmentMutation';
  environment?: Maybe<EnvironmentType>;
};

export type CreateEnvironmentSecretMutation = {
  __typename?: 'CreateEnvironmentSecretMutation';
  environmentSecret?: Maybe<EnvironmentSecretType>;
};

export type CreateOrganisationMutation = {
  __typename?: 'CreateOrganisationMutation';
  organisation?: Maybe<OrganisationType>;
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

export type DeleteAppMutation = {
  __typename?: 'DeleteAppMutation';
  app?: Maybe<AppType>;
};

export type DeleteSecretMutation = {
  __typename?: 'DeleteSecretMutation';
  secret?: Maybe<SecretType>;
};

export type EditSecretMutation = {
  __typename?: 'EditSecretMutation';
  secret?: Maybe<SecretType>;
};

export type EnvironmentKeyType = {
  __typename?: 'EnvironmentKeyType';
  createdAt?: Maybe<Scalars['DateTime']>;
  id: Scalars['String'];
  identityKey: Scalars['String'];
  updatedAt: Scalars['DateTime'];
  wrappedSalt: Scalars['String'];
  wrappedSeed: Scalars['String'];
};

export type EnvironmentSecretType = {
  __typename?: 'EnvironmentSecretType';
  createdAt?: Maybe<Scalars['DateTime']>;
  id: Scalars['String'];
  identityKey: Scalars['String'];
  name: Scalars['String'];
  token: Scalars['String'];
  updatedAt: Scalars['DateTime'];
  wrappedKeyShare: Scalars['String'];
};

export type EnvironmentType = {
  __typename?: 'EnvironmentType';
  createdAt?: Maybe<Scalars['DateTime']>;
  envType: ApiEnvironmentEnvTypeChoices;
  id: Scalars['String'];
  identityKey: Scalars['String'];
  name: Scalars['String'];
  updatedAt: Scalars['DateTime'];
  wrappedSalt: Scalars['String'];
  wrappedSeed: Scalars['String'];
};

export type KmsLogType = Node & {
  __typename?: 'KMSLogType';
  appId?: Maybe<Scalars['String']>;
  asn?: Maybe<Scalars['Int']>;
  city?: Maybe<Scalars['String']>;
  country?: Maybe<Scalars['String']>;
  edgeLocation?: Maybe<Scalars['String']>;
  eventType?: Maybe<Scalars['String']>;
  id: Scalars['ID'];
  ipAddress?: Maybe<Scalars['String']>;
  isp?: Maybe<Scalars['String']>;
  latitude?: Maybe<Scalars['Float']>;
  longitude?: Maybe<Scalars['Float']>;
  phSize?: Maybe<Scalars['Int']>;
  phaseNode?: Maybe<Scalars['String']>;
  timestamp?: Maybe<Scalars['BigInt']>;
};

export type Mutation = {
  __typename?: 'Mutation';
  createApp?: Maybe<CreateAppMutation>;
  createEnvironment?: Maybe<CreateEnvironmentMutation>;
  createEnvironmentKey?: Maybe<CreateEnvironmentKeyMutation>;
  createEnvironmentSecret?: Maybe<CreateEnvironmentSecretMutation>;
  createOrganisation?: Maybe<CreateOrganisationMutation>;
  createSecret?: Maybe<CreateSecretMutation>;
  createSecretFolder?: Maybe<CreateSecretFolderMutation>;
  createSecretTag?: Maybe<CreateSecretTagMutation>;
  deleteApp?: Maybe<DeleteAppMutation>;
  deleteSecret?: Maybe<DeleteSecretMutation>;
  editSecret?: Maybe<EditSecretMutation>;
  rotateAppKeys?: Maybe<RotateAppKeysMutation>;
};


export type MutationCreateAppArgs = {
  appSeed: Scalars['String'];
  appToken: Scalars['String'];
  appVersion: Scalars['Int'];
  id: Scalars['ID'];
  identityKey: Scalars['String'];
  name: Scalars['String'];
  organisationId: Scalars['ID'];
  wrappedKeyShare: Scalars['String'];
};


export type MutationCreateEnvironmentArgs = {
  appId: Scalars['ID'];
  envType: Scalars['String'];
  id: Scalars['ID'];
  identityKey: Scalars['String'];
  name: Scalars['String'];
  wrappedSalt: Scalars['String'];
  wrappedSeed: Scalars['String'];
};


export type MutationCreateEnvironmentKeyArgs = {
  envId: Scalars['ID'];
  identityKey: Scalars['String'];
  userId: Scalars['ID'];
  wrappedSalt: Scalars['String'];
  wrappedSeed: Scalars['String'];
};


export type MutationCreateEnvironmentSecretArgs = {
  envId: Scalars['ID'];
  identityKey: Scalars['String'];
  name: Scalars['String'];
  token: Scalars['String'];
  wrappedKeyShare: Scalars['String'];
};


export type MutationCreateOrganisationArgs = {
  id: Scalars['ID'];
  identityKey: Scalars['String'];
  name: Scalars['String'];
};


export type MutationCreateSecretArgs = {
  comment?: InputMaybe<Scalars['String']>;
  envId: Scalars['ID'];
  folderId?: InputMaybe<Scalars['ID']>;
  key: Scalars['String'];
  keyDigest: Scalars['String'];
  tags?: InputMaybe<Array<InputMaybe<Scalars['String']>>>;
  value: Scalars['String'];
};


export type MutationCreateSecretFolderArgs = {
  envId: Scalars['ID'];
  id: Scalars['ID'];
  name: Scalars['String'];
  parentFolderId?: InputMaybe<Scalars['ID']>;
};


export type MutationCreateSecretTagArgs = {
  id: Scalars['ID'];
  name: Scalars['String'];
  orgId: Scalars['ID'];
};


export type MutationDeleteAppArgs = {
  id: Scalars['ID'];
};


export type MutationDeleteSecretArgs = {
  id: Scalars['ID'];
};


export type MutationEditSecretArgs = {
  comment?: InputMaybe<Scalars['String']>;
  folderId?: InputMaybe<Scalars['ID']>;
  id: Scalars['ID'];
  key: Scalars['String'];
  keyDigest: Scalars['String'];
  tags?: InputMaybe<Array<InputMaybe<Scalars['String']>>>;
  value: Scalars['String'];
};


export type MutationRotateAppKeysArgs = {
  appToken: Scalars['String'];
  id: Scalars['ID'];
  wrappedKeyShare: Scalars['String'];
};

/** An object with an ID */
export type Node = {
  /** The ID of the object */
  id: Scalars['ID'];
};

export type OrganisationMemberType = {
  __typename?: 'OrganisationMemberType';
  createdAt?: Maybe<Scalars['DateTime']>;
  id: Scalars['String'];
  identityKey?: Maybe<Scalars['String']>;
  role: ApiOrganisationMemberRoleChoices;
  updatedAt: Scalars['DateTime'];
  wrappedKeyring: Scalars['String'];
};

export type OrganisationType = {
  __typename?: 'OrganisationType';
  createdAt?: Maybe<Scalars['DateTime']>;
  id: Scalars['String'];
  identityKey: Scalars['String'];
  name: Scalars['String'];
  plan: ApiOrganisationPlanChoices;
};

export type Query = {
  __typename?: 'Query';
  appActivityChart?: Maybe<Array<Maybe<ChartDataPointType>>>;
  appEnvironments?: Maybe<Array<Maybe<EnvironmentType>>>;
  apps?: Maybe<Array<Maybe<AppType>>>;
  environmentKeys?: Maybe<Array<Maybe<EnvironmentKeyType>>>;
  environmentSecrets?: Maybe<Array<Maybe<EnvironmentSecretType>>>;
  logs?: Maybe<Array<Maybe<KmsLogType>>>;
  logsCount?: Maybe<Scalars['Int']>;
  organisationAdminsAndSelf?: Maybe<Array<Maybe<OrganisationMemberType>>>;
  organisationMembers?: Maybe<Array<Maybe<OrganisationMemberType>>>;
  organisations?: Maybe<Array<Maybe<OrganisationType>>>;
  secretHistory?: Maybe<Array<Maybe<SecretEventType>>>;
  secretTags?: Maybe<Array<Maybe<SecretTagType>>>;
  secrets?: Maybe<Array<Maybe<SecretType>>>;
};


export type QueryAppActivityChartArgs = {
  appId?: InputMaybe<Scalars['ID']>;
  period?: InputMaybe<TimeRange>;
};


export type QueryAppEnvironmentsArgs = {
  appId?: InputMaybe<Scalars['ID']>;
};


export type QueryAppsArgs = {
  appId?: InputMaybe<Scalars['ID']>;
  organisationId?: InputMaybe<Scalars['ID']>;
};


export type QueryEnvironmentKeysArgs = {
  environmentId?: InputMaybe<Scalars['ID']>;
};


export type QueryEnvironmentSecretsArgs = {
  environmentId?: InputMaybe<Scalars['ID']>;
};


export type QueryLogsArgs = {
  appId?: InputMaybe<Scalars['ID']>;
  end?: InputMaybe<Scalars['BigInt']>;
  start?: InputMaybe<Scalars['BigInt']>;
};


export type QueryLogsCountArgs = {
  appId?: InputMaybe<Scalars['ID']>;
  thisMonth?: InputMaybe<Scalars['Boolean']>;
};


export type QueryOrganisationAdminsAndSelfArgs = {
  organisationId?: InputMaybe<Scalars['ID']>;
};


export type QueryOrganisationMembersArgs = {
  organisationId?: InputMaybe<Scalars['ID']>;
  role?: InputMaybe<Array<InputMaybe<Scalars['String']>>>;
  userId?: InputMaybe<Scalars['ID']>;
};


export type QuerySecretHistoryArgs = {
  secretId?: InputMaybe<Scalars['ID']>;
};


export type QuerySecretTagsArgs = {
  orgId?: InputMaybe<Scalars['ID']>;
};


export type QuerySecretsArgs = {
  envId?: InputMaybe<Scalars['ID']>;
};

export type RotateAppKeysMutation = {
  __typename?: 'RotateAppKeysMutation';
  app?: Maybe<AppType>;
};

export type SecretEventType = {
  __typename?: 'SecretEventType';
  comment: Scalars['String'];
  eventType: ApiSecretEventEventTypeChoices;
  id: Scalars['String'];
  key: Scalars['String'];
  secret: SecretType;
  tags: Array<Scalars['String']>;
  timestamp: Scalars['DateTime'];
  value: Scalars['String'];
  version: Scalars['Int'];
};

export type SecretFolderType = {
  __typename?: 'SecretFolderType';
  createdAt?: Maybe<Scalars['DateTime']>;
  id: Scalars['String'];
  name: Scalars['String'];
  updatedAt: Scalars['DateTime'];
};

export type SecretTagType = {
  __typename?: 'SecretTagType';
  id: Scalars['String'];
  name: Scalars['String'];
};

export type SecretType = {
  __typename?: 'SecretType';
  comment: Scalars['String'];
  createdAt?: Maybe<Scalars['DateTime']>;
  folder?: Maybe<SecretFolderType>;
  history?: Maybe<Array<Maybe<SecretEventType>>>;
  id: Scalars['String'];
  key: Scalars['String'];
  tags: Array<Scalars['String']>;
  updatedAt: Scalars['DateTime'];
  value: Scalars['String'];
  version: Scalars['Int'];
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
