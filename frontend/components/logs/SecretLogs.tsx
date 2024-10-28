'use client'

import { GetAppSecretsLogs } from '@/graphql/queries/secrets/getAppSecretsLogs.gql'
import { useLazyQuery } from '@apollo/client'
import {
  ApiSecretEventEventTypeChoices,
  EnvironmentKeyType,
  SecretEventType,
} from '@/apollo/graphql'
import { Disclosure, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaBan, FaChevronRight, FaExternalLinkAlt, FaKey, FaRobot } from 'react-icons/fa'
import { FiRefreshCw, FiChevronsDown } from 'react-icons/fi'
import { dateToUnixTimestamp, relativeTimeFromDates } from '@/utils/time'
import { ReactNode, useContext, useEffect, useRef, useState } from 'react'
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

// The historical start date for all log data (May 1st, 2023)
const LOGS_START_DATE = 1682904457000

type EnvKey = {
  envId: string
  keys: EnvKeypair
}

export default function SecretLogs(props: { app: string }) {
  const DEFAULT_PAGE_SIZE = 25
  const loglistEndRef = useRef<HTMLTableCellElement>(null)
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)
  const [getAppLogs, { data, loading }] = useLazyQuery(GetAppSecretsLogs)
  const [totalCount, setTotalCount] = useState<number>(0)
  const [logList, setLogList] = useState<SecretEventType[]>([])
  const [envKeys, setEnvKeys] = useState<EnvKey[]>([])
  const [endofList, setEndofList] = useState<boolean>(false)

  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const userCanReadLogs = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Logs', 'read', true)
    : false

  const getCurrentTimeStamp = () => Date.now()
  const getLastLogTimestamp = () =>
    logList.length > 0
      ? dateToUnixTimestamp(logList[logList.length - 1].timestamp)
      : getCurrentTimeStamp()

  /**
   * Fetches logs for the app with the given start and end timestamps,
   * and then adds the result of the query to the current log list.
   *
   * @param {number} start - Start datetime as unix timestamp (ms)
   * @param {number} end - End datetime as unix timestamp (ms)
   *
   * @returns {void}
   */
  const fetchLogs = (start: number, end: number) => {
    getAppLogs({
      variables: {
        appId: props.app,
        start,
        end,
      },
      fetchPolicy: 'network-only',
    }).then((result) => {
      if (result.data?.logs.secrets.length) {
        setLogList(logList.concat(result.data.logs.secrets))
      }
      if (result.data?.logs.length < DEFAULT_PAGE_SIZE) setEndofList(true)
    })
  }

  const clearLogList = () => setLogList([])

  /**
   * Gets the first page of logs, by resetting the log list and fetching logs using the current unix timestamp.
   *
   * @returns {void}
   */
  const getFirstPage = () => {
    setEndofList(false)
    fetchLogs(LOGS_START_DATE, getCurrentTimeStamp())
  }

  /**
   * Gets the new page of logs by using the last available timestamp from the current log list
   *
   * @returns {void}
   */
  const getNextPage = () => {
    fetchLogs(LOGS_START_DATE, getLastLogTimestamp())
  }

  /**
   * Hook to get the first page of logs on page load, or when the loglist is reset to empty
   */
  useEffect(() => {
    if (logList.length === 0) getFirstPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.app, logList])

  /**
   * Hook to update the log count once its available
   */
  useEffect(() => {
    if (data?.secretsLogsCount) setTotalCount(data.secretsLogsCount)
  }, [data])

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

  // useEffect(() => {
  //   const options = {
  //     root: null,
  //     rootMargin: '0px',
  //     threshold: 1.0,
  //   }
  //   const observer = new IntersectionObserver((entries) => {
  //     const [entry] = entries
  //     if (entry.isIntersecting) getNextPage()
  //   }, options)

  //   if (loglistEndRef.current) {
  //     if (endofList) observer.unobserve(loglistEndRef.current)
  //     else observer.observe(loglistEndRef.current)
  //   }

  //   return () => {
  //     if (loglistEndRef.current) observer.unobserve(loglistEndRef.current)
  //   }

  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [loglistEndRef])

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
      if (log.user)
        return (
          <div className="flex items-center gap-1 text-sm">
            <Avatar imagePath={log.user?.avatarUrl!} size="sm" />
            {log.user.fullName || log.user.email}
          </div>
        )
      else if (log.serviceToken)
        return (
          <div className="flex items-center gap-1 text-sm">
            <FaKey /> {log.serviceToken ? log.serviceToken.name : 'Service token'}
          </div>
        )
      else if (log.serviceAccount)
        return (
          <div className="flex items-center gap-1 text-sm">
            <div className="rounded-full flex items-center bg-neutral-500/40 justify-center size-6">
              <FaRobot className=" text-zinc-900 dark:text-zinc-100" />
            </div>{' '}
            {log.serviceAccount.name}
          </div>
        )
    }

    return (
      <Disclosure>
        {({ open }) => (
          <>
            <Disclosure.Button
              as="tr"
              className={clsx(
                'py-4 border-neutral-500/20 transition duration-300 ease-in-out cursor-pointer',
                open
                  ? 'bg-neutral-200 dark:bg-neutral-800 border-r'
                  : 'border-b hover:bg-neutral-200 dark:hover:bg-neutral-800'
              )}
            >
              {/* <tr > */}
              <td
                className={clsx(
                  'px-6 py-4 border-l-4',
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
              <td className="whitespace-nowrap px-6 py-4 font-mono">{log.environment.name}</td>
              <td className="whitespace-nowrap px-6 py-4 font-mono ph-no-capture">
                {decryptedEvent?.path !== '/' && `${decryptedEvent?.path}/`}
                {decryptedEvent?.key}
              </td>
              <td className="whitespace-nowrap px-6 py-4 font-medium capitalize">
                {relativeTimeStamp()}
              </td>
              {/* </tr> */}
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
                    'p-4 w-full space-y-6 bg-neutral-200 dark:bg-neutral-800 border-neutral-500/20',
                    open ? 'border-b border-l-2 border-l-emerald-500 border-r shadow-xl' : ''
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

                    <LogField label="Created by">{logCreatedBy(log)}</LogField>

                    <LogField label="IP address"> {log.ipAddress}</LogField>

                    <LogField label="User agent"> {log.userAgent}</LogField>

                    <LogField label="Event ID">{log.id}</LogField>

                    <LogField label="Timestamp">{verboseTimeStamp()}</LogField>

                    <div className="flex justify-end">
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
    const SKELETON_BASE_STYLE = 'dark:bg-neutral-700 bg-neutral-300 animate-pulse'
    return (
      <>
        {[...Array(props.rows)].map((_, n) => (
          <tr key={n} className="h-14 border-b border-neutral-500/20">
            <td className="px-6">
              <FaChevronRight className="dark:text-neutral-700 text-neutral-300 animate-pulse" />
            </td>
            <td className="px-6">
              <div className={clsx(SKELETON_BASE_STYLE, 'h-6 w-6 rounded-full')}></div>
            </td>
            <td className="px-6">
              <div className={clsx(SKELETON_BASE_STYLE, 'h-6 w-40 rounded-md')}></div>
            </td>
            <td className="px-6">
              <div className={clsx(SKELETON_BASE_STYLE, 'h-6 w-40 rounded-md')}></div>
            </td>
            <td className="px-6">
              <div className={clsx(SKELETON_BASE_STYLE, 'h-6 w-40 rounded-md')}></div>
            </td>
            <td className="px-6">
              <div className={clsx(SKELETON_BASE_STYLE, 'h-6 w-40 rounded-md')}></div>
            </td>
          </tr>
        ))}
      </>
    )
  }

  return (
    <>
      {userCanReadLogs ? (
        <div className="w-full text-black dark:text-white flex flex-col">
          <div className="flex w-full justify-between p-4 sticky top-0 z-10 bg-neutral-300/50 dark:bg-neutral-900/60 backdrop-blur-lg">
            <span className="text-neutral-500 font-light text-lg">
              {totalCount && <Count from={0} to={totalCount} />} Events
            </span>
            <Button variant="secondary" onClick={clearLogList} disabled={loading}>
              <FiRefreshCw
                size={20}
                className={clsx('mr-1', loading && logList.length === 0 ? 'animate-spin' : '')}
              />{' '}
              Refresh
            </Button>
          </div>
          <table className="table-auto w-full text-left text-sm font-light">
            <thead className="border-b-2 font-medium border-neutral-500/20 sticky top-[58px] z-10  bg-neutral-300/50 dark:bg-neutral-900/60 backdrop-blur-lg shadow-xl">
              <tr className="text-neutral-500">
                <th></th>
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Event</th>
                <th className="px-6 py-4">Environment</th>
                <th className="px-6 py-4">Secret</th>
                <th className="px-6 py-4">Time</th>
              </tr>
            </thead>
            <tbody className="h-full max-h-96 overflow-y-auto" ref={tableBodyRef}>
              {logList.map((log, n) => (
                <LogRow log={log} key={log.id} />
              ))}
              {loading && <SkeletonRow rows={DEFAULT_PAGE_SIZE} />}
              <tr className="h-40">
                <td colSpan={6} ref={loglistEndRef}>
                  <div className="flex justify-center px-6 py-4 text-neutral-500 font-medium">
                    {!endofList && (
                      <Button variant="secondary" onClick={getNextPage} disabled={loading}>
                        <FiChevronsDown /> Load more
                      </Button>
                    )}
                    {endofList && `No${logList.length ? ' more ' : ' '}logs to show`}
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
