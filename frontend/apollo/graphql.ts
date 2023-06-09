/* eslint-disable */
export type Maybe<T> = T | null
export type InputMaybe<T> = Maybe<T>
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] }
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> }
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> }
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string
  String: string
  Boolean: boolean
  Int: number
  Float: number
  /**
   * The `BigInt` scalar type represents non-fractional whole numeric values.
   * `BigInt` is not constrained to 32-bit like the `Int` type and thus is a less
   * compatible type.
   */
  BigInt: any
  /**
   * The `DateTime` scalar type represents a DateTime
   * value as specified by
   * [iso8601](https://en.wikipedia.org/wiki/ISO_8601).
   */
  DateTime: any
}

/** An enumeration. */
export enum ApiOrganisationPlanChoices {
  /** Enterprise */
  En = 'EN',
  /** Free */
  Fr = 'FR',
  /** Pro */
  Pr = 'PR',
}

export type AppType = {
  __typename?: 'AppType'
  appSeed: Scalars['String']
  appToken: Scalars['String']
  appVersion: Scalars['Int']
  createdAt?: Maybe<Scalars['DateTime']>
  id: Scalars['String']
  identityKey: Scalars['String']
  name: Scalars['String']
  wrappedKeyShare: Scalars['String']
}

export type ChartDataPointType = {
  __typename?: 'ChartDataPointType'
  data?: Maybe<Scalars['Int']>
  date?: Maybe<Scalars['BigInt']>
  index?: Maybe<Scalars['Int']>
}

export type CreateAppMutation = {
  __typename?: 'CreateAppMutation'
  app?: Maybe<AppType>
}

export type CreateOrganisationMutation = {
  __typename?: 'CreateOrganisationMutation'
  organisation?: Maybe<OrganisationType>
}

export type DeleteAppMutation = {
  __typename?: 'DeleteAppMutation'
  app?: Maybe<AppType>
}

export type KmsLogType = Node & {
  __typename?: 'KMSLogType'
  appId?: Maybe<Scalars['String']>
  asn?: Maybe<Scalars['Int']>
  city?: Maybe<Scalars['String']>
  country?: Maybe<Scalars['String']>
  edgeLocation?: Maybe<Scalars['String']>
  eventType?: Maybe<Scalars['String']>
  id: Scalars['ID']
  ipAddress?: Maybe<Scalars['String']>
  isp?: Maybe<Scalars['String']>
  latitude?: Maybe<Scalars['Float']>
  longitude?: Maybe<Scalars['Float']>
  phSize?: Maybe<Scalars['Int']>
  phaseNode?: Maybe<Scalars['String']>
  timestamp?: Maybe<Scalars['BigInt']>
}

export type Mutation = {
  __typename?: 'Mutation'
  createApp?: Maybe<CreateAppMutation>
  createOrganisation?: Maybe<CreateOrganisationMutation>
  deleteApp?: Maybe<DeleteAppMutation>
  rotateAppKeys?: Maybe<RotateAppKeysMutation>
}

export type MutationCreateAppArgs = {
  appSeed: Scalars['String']
  appToken: Scalars['String']
  appVersion: Scalars['Int']
  id: Scalars['ID']
  identityKey: Scalars['String']
  name: Scalars['String']
  organisationId: Scalars['ID']
  wrappedKeyShare: Scalars['String']
}

export type MutationCreateOrganisationArgs = {
  id: Scalars['ID']
  identityKey: Scalars['String']
  name: Scalars['String']
}

export type MutationDeleteAppArgs = {
  id: Scalars['ID']
}

export type MutationRotateAppKeysArgs = {
  appToken: Scalars['String']
  id: Scalars['ID']
  wrappedKeyShare: Scalars['String']
}

/** An object with an ID */
export type Node = {
  /** The ID of the object */
  id: Scalars['ID']
}

export type OrganisationType = {
  __typename?: 'OrganisationType'
  createdAt?: Maybe<Scalars['DateTime']>
  id: Scalars['String']
  identityKey: Scalars['String']
  name: Scalars['String']
  plan: ApiOrganisationPlanChoices
}

export type Query = {
  __typename?: 'Query'
  appActivityChart?: Maybe<Array<Maybe<ChartDataPointType>>>
  apps?: Maybe<Array<Maybe<AppType>>>
  logs?: Maybe<Array<Maybe<KmsLogType>>>
  logsCount?: Maybe<Scalars['Int']>
  organisations?: Maybe<Array<Maybe<OrganisationType>>>
}

export type QueryAppActivityChartArgs = {
  appId?: InputMaybe<Scalars['ID']>
  period?: InputMaybe<TimeRange>
}

export type QueryAppsArgs = {
  appId?: InputMaybe<Scalars['ID']>
  organisationId?: InputMaybe<Scalars['ID']>
}

export type QueryLogsArgs = {
  appId?: InputMaybe<Scalars['ID']>
  end?: InputMaybe<Scalars['BigInt']>
  start?: InputMaybe<Scalars['BigInt']>
}

export type QueryLogsCountArgs = {
  appId?: InputMaybe<Scalars['ID']>
  thisMonth?: InputMaybe<Scalars['Boolean']>
}

export type RotateAppKeysMutation = {
  __typename?: 'RotateAppKeysMutation'
  app?: Maybe<AppType>
}

/** An enumeration. */
export enum TimeRange {
  AllTime = 'ALL_TIME',
  Day = 'DAY',
  Hour = 'HOUR',
  Month = 'MONTH',
  Week = 'WEEK',
  Year = 'YEAR',
}
