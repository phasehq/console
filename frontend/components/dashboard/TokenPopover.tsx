'use client'

import { useQuery } from '@apollo/client'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { FormEvent, ReactElement, ReactNode, Ref, useEffect, useRef, useState } from 'react'
import { FaCheck, FaExclamationTriangle, FaKey } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { OrganisationType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'
import { GetServiceAccountTokenContext } from '@/graphql/queries/service-accounts/getServiceAccountTokenContext.gql'
import { useCreateServiceAccountToken } from '@/hooks/useCreateServiceAccountToken'
import { useCreateUserToken } from '@/hooks/useCreateUserToken'
import { userCanCreateServiceAccountTokens } from '@/utils/access/permissions'
import { copyToClipBoard } from '@/utils/clipboard'
import {
  defaultTokenName,
  ExpiryOptionT,
  humanReadableExpiry,
  tokenExpiryOptions,
} from '@/utils/tokens'

const DEFAULT_EXPIRY = tokenExpiryOptions.find((option) => option.name === '7 days')!

const KEY_BUTTON =
  'flex size-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-500/15 hover:text-zinc-900 data-[open]:bg-neutral-500/15 data-[open]:text-zinc-900 dark:hover:text-zinc-100 dark:data-[open]:text-zinc-100'

// Draws the eye to a first token
const KEY_BUTTON_PROMPT =
  'flex size-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/40 transition-colors hover:bg-emerald-500/20 data-[open]:bg-emerald-500/20 dark:text-emerald-400'

const CLI_INSTALL_DOCS = 'https://docs.phase.dev/cli/install'

type CreatedToken = { cliToken: string; apiToken: string }

type PanelControls = {
  close: () => void
  /** While locked, the panel stays open until `close` is called. */
  setLocked: (locked: boolean) => void
}

const TokenForm = (props: {
  title: string
  description?: ReactNode
  defaultName: string
  /** Shown instead of the form when the user can't create this token. */
  unavailable?: ReactNode
  /** Shown under the form. */
  footer?: ReactNode
  /** Shown with a new token in the CLI format. */
  cliUsage?: ReactNode
  ready: boolean
  onCreate: (name: string, expiry: number | null) => Promise<CreatedToken>
  controls: PanelControls
}) => {
  const {
    title,
    description,
    defaultName,
    unavailable,
    footer,
    cliUsage,
    ready,
    onCreate,
    controls,
  } = props
  const [name, setName] = useState(defaultName)
  const [expiry, setExpiry] = useState<ExpiryOptionT>(DEFAULT_EXPIRY)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [token, setToken] = useState<CreatedToken | null>(null)
  const [format, setFormat] = useState<'cli' | 'api'>('cli')
  const doneRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (token) doneRef.current?.focus()
  }, [token])

  // If the panel goes away mid-request anyway, don't touch state or the clipboard after that.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || pending) return
    setPending(true)
    setError('')
    controls.setLocked(true)
    try {
      const created = await onCreate(name.trim(), expiry.getExpiry())
      if (!mounted.current) {
        toast.info('A token was created but closed before it could be shown. You can revoke it.')
        return
      }
      setToken(created)
      const copied = await copyToClipBoard(created.cliToken)
      toast.success(
        copied
          ? 'Token created and copied to your clipboard'
          : "Token created. Copy it now, it won't be shown again."
      )
    } catch {
      controls.setLocked(false)
      if (mounted.current) setError("Couldn't create the token. Please try again.")
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  const value = token ? (format === 'cli' ? token.cliToken : token.apiToken) : ''

  return (
    <div className={clsx('space-y-3', token ? 'w-[min(26rem,calc(100vw-3rem))]' : 'w-72')}>
      <div>
        <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
        {description && <div className="text-2xs text-neutral-500">{description}</div>}
      </div>

      {token ? (
        <div className="space-y-2">
          <div className="flex rounded-full bg-zinc-200 p-0.5 dark:bg-zinc-900" role="group">
            {(
              [
                ['cli', 'CLI / SDK'],
                ['api', 'API'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={format === key}
                onClick={() => setFormat(key)}
                className={clsx(
                  'flex-1 rounded-full px-2 py-0.5 text-2xs font-semibold transition-colors',
                  format === key
                    ? 'bg-zinc-100 text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                    : 'text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative">
            <code className="ph-no-capture block max-h-32 overflow-y-auto break-all rounded-md bg-zinc-200 p-2 font-mono text-2xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
              {value}
            </code>
            <div className="absolute right-1.5 top-1.5 rounded-full bg-zinc-200 shadow-sm dark:bg-zinc-900">
              <CopyButton value={value} />
            </div>
          </div>
          {format === 'api' && (
            <div className="text-2xs text-neutral-500">
              Send it as a Bearer token. API tokens work with apps that use server-side encryption
              (SSE).
            </div>
          )}
          {format === 'cli' && cliUsage && (
            <div className="text-2xs text-neutral-500">{cliUsage}</div>
          )}
          <div className="flex items-center gap-1.5 text-2xs text-amber-700 dark:text-amber-400">
            <FaExclamationTriangle className="shrink-0" />
            Copy it now. You won&apos;t be able to see it again.
          </div>
          <div className="flex justify-end">
            <Button ref={doneRef} variant="secondary" icon={FaCheck} onClick={controls.close}>
              Done
            </Button>
          </div>
        </div>
      ) : unavailable ? (
        <div className="text-2xs text-neutral-500">{unavailable}</div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-2xs font-medium text-neutral-500">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              required
              className="w-full text-xs"
            />
          </label>
          <div className="space-y-1">
            <span className="text-2xs font-medium text-neutral-500">Expires</span>
            <div className="flex rounded-full bg-zinc-200 p-0.5 dark:bg-zinc-900" role="group">
              {tokenExpiryOptions.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  aria-pressed={option.name === expiry.name}
                  onClick={() => setExpiry(option)}
                  className={clsx(
                    'flex-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-2xs font-semibold transition-colors',
                    option.name === expiry.name
                      ? 'bg-zinc-100 text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                  )}
                >
                  {option.name.replace(' days', 'd')}
                </button>
              ))}
            </div>
            <div className="text-2xs text-neutral-500">{humanReadableExpiry(expiry)}</div>
          </div>
          {error && <div className="text-2xs text-red-600 dark:text-red-400">{error}</div>}
          <Button
            type="submit"
            variant="primary"
            disabled={!ready || pending || !name.trim()}
            isLoading={pending || !ready}
            classString="w-full justify-center"
            icon={FaKey}
          >
            Create token
          </Button>
          {footer && (
            <div className="border-t border-neutral-500/20 pt-2 text-2xs text-neutral-500">
              {footer}
            </div>
          )}
        </form>
      )}
    </div>
  )
}

const TokenPopover = (props: {
  trigger: ReactNode
  triggerClassName: string
  triggerLabel: string
  /** Lets another control open the panel. */
  triggerRef?: Ref<HTMLButtonElement>
  children: (controls: PanelControls) => ReactElement
}) => {
  // A token is shown once, so while one is being created or shown only Done closes the panel.
  const [locked, setLocked] = useState(false)

  return (
    <Popover className="flex">
      {({ open, close }) => (
        <>
          <PopoverButton
            ref={props.triggerRef}
            className={props.triggerClassName}
            title={props.triggerLabel}
            aria-label={props.triggerLabel}
          >
            {props.trigger}
          </PopoverButton>
          {(open || locked) && (
            <PopoverPanel
              static
              anchor={{ to: 'bottom end', gap: 6 }}
              className="z-20 rounded-lg bg-zinc-100 p-3 shadow-xl ring-1 ring-inset ring-neutral-500/20 dark:bg-zinc-800"
            >
              {props.children({
                close: () => {
                  setLocked(false)
                  close()
                },
                setLocked,
              })}
            </PopoverPanel>
          )}
        </>
      )}
    </Popover>
  )
}

const PersonalTokenForm = (props: {
  organisationId: string
  subject: string
  first?: boolean
  controls: PanelControls
}) => {
  const { organisationId, subject, controls } = props
  // Fixed while the panel is open, so creating the token doesn't swap the copy mid-flow
  const [first] = useState(!!props.first)
  const { createToken, keyringLocked } = useCreateUserToken(organisationId)

  return (
    <TokenForm
      title={first ? 'Create your first token' : 'New personal access token'}
      description={
        first
          ? 'Sign in to the Phase CLI and SDKs, or call the API, with the same access as your account.'
          : 'Has access to all apps and environments you can access.'
      }
      footer={
        first && (
          <>
            New to the CLI?{' '}
            <a
              href={CLI_INSTALL_DOCS}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-600 hover:underline dark:text-emerald-400"
            >
              Install it
            </a>
            , then sign in with this token.
          </>
        )
      }
      cliUsage={
        first && (
          <>
            Sign in with <code className="font-mono">phase auth --mode token</code>
          </>
        )
      }
      defaultName={defaultTokenName(subject)}
      ready={!keyringLocked}
      onCreate={createToken}
      controls={controls}
    />
  )
}

export const PersonalTokenButton = (props: {
  organisationId: string
  subject: string
  /** No token yet: highlight the button and introduce a first token. */
  prompt?: boolean
  triggerRef?: Ref<HTMLButtonElement>
}) => {
  const { prompt, triggerRef, ...form } = props

  return (
    <TokenPopover
      triggerLabel={
        prompt ? 'Create your first personal access token' : 'Create a personal access token'
      }
      triggerClassName={prompt ? KEY_BUTTON_PROMPT : KEY_BUTTON}
      triggerRef={triggerRef}
      trigger={<FaKey className="text-2xs" />}
    >
      {(controls) => <PersonalTokenForm {...form} first={prompt} controls={controls} />}
    </TokenPopover>
  )
}

const ServiceAccountTokenForm = (props: {
  organisation: OrganisationType
  account: { id: string; name: string }
  team: string
  controls: PanelControls
}) => {
  const { organisation, account, team, controls } = props
  const { data, error, loading } = useQuery(GetServiceAccountTokenContext, {
    variables: { orgId: organisation.id, id: account.id },
    fetchPolicy: 'network-only',
  })
  const context = data?.serviceAccounts?.[0]
  const { canUseClientSide, canUseServerSide, createToken } = useCreateServiceAccountToken(context)

  const permitted =
    !!context &&
    userCanCreateServiceAccountTokens(
      organisation.role?.permissions,
      context.team,
      organisation.memberId
    )

  const unavailable = error
    ? "Couldn't load this account."
    : !loading && !context
      ? "This account no longer exists or isn't visible to you."
      : context && !permitted
        ? "Your role can't create tokens for this account."
        : context && !canUseClientSide && !canUseServerSide
          ? "This account's keys haven't been shared with you, so you can't create its tokens."
          : undefined

  return (
    <TokenForm
      title={`New token for ${account.name}`}
      description={
        <>
          Manage existing tokens on the{' '}
          <Link
            href={`/${team}/access/service-accounts/${account.id}`}
            className="text-emerald-600 hover:underline dark:text-emerald-400"
          >
            account page
          </Link>
          .
        </>
      }
      defaultName={defaultTokenName(account.name)}
      unavailable={unavailable}
      ready={!!context}
      onCreate={createToken}
      controls={controls}
    />
  )
}

export const ServiceAccountTokenButton = (props: {
  organisation: OrganisationType
  account: { id: string; name: string }
  team: string
}) => (
  <TokenPopover
    triggerLabel={`Create a token for ${props.account.name}`}
    triggerClassName={KEY_BUTTON}
    trigger={<FaKey className="text-2xs" />}
  >
    {(controls) => <ServiceAccountTokenForm {...props} controls={controls} />}
  </TokenPopover>
)
