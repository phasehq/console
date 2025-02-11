'use client'

import { useContext, useState, useEffect } from 'react'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { KeyringContext } from '@/contexts/keyringContext'
import { CreateNewUserToken } from '@/graphql/mutations/users/createUserToken.gql'
import { getUserKxPublicKey, getUserKxPrivateKey, generateUserToken } from '@/utils/crypto'
import { getUnixTimeStampinFuture } from '@/utils/time'
import { Button } from './Button'
import clsx from 'clsx'

type Size = 'sm' | 'md' | 'lg'
type CommandType = 'cli' | 'api'

interface OneClickTemporaryTokenProps {
  organisationId: string
  appId?: string
  env?: string
  placeholder?: string
  size?: Size
  label?: string
  type?: CommandType
}

const sizeClasses: Record<Size, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
}

const StyledCommand: React.FC<{ command: string }> = ({ command }) => {
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

const OneClickTemporaryToken: React.FC<OneClickTemporaryTokenProps> = ({
  organisationId,
  appId,
  env = 'development',
  placeholder = 'phase secrets list',
  size = 'md',
  label,
  type = 'cli',
}) => {
  const { keyring } = useContext(KeyringContext)
  const [createUserToken] = useMutation(CreateNewUserToken)
  const [token, setToken] = useState<string | null>(null)
  const [apiToken, setApiToken] = useState<string | null>(null)
  const [tokenExpiry, setTokenExpiry] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (copied) {
      const timeout = setTimeout(() => setCopied(false), 1000)
      return () => clearTimeout(timeout)
    }
  }, [copied])

  useEffect(() => {
    if (tokenExpiry && Date.now() > tokenExpiry) {
      setToken(null)
      setApiToken(null)
      setTokenExpiry(null)
    }
  }, [tokenExpiry])

  const generateAndCopyToken = async () => {
    try {
      // If we have a valid token, just copy it
      if (token && apiToken && tokenExpiry && Date.now() < tokenExpiry) {
        const command =
          type === 'cli'
            ? [
                'PHASE_VERIFY_SSL=False',
                'PHASE_HOST=https://localhost',
                `PHASE_SERVICE_TOKEN=${token}`,
                'phase secrets list',
                `    --app-id ${appId}${env ? ` \\\n    --env ${env}` : ''}`,
              ].join(' \\\n')
            : [
                'curl \\',
                '    --request GET \\',
                `    --url 'https://localhost/service/public/v1/secrets/?app_id=${appId}&env=${env}' \\`,
                `    --header 'Authorization: Bearer ${apiToken}' \\`,
                '    -k \\',
                '    | jq .',
              ].join('\n')
        await navigator.clipboard.writeText(command)
        setCopied(true)
        return
      }

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

      const { pssUser, mutationPayload } = await generateUserToken(
        organisationId,
        userKxKeys,
        'one click temporary token',
        expiry
      )

      await createUserToken({
        variables: mutationPayload,
      })

      const newApiToken = `User ${mutationPayload.token}`
      setToken(pssUser)
      setApiToken(newApiToken)
      setTokenExpiry(expiry)

      const command =
        type === 'cli'
          ? [
              'PHASE_VERIFY_SSL=False',
              'PHASE_HOST=https://localhost',
              `PHASE_SERVICE_TOKEN=${pssUser}`,
              'phase secrets list',
              `    --app-id ${appId}${env ? ` \\\n    --env ${env}` : ''}`,
            ].join(' \\\n')
          : [
              'curl \\',
              '    --request GET \\',
              `    --url 'https://localhost/service/public/v1/secrets/?app_id=${appId}&env=${env}' \\`,
              `    --header 'Authorization: Bearer ${newApiToken}' \\`,
              '    -k \\',
              '    | jq .',
            ].join('\n')
      await navigator.clipboard.writeText(command)
      setCopied(true)
      toast.info('Generated temporary token (expires in 5 minutes)', { autoClose: 3000 })
    } catch (error) {
      console.error('Error generating token:', error)
      toast.error('Failed to generate token')
    }
  }

  const containerClasses = clsx(
    'flex items-center gap-2 shrink-0',
    label ? 'justify-end' : 'justify-end'
  )

  const displayPlaceholder =
    type === 'cli' ? placeholder : `curl -G https://api.phase.dev/v1/secrets | jq .`

  return (
    <div className={containerClasses}>
      {label && (
        <span className={clsx('text-neutral-500 whitespace-nowrap', sizeClasses[size])}>
          {label}
        </span>
      )}
      <Button
        variant="ghost"
        onClick={generateAndCopyToken}
        title="Click to generate and copy command with temporary token"
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

export default OneClickTemporaryToken
