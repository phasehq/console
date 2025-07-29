'use client'

import { GetAppSecretsLogs } from '@/graphql/queries/secrets/getAppSecretsLogs.gql'
import { NetworkStatus, useQuery } from '@apollo/client'
import {
  ApiSecretEventEventTypeChoices,
  EnvironmentKeyType,
  SecretEventType,
  OrganisationMemberType,
  ServiceAccountType,
  MemberType,
  EnvironmentType,
} from '@/apollo/graphql'
import { Disclosure, Menu, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaArrowRight,
  FaBan,
  FaChevronRight,
  FaExternalLinkAlt,
  FaChevronDown,
  FaCircle,
  FaCheckCircle,
  FaKey,
  FaRobot,
} from 'react-icons/fa'
import { FiRefreshCw, FiChevronsDown } from 'react-icons/fi'
import { dateToUnixTimestamp, relativeTimeFromDates } from '@/utils/time'
import { ReactNode, Fragment, useContext, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/common/Button'
import { Count } from 'reaviz'
import { Avatar } from '../common/Avatar'
import { KeyringContext } from '@/contexts/keyringContext'
import { organisationContext } from '@/contexts/organisationContext'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  getUserKxPublicKey,
  getUserKxPrivateKey,
  decryptAsymmetric,
  envKeyring,
  EnvKeypair,
} from '@/utils/crypto'
import { userHasPermission } from '@/utils/access/permissions'
import { EmptyState } from '../common/EmptyState'
import { Popover, Combobox, RadioGroup } from '@headlessui/react'
import { FaFilter } from 'react-icons/fa'
import { GetAppAccounts } from '@/graphql/queries/apps/getAppAccounts.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { FaArrowRotateLeft } from 'react-icons/fa6'

// The historical start date for all log data (May 1st, 2023)
const LOGS_START_DATE = 1682904457000

// One day in ms
const DAY = 24 * 60 * 60 * 1000

const getCurrentTimeStamp = () => Date.now()

type EnvKey = {
  envId: string
  keys: EnvKeypair
}

export default function SecretLogs(props: { app: string }) {
  const DEFAULT_PAGE_SIZE = 25
  const loglistEndRef = useRef<HTMLTableCellElement>(null)

  const [envKeys, setEnvKeys] = useState<EnvKey[]>([])

  /* ---------------------- 🔍 Filter state ---------------------- */
  const [queryStart, setQueryStart] = useState<number>(LOGS_START_DATE)
  const [queryEnd, setQueryEnd] = useState<number>(getCurrentTimeStamp())
  const [eventTypes, setEventTypes] = useState<string[]>([])
  const [selectedUser, setSelectedUser] = useState<OrganisationMemberType | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<ServiceAccountType | null>(null)
  const [selectedEnvironment, setSelectedEnvironment] = useState<EnvironmentType | null>(null)
  const [dateRange, setDateRange] = useState<'7' | '30' | '90' | 'custom' | null>(null)
  const [accountQuery, setAccountQuery] = useState('')
  const [envQuery, setEnvQuery] = useState('')

  const { data: accountsData } = useQuery(GetAppAccounts, {
    variables: { appId: props.app },
  })

  const { data: envsData } = useQuery(GetAppEnvironments, {
    variables: { appId: props.app },
  })

  useEffect(() => {
    const now = getCurrentTimeStamp()

    if (dateRange === '7') {
      setQueryStart(now - 7 * DAY)
      setQueryEnd(now)
    } else if (dateRange === '30') {
      setQueryStart(now - 30 * DAY)
      setQueryEnd(now)
    } else if (dateRange === '90') {
      setQueryStart(now - 90 * DAY)
      setQueryEnd(now)
    } else if (dateRange === null) {
      setQueryStart(LOGS_START_DATE)
      setQueryEnd(getCurrentTimeStamp())
    }
  }, [dateRange])

  const { data, loading, fetchMore, refetch, networkStatus } = useQuery(GetAppSecretsLogs, {
    variables: {
      appId: props.app,
      start: queryStart,
      end: queryEnd,
      eventTypes: eventTypes.length ? eventTypes : null,
      memberId: selectedUser ? selectedUser.id : selectedAccount ? selectedAccount.id : null,
      memberType: selectedUser ? MemberType.User : selectedAccount ? MemberType.Service : null,
      environmentId: selectedEnvironment ? selectedEnvironment.id : null,
    },
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
  })

  const isRefetching = networkStatus === NetworkStatus.refetch || loading
  const isFetchingMore = networkStatus === NetworkStatus.fetchMore

  const handleRefetch = async () => {
    const now = Date.now()

    await refetch({
      appId: props.app,
      start: queryStart,
      end: dateRange === 'custom' ? queryEnd : now,
      eventTypes: eventTypes.length ? eventTypes : null,
      memberId: selectedUser?.id ?? selectedAccount?.id ?? null,
      memberType: selectedUser ? MemberType.User : selectedAccount ? MemberType.Service : null,
      pageSize: DEFAULT_PAGE_SIZE,
    })
  }

  const logs: Array<SecretEventType> = data?.secretLogs.logs || []
  const totalCount = data?.secretLogs.count || 0
  const endOfList = logs.length === totalCount

  const memberOptions: OrganisationMemberType[] = accountsData?.appUsers ?? []
  const accountOptions: ServiceAccountType[] = accountsData?.appServiceAccounts ?? []

  const envOptions: EnvironmentType[] = envsData?.appEnvironments ?? []

  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const userCanReadLogs = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Logs', 'read', true)
    : false

  const getLastLogTimestamp = () =>
    logs.length > 0 ? dateToUnixTimestamp(logs[logs.length - 1].timestamp) : getCurrentTimeStamp()

  /**
   * Fetches logs for the app with the given start and end timestamps,
   * and then adds the result of the query to the current log list.
   *
   * @param {number} start - Start datetime as unix timestamp (ms)
   * @param {number} end - End datetime as unix timestamp (ms)
   *
   * @returns {void}
   */
  const loadMore = () => {
    if (loading || isFetchingMore) return

    const lastTs = getLastLogTimestamp()

    fetchMore({
      variables: { end: lastTs },
      updateQuery: (prev, { fetchMoreResult }) => {
        if (!fetchMoreResult?.secretLogs?.logs?.length) {
          return prev
        }

        return {
          ...prev,
          secretLogs: {
            ...prev.secretLogs,
            logs: [...prev.secretLogs.logs, ...fetchMoreResult.secretLogs.logs],
            count: prev.secretLogs.count,
          },
          environmentKeys: prev.environmentKeys,
        }
      },
    })
  }

  useEffect(() => {
    const initEnvKeys = async () => {
      const keys = [] as EnvKey[]

      const unwrapKeyPromises = data.environmentKeys.map(async (envKey: EnvironmentKeyType) => {
        const { wrappedSeed } = envKey

        const userKxKeys = {
          publicKey: await getUserKxPublicKey(keyring!.publicKey),
          privateKey: await getUserKxPrivateKey(keyring!.privateKey),
        }
        const seed = await decryptAsymmetric(
          wrappedSeed,
          userKxKeys.privateKey,
          userKxKeys.publicKey
        )

        const { publicKey, privateKey } = await envKeyring(seed)

        keys.push({
          envId: envKey.environment.id,
          keys: { publicKey, privateKey },
        })
      })

      await Promise.all(unwrapKeyPromises)

      setEnvKeys(keys)
    }

    if (data && keyring) initEnvKeys()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, keyring])

  const LogRow = (props: { log: SecretEventType }) => {
    const { log } = props

    const appPath = usePathname()?.split('/').slice(0, -1).join('/')

    const [decryptedEvent, setDecryptedEvent] = useState<SecretEventType | null>(null)

    useEffect(() => {
      const decryptSecretEvent = async () => {
        const event = log

        const decryptedEvent = structuredClone(event)

        const envKeyPair = envKeys.find((envKey) => envKey.envId === event.environment.id)

        const { publicKey, privateKey } = envKeyPair!.keys

        // Decrypt event fields
        decryptedEvent!.key = await decryptAsymmetric(event!.key, privateKey, publicKey)

        setDecryptedEvent(decryptedEvent)
      }

      if (log && envKeys.length > 0) decryptSecretEvent()
    }, [log])

    const relativeTimeStamp = () => {
      return relativeTimeFromDates(new Date(log.timestamp))
    }

    const verboseTimeStamp = () => {
      const date = new Date(log.timestamp)
      return date.toISOString()
    }

    const LogField = (props: { label: string; children: ReactNode }) => {
      return (
        <div className="flex items-center gap-2">
          <span className="text-neutral-500 font-medium">{props.label}: </span>
          <span className="font-semibold font-mono">{props.children}</span>
        </div>
      )
    }

    const getEventTypeColor = (eventType: ApiSecretEventEventTypeChoices) => {
      if (eventType === ApiSecretEventEventTypeChoices.C) return 'bg-emerald-500'
      if (eventType === ApiSecretEventEventTypeChoices.U) return 'bg-yellow-500'
      if (eventType === ApiSecretEventEventTypeChoices.R) return 'bg-blue-500'
      if (eventType === ApiSecretEventEventTypeChoices.D) return 'bg-red-500'
    }

    const getEventTypeText = (eventType: ApiSecretEventEventTypeChoices) => {
      if (eventType === ApiSecretEventEventTypeChoices.C) return 'Created secret'
      if (eventType === ApiSecretEventEventTypeChoices.U) return 'Updated secret'
      if (eventType === ApiSecretEventEventTypeChoices.R) return 'Read secret'
      if (eventType === ApiSecretEventEventTypeChoices.D) return 'Deleted secret'
    }

    const logCreatedBy = (log: SecretEventType) => {
      const textStyle = 'text-sm font-medium text-zinc-900 dark:text-zinc-100'

      if (log.user)
        return (
          <div className={clsx('flex items-center gap-1', textStyle)}>
            <Avatar member={log.user} size="sm" />
            {log.user.fullName || log.user.email}
          </div>
        )
      else if (log.serviceToken)
        return (
          <div className={clsx('flex items-center gap-1', textStyle)}>
            <FaKey /> {log.serviceToken ? log.serviceToken.name : 'Service token'}
          </div>
        )
      else if (log.serviceAccount)
        return (
          <div
            className={clsx(
              'flex items-center gap-1',
              textStyle,
              log.serviceAccount.deletedAt && 'grayscale'
            )}
          >
            <Avatar serviceAccount={log.serviceAccount} size="sm" />
            <span className={clsx(log.serviceAccount.deletedAt ? 'line-through' : '')}>
              {log.serviceAccount.name}
            </span>
            {log.serviceAccount.deletedAt && (
              <span className="text-neutral-500 font-normal">(Deleted)</span>
            )}
            {/* {log.serviceAccountToken && !log.serviceAccount.deletedAt && (
              <span className={clsx(log.serviceAccountToken.deletedAt ? 'line-through' : '')}>
                ({log.serviceAccountToken.name})
              </span>
            )} */}
          </div>
        )
    }

    if (!decryptedEvent) return <SkeletonRow rows={1} />

    return (
      <Disclosure>
        {({ open }) => (
          <>
            <Disclosure.Button
              as="tr"
              className={clsx(
                'py-4 border-neutral-500/20 transition duration-300 ease-in-out cursor-pointer',
                open
                  ? 'bg-neutral-100 dark:bg-neutral-800 border-r'
                  : 'border-b hover:bg-neutral-100 dark:hover:bg-neutral-800'
              )}
            >
              <td
                className={clsx(
                  'px-6 py-4 border-l',
                  open ? 'border-l-emerald-500 ' : 'border-l-transparent'
                )}
              >
                <FaChevronRight
                  className={clsx(
                    'transform transition-all duration-300',
                    open && 'rotate-90 text-emerald-500'
                  )}
                />
              </td>
              <td className="whitespace-nowrap px-6 py-4">
                <div className="text-sm flex items-center gap-2 text-neutral-500">
                  {logCreatedBy(log)}
                </div>
              </td>
              <td className="whitespace-nowrap px-6 py-4">
                <div className="flex flex-row items-center gap-2 -ml-1">
                  <span
                    className={clsx('h-2 w-2 rounded-full', getEventTypeColor(log.eventType))}
                  ></span>
                  <div className="text-zinc-800 dark:text-zinc-200 font-semibold">
                    {getEventTypeText(log.eventType)}
                  </div>
                </div>
              </td>
              <td className="whitespace-nowrap px-6 py-4">{log.environment.name}</td>
              <td className="whitespace-nowrap px-6 py-4 font-mono ph-no-capture font-medium">
                {decryptedEvent?.path !== '/' && `${decryptedEvent?.path}/`}
                {decryptedEvent?.key}
              </td>
              <td className="whitespace-nowrap px-6 py-4 font-medium capitalize">
                {relativeTimeStamp()}
              </td>
            </Disclosure.Button>
            <Transition
              as="tr"
              enter="transition duration-100 ease-out"
              enterFrom="transform scale-95 opacity-0"
              enterTo="transform scale-100 opacity-100"
              leave="transition duration-75 ease-out"
              leaveFrom="transform scale-100 opacity-100"
              leaveTo="transform scale-95 opacity-0"
            >
              <td colSpan={6}>
                <Disclosure.Panel
                  className={clsx(
                    'p-4 w-full space-y-6 bg-neutral-100 dark:bg-neutral-800 border-neutral-500/20 border-l -ml-px',
                    open
                      ? 'border-b  border-l-emerald-500 border-r shadow-xl'
                      : 'border-l-transparent'
                  )}
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 w-full gap-4 text-sm">
                    <LogField label="Environment">
                      <div className="flex items-center gap-2 ph-no-capture">
                        {decryptedEvent?.environment.name}
                      </div>
                    </LogField>

                    <LogField label="Path">
                      <div className="flex items-center gap-2 ph-no-capture">
                        {decryptedEvent?.path}
                      </div>
                    </LogField>

                    <LogField label="Key">
                      <div className="flex items-center gap-2 ph-no-capture">
                        {decryptedEvent?.key}
                      </div>
                    </LogField>

                    <LogField label="Created by">
                      <div className="flex items-center gap-2">
                        {logCreatedBy(log)}{' '}
                        {log.serviceAccount && !log.serviceAccount.deletedAt && (
                          <Link
                            href={`/${organisation!.name}/access/service-accounts/${log.serviceAccount.id}`}
                            className="font-sans"
                          >
                            <Button variant="outline">
                              Manage account <FaArrowRight />
                            </Button>
                          </Link>
                        )}
                      </div>
                    </LogField>

                    {log.serviceAccountToken && (
                      <LogField label="Token">
                        <div className="flex items-center gap-2">
                          <FaKey className="text-neutral-500" />
                          <span
                            className={clsx(
                              log.serviceAccountToken.deletedAt ? 'line-through' : ''
                            )}
                          >
                            ({log.serviceAccountToken.name}){' '}
                          </span>
                          {log.serviceAccountToken.deletedAt && (
                            <span className="text-neutral-500 font-normal">(Deleted)</span>
                          )}

                          {!log.serviceAccountToken.deletedAt && (
                            <Link
                              href={`/${organisation!.name}/access/service-accounts/${log.serviceAccount?.id}`}
                              className="font-sans"
                            >
                              <Button variant="outline">
                                Manage tokens <FaArrowRight />
                              </Button>
                            </Link>
                          )}
                        </div>
                      </LogField>
                    )}

                    <LogField label="IP address"> {log.ipAddress}</LogField>

                    <LogField label="User agent"> {log.userAgent}</LogField>

                    <LogField label="Event ID">{log.id}</LogField>

                    <LogField label="Timestamp">{verboseTimeStamp()}</LogField>

                    <div className="flex justify-end md:col-span-3">
                      <Button variant="outline">
                        <Link
                          className="flex items-center gap-2"
                          href={`${appPath}/environments/${log.environment.id}${log.secret.path}?secret=${log.secret.id}`}
                        >
                          View this secret
                          <FaExternalLinkAlt />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </Disclosure.Panel>
              </td>
            </Transition>
          </>
        )}
      </Disclosure>
    )
  }

  const SkeletonRow = (props: { rows: number }) => {
    const SKELETON_BASE = 'bg-neutral-300 dark:bg-neutral-700 animate-pulse'

    return (
      <>
        {[...Array(props.rows)].map((_, n) => (
          <tr
            key={n}
            className="py-4 border-b border-neutral-500/20 transition duration-300 ease-in-out"
          >
            <td className="px-6 py-4 border-l border-l-transparent">
              <FaChevronRight className="text-neutral-300 dark:text-neutral-700 animate-pulse" />
            </td>
            <td className="whitespace-nowrap px-6 py-4">
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <div className="rounded-full flex items-center justify-center size-6 bg-neutral-400/30" />
                <div className={`${SKELETON_BASE} h-4 w-32 rounded-md`} />
              </div>
            </td>
            <td className="whitespace-nowrap px-6 py-4">
              <div className="flex items-center gap-2 -ml-1">
                <span className="h-2 w-2 rounded-full bg-neutral-400" />
                <div className={`${SKELETON_BASE} h-4 w-28 rounded-md`} />
              </div>
            </td>
            <td className="whitespace-nowrap px-6 py-4 font-mono">
              <div className={`${SKELETON_BASE} h-4 w-24 rounded-md`} />
            </td>
            <td className="whitespace-nowrap px-6 py-4 font-mono">
              <div className={`${SKELETON_BASE} h-4 w-32 rounded-md`} />
            </td>
            <td className="whitespace-nowrap px-6 py-4 font-medium capitalize">
              <div className={`${SKELETON_BASE} h-4 w-20 rounded-md`} />
            </td>
          </tr>
        ))}
      </>
    )
  }

  const clearFilters = () => {
    setEventTypes([])
    setSelectedUser(null)
    setSelectedAccount(null)
    setDateRange(null)
    setQueryStart(LOGS_START_DATE)
    setQueryEnd(getCurrentTimeStamp())
    setSelectedEnvironment(null)
  }

  const hasActiveFilters =
    eventTypes.length > 0 || selectedUser !== null || selectedAccount !== null || dateRange !== null
  selectedEnvironment !== null

  const filterCategoryTitleStyle =
    'text-[11px] font-semibold text-neutral-500 tracking-widest uppercase'

  function formatTimestampForInput(ts: number): string {
    const date = new Date(ts)
    const pad = (n: number) => n.toString().padStart(2, '0')

    const year = date.getFullYear()
    const month = pad(date.getMonth() + 1) // months are 0-indexed
    const day = pad(date.getDate())
    const hours = pad(date.getHours())
    const minutes = pad(date.getMinutes())

    return `${year}-${month}-${day}T${hours}:${minutes}`
  }

  return (
    <>
      {userCanReadLogs ? (
        <div className="w-full text-black dark:text-white flex flex-col">
          <div className="flex w-full justify-between p-4 sticky top-0 z-5 bg-neutral-200 dark:bg-neutral-900">
            <span className="text-neutral-500 font-light text-lg">
              {totalCount !== undefined && <Count from={0} to={totalCount} />} Events
            </span>

            <div className="flex items-center gap-2">
              {/* Filter popover */}

              <Menu as="div" className="relative inline-block text-left">
                {({ open }) => (
                  <>
                    <div className="relative">
                      <Menu.Button as={Fragment}>
                        <div className="relative">
                          <Button variant="secondary" title="Filter logs">
                            <FaFilter /> Filter
                          </Button>
                          {hasActiveFilters && (
                            <span className="absolute -top-0 -right-0 h-2 w-2 rounded-full bg-emerald-500" />
                          )}
                        </div>
                      </Menu.Button>
                    </div>

                    <Transition
                      as={Fragment}
                      enter="transition duration-100 ease-out"
                      enterFrom="transform scale-95 opacity-0"
                      enterTo="transform scale-100 opacity-100"
                      leave="transition duration-75 ease-out"
                      leaveFrom="transform scale-100 opacity-100"
                      leaveTo="transform scale-95 opacity-0"
                    >
                      <Menu.Items
                        static
                        className="absolute right-0 mt-2 z-30 w-96 p-4 rounded-md shadow-xl bg-neutral-300/50 dark:bg-neutral-900/60 backdrop-blur-lg ring-1 ring-neutral-500/20 space-y-6"
                      >
                        {/* Event types */}
                        <div className="space-y-2">
                          <div className={filterCategoryTitleStyle}>Event Type</div>
                          <div className="flex flex-wrap gap-2">
                            {(
                              [
                                { code: 'C', label: 'Create', color: 'emerald' },
                                { code: 'U', label: 'Update', color: 'yellow' },
                                { code: 'R', label: 'Read', color: 'blue' },
                                { code: 'D', label: 'Delete', color: 'red' },
                              ] as const
                            ).map((ev) => (
                              <Button
                                key={ev.code}
                                type="button"
                                variant={eventTypes.includes(ev.code) ? 'primary' : 'secondary'}
                                onClick={() =>
                                  setEventTypes((prev) =>
                                    prev.includes(ev.code)
                                      ? prev.filter((c) => c !== ev.code)
                                      : [...prev, ev.code]
                                  )
                                }
                              >
                                <span
                                  className={clsx(
                                    'text-2xs',
                                    {
                                      emerald: 'text-emerald-500',
                                      yellow: 'text-yellow-500',
                                      blue: 'text-blue-500',
                                      red: 'text-red-500',
                                    }[ev.color]
                                  )}
                                >
                                  {eventTypes.includes(ev.code) ? <FaCheckCircle /> : <FaCircle />}
                                </span>{' '}
                                <span className="text-xs">{ev.label}</span>
                              </Button>
                            ))}
                          </div>
                        </div>

                        {/* Identity (User or Service account) filter */}
                        <div className="space-y-2">
                          <div className={filterCategoryTitleStyle}>Account</div>
                          <Combobox
                            value={selectedUser || (selectedAccount as any)}
                            by="id"
                            onChange={(val) => {
                              if ('fullName' in val || 'email' in val) {
                                setSelectedUser(val as OrganisationMemberType)
                                setSelectedAccount(null)
                              } else {
                                setSelectedAccount(val as ServiceAccountType)
                                setSelectedUser(null)
                              }
                            }}
                          >
                            {({ open }) => (
                              <>
                                <div className="relative">
                                  <Combobox.Input
                                    className="w-full bg-neutral-200 dark:bg-neutral-800 rounded-md p-2 text-sm"
                                    onChange={(e) => setAccountQuery(e.target.value)}
                                    displayValue={(val: any) => {
                                      if (!val) return ''
                                      return 'fullName' in val || 'email' in val
                                        ? val.fullName || val.email
                                        : val.name
                                    }}
                                    placeholder="Search accounts"
                                  />
                                  <Combobox.Button className="absolute inset-y-0 right-2 flex items-center">
                                    <FaChevronDown className="text-neutral-500" />
                                  </Combobox.Button>
                                </div>
                                {open && (
                                  <Combobox.Options as={Fragment}>
                                    <div className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto bg-neutral-200 dark:bg-neutral-800 rounded-md p-2 shadow-xl space-y-1">
                                      {[...memberOptions, ...accountOptions]
                                        .filter((item) => {
                                          if (!accountQuery) return true
                                          const q = accountQuery.toLowerCase()
                                          if ('name' in item) {
                                            return item.name.toLowerCase().includes(q)
                                          }
                                          return (
                                            (item.fullName || '').toLowerCase().includes(q) ||
                                            (item.email || '').toLowerCase().includes(q)
                                          )
                                        })
                                        .map((item) => (
                                          <Combobox.Option key={item.id} value={item} as={Fragment}>
                                            {({ active, selected }) => (
                                              <div
                                                className={clsx(
                                                  'flex items-center justify-between px-2 py-1 rounded-md cursor-pointer text-xs',
                                                  active && 'bg-neutral-300 dark:bg-neutral-700'
                                                )}
                                              >
                                                <div className="flex items-center gap-1">
                                                  {'name' in item ? (
                                                    <div className="size-5 flex items-center justify-center ring-1 ring-inset ring-neutral-500/40  bg-neutral-400/10 rounded-full">
                                                      <FaRobot className="text-neutral-500" />
                                                    </div>
                                                  ) : (
                                                    <Avatar
                                                      member={item as OrganisationMemberType}
                                                      size="sm"
                                                    />
                                                  )}
                                                  <span>
                                                    {'name' in item
                                                      ? item.name
                                                      : item.fullName || item.email}
                                                  </span>
                                                </div>
                                                {selected && (
                                                  <FaCheckCircle className="text-emerald-500" />
                                                )}
                                              </div>
                                            )}
                                          </Combobox.Option>
                                        ))}
                                    </div>
                                  </Combobox.Options>
                                )}
                              </>
                            )}
                          </Combobox>
                        </div>

                        {/* Environment filter */}
                        <div className="space-y-2">
                          <div className={filterCategoryTitleStyle}>Environment</div>
                          <Combobox
                            value={selectedEnvironment}
                            by="id"
                            onChange={(env) => setSelectedEnvironment(env)}
                          >
                            {({ open }) => (
                              <>
                                <div className="relative">
                                  <Combobox.Input
                                    className="w-full bg-neutral-200 dark:bg-neutral-800 rounded-md p-2 text-sm"
                                    onChange={(e) => setEnvQuery(e.target.value)}
                                    displayValue={(env: EnvironmentType | null) => env?.name || ''}
                                    placeholder="Search environments"
                                  />
                                  <Combobox.Button className="absolute inset-y-0 right-2 flex items-center">
                                    <FaChevronDown className="text-neutral-500" />
                                  </Combobox.Button>
                                </div>
                                {open && (
                                  <Combobox.Options as={Fragment}>
                                    <div className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto bg-neutral-200 dark:bg-neutral-800 rounded-md p-2 shadow-xl space-y-1">
                                      {envOptions
                                        .filter((env) => {
                                          if (!envQuery) return true
                                          const q = envQuery.toLowerCase()

                                          return env.name.toLowerCase().includes(q)
                                        })
                                        .map((env) => (
                                          <Combobox.Option key={env.id} value={env} as={Fragment}>
                                            {({ active, selected }) => (
                                              <div
                                                className={clsx(
                                                  'flex items-center justify-between gap-2 px-2 py-1 rounded-md cursor-pointer text-xs',
                                                  active && 'bg-neutral-300 dark:bg-neutral-700'
                                                )}
                                              >
                                                {env.name}
                                                {selected && (
                                                  <FaCheckCircle className="text-emerald-500" />
                                                )}
                                              </div>
                                            )}
                                          </Combobox.Option>
                                        ))}
                                    </div>
                                  </Combobox.Options>
                                )}
                              </>
                            )}
                          </Combobox>
                        </div>

                        {/* Date range */}
                        <div className="space-y-2">
                          <div className={filterCategoryTitleStyle}>Date range</div>
                          <RadioGroup
                            value={dateRange}
                            onChange={setDateRange}
                            className="flex gap-2 flex-wrap"
                          >
                            {[
                              { value: '7', label: 'Last 7d' },
                              { value: '30', label: 'Last 30d' },
                              { value: '90', label: 'Last 90d' },
                              { value: 'custom', label: 'Custom' },
                            ].map(({ value, label }) => (
                              <RadioGroup.Option key={value} value={value} as={Fragment}>
                                {({ checked }) => (
                                  <Button
                                    type="button"
                                    variant={checked ? 'primary' : 'secondary'}
                                    classString="text-xs py-0.5 px-2"
                                  >
                                    {checked ? (
                                      <FaCheckCircle className="text-emerald-500" />
                                    ) : (
                                      <FaCircle />
                                    )}{' '}
                                    {label}
                                  </Button>
                                )}
                              </RadioGroup.Option>
                            ))}
                          </RadioGroup>
                          {dateRange === 'custom' && (
                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center gap-2">
                                <label className="text-neutral-500 text-2xs w-8">Start</label>
                                <input
                                  type="datetime-local"
                                  className="flex-1 p-1 rounded-md bg-neutral-200 dark:bg-neutral-800 text-xs"
                                  value={formatTimestampForInput(queryStart)}
                                  onChange={(e) =>
                                    setQueryStart(new Date(e.target.value).getTime())
                                  }
                                />
                              </div>
                              <div className="flex justify-between items-center gap-2">
                                <label className="text-neutral-500 text-2xs w-8">End</label>
                                <input
                                  type="datetime-local"
                                  className="flex-1 p-1 rounded-md bg-neutral-200 dark:bg-neutral-800 text-xs"
                                  value={formatTimestampForInput(queryEnd)}
                                  onChange={(e) => setQueryEnd(new Date(e.target.value).getTime())}
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end pt-2">
                          <Button
                            variant="outline"
                            disabled={!hasActiveFilters}
                            onClick={clearFilters}
                          >
                            <FaArrowRotateLeft /> Reset filter
                          </Button>
                        </div>
                      </Menu.Items>
                    </Transition>
                  </>
                )}
              </Menu>

              {/* Refresh */}

              <Button variant="secondary" onClick={handleRefetch} disabled={isRefetching}>
                <FiRefreshCw
                  size={20}
                  className={clsx('mr-1', isRefetching ? 'animate-spin' : '')}
                />{' '}
                Refresh
              </Button>
            </div>
          </div>
          <table className="table-fixed w-full text-left text-sm">
            <thead className="border-b-2 border-neutral-500/20 sticky top-[58px] z-1 bg-neutral-200/50 dark:bg-neutral-900/60 backdrop-blur-lg shadow-xl">
              <tr className="text-gray-500 uppercase text-2xs tracking-wider">
                <th className="w-10"></th>
                <th className="px-6 py-4">Account</th>
                <th className="px-6 py-4">Event</th>
                <th className="px-6 py-4">Environment</th>
                <th className="px-6 py-4">Secret</th>
                <th className="px-6 py-4">Time</th>
              </tr>
            </thead>
            <tbody className="h-full">
              {logs.map((log, n) => (
                <Fragment key={log.id}>
                  {n !== 0 && n % DEFAULT_PAGE_SIZE === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <div className="flex items-center justify-center bg-zinc-300 dark:bg-zinc-800 py-0.5 text-neutral-500 text-xs">
                          Page {n / DEFAULT_PAGE_SIZE + 1}
                        </div>
                      </td>
                    </tr>
                  )}
                  <LogRow log={log} />
                </Fragment>
              ))}

              {loading && <SkeletonRow rows={DEFAULT_PAGE_SIZE} />}

              <tr className="h-40">
                <td colSpan={6} ref={loglistEndRef}>
                  <div className="flex justify-center px-6 py-4 text-neutral-500 font-medium">
                    {!endOfList && (
                      <Button
                        variant="secondary"
                        onClick={loadMore}
                        disabled={isFetchingMore || endOfList}
                      >
                        <FiChevronsDown /> Load more
                      </Button>
                    )}
                    {endOfList && `No${logs.length ? ' more ' : ' '}logs to show`}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view Logs in this app."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      )}
    </>
  )
}
