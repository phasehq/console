'use client'

import { useContext, useState, useEffect, Dispatch, SetStateAction } from 'react'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { KeyringContext } from '@/contexts/keyringContext'
import { CreateNewUserToken } from '@/graphql/mutations/users/createUserToken.gql'
import { getUserKxPublicKey, getUserKxPrivateKey, generateUserToken } from '@/utils/crypto'
import { getUnixTimeStampinFuture, relativeTimeFromDates } from '@/utils/time'

import clsx from 'clsx'
import { Button } from '../common/Button'
import { CommandAuth, CommandType, generateCommand } from '@/utils/contextSnippets'
import { getApiHost } from '@/utils/appConfig'
import { FaExclamationCircle } from 'react-icons/fa'

type Size = 'sm' | 'md' | 'lg'

interface SecretsOneLinerProps {
  organisationId: string
  appId: string
  appName: string
  env?: string
  path?: string
  placeholder?: string
  size?: Size
  label?: string
  type?: CommandType
  auth: CommandAuth | null
  setAuth: Dispatch<SetStateAction<CommandAuth | null>>
  requireSse?: boolean
}

const sizeClasses: Record<Size, string> = {
  sm: 'text-2xs',
  md: 'text-xs',
  lg: 'text-sm',
}

const StyledCommand = ({ command }: { command: string }) => {
  // Split the command into parts for highlighting
  const parts = command.split(' ')
  return (
    <span className="font-mono">
      <span className="text-neutral-500">$ </span>
      {parts.map((part, index) => {
        if (part.startsWith('PHASE_SERVICE_TOKEN=')) {
          return (
            <span key={index}>
              <span className="text-emerald-800 dark:text-emerald-300">PHASE_SERVICE_TOKEN</span>
              <span className="text-neutral-500">=</span>
              <span className="text-zinc-700 dark:text-zinc-300">{part.split('=')[1]}</span>
            </span>
          )
        }
        if (part === 'phase' || part === 'curl') {
          return (
            <span key={index} className="text-emerald-800 dark:text-emerald-300">
              {' '}
              {part}
            </span>
          )
        }
        if (part.startsWith('--')) {
          return (
            <span key={index} className="text-emerald-600 dark:text-emerald-400">
              {' '}
              {part}
            </span>
          )
        }
        return <span key={index}> {part}</span>
      })}
    </span>
  )
}

const SecretsOneLiner = ({
  organisationId,
  appId,
  appName,
  env = 'development',
  path = '',
  placeholder = 'phase secrets list',
  size = 'md',
  label,
  type = 'cli',
  auth,
  setAuth,
  requireSse,
}: SecretsOneLinerProps) => {
  const { keyring } = useContext(KeyringContext)
  const [createUserToken] = useMutation(CreateNewUserToken)

  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (copied) {
      const timeout = setTimeout(() => setCopied(false), 1000)
      return () => clearTimeout(timeout)
    }
  }, [copied])

  /**
   * Returns a valid pair of tokens and an expiry unix timestamp.
   * If valid tokens exist in the parent's state with more than 1 minute of validity, they are simply returned.
   * Otherwise, a new set of tokens is created, set in the parent state and then returned.
   *
   * @returns {<CommandAuth | undefined>}
   */
  const getOrCreateTokens = async (): Promise<CommandAuth | undefined> => {
    const expiryBufferMinutes = 1

    try {
      // If we have a valid token with more than 1 minute remaining, return it
      if (auth && getUnixTimeStampinFuture(0, 0, expiryBufferMinutes) < auth.expiry) {
        return auth
      }

      // Generate a new token
      if (!keyring) {
        toast.error('Keyring unavailable')
        return
      }

      const userKxKeys = {
        publicKey: await getUserKxPublicKey(keyring.publicKey),
        privateKey: await getUserKxPrivateKey(keyring.privateKey),
      }

      // Set expiry to 5 minutes from now
      const expiry = getUnixTimeStampinFuture(0, 0, 5)
      const tokenName = `one click temporary token for ${appName}:${env}`.slice(0, 64)

      const { pssUser, mutationPayload } = await generateUserToken(
        organisationId,
        userKxKeys,
        tokenName,
        expiry
      )

      await createUserToken({
        variables: mutationPayload,
      })

      const newApiToken = `User ${mutationPayload.token}`

      const newAuth = {
        cliToken: pssUser,
        apiToken: newApiToken,
        expiry,
      }

      setAuth(newAuth)

      return newAuth
    } catch (error) {
      console.error('Error generating token:', error)
      toast.error('Failed to generate token')
    }
  }

  /**
   * Generates a copy-able command by first getting a set of valid tokens, then generating the command based on:
   * - command type
   * - auth token
   * - appId
   * - env
   * - path
   *
   * The generated command is copied to the clipboard, and a toast is drawn indicating the remaining expiry on the auth
   */
  const generateAndCopyCommand = async () => {
    try {
      const tokens = await getOrCreateTokens()
      if (!tokens) {
        throw new Error('Failed to get or create tokens')
      }
      const { cliToken, apiToken, expiry } = tokens

      const authToken = type === 'cli' ? cliToken : apiToken
      const authExpiry = relativeTimeFromDates(new Date(expiry))

      const command = generateCommand(type, authToken, appId, env, path, authExpiry)

      await navigator.clipboard.writeText(command)
      setCopied(true)
      toast.info(`Copied command & token expires ${authExpiry}`, {
        autoClose: 5000,
      })
    } catch (error) {
      console.error('Error generating command:', error)
      toast.error('Failed to copy command')
    }
  }

  const displayPlaceholder = type === 'cli' ? placeholder : `curl -G ${getApiHost()}/v1/secrets`

  return (
    <div className="flex items-center gap-2 shrink-0 justify-between group">
      {label && (
        <span
          className={clsx(
            'text-neutral-500 group-hover:text-neutral-600 dark:group-hover:text-neutral-400 transition ease whitespace-nowrap font-semibold tracking-widest ml-2 flex items-center gap-2',
            sizeClasses[size]
          )}
        >
          {label}{' '}
          {requireSse && (
            <FaExclamationCircle
              className="text-amber-500"
              title="You must enable SSE to access secrets over the REST API"
            />
          )}
        </span>
      )}
      <Button
        variant="ghost"
        onClick={generateAndCopyCommand}
        title="Click to generate and copy command with a temporary token"
        classString={sizeClasses[size]}
      >
        <div className="relative flex items-center justify-center">
          <div
            aria-hidden={copied}
            className={clsx(
              'pointer-events-none transition duration-300',
              copied && '-translate-y-1.5 opacity-0'
            )}
          >
            <StyledCommand command={`${displayPlaceholder}`} />
          </div>
          <span
            aria-hidden={!copied}
            className={clsx(
              'pointer-events-none absolute inset-0 flex items-center justify-center text-emerald-400 transition duration-300',
              !copied && 'translate-y-1.5 opacity-0'
            )}
          >
            Copied!
          </span>
        </div>
      </Button>
    </div>
  )
}

export default SecretsOneLiner
