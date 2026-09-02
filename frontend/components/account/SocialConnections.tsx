'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { IconType } from 'react-icons'
import { FaBuilding, FaCheckCircle, FaKey, FaLink, FaUnlink } from 'react-icons/fa'
import { GetAccountIdentities } from '@/graphql/queries/account/getAccountIdentities.gql'
import { UnlinkIdentityOp } from '@/graphql/mutations/account/unlinkIdentity.gql'
import { Button } from '../common/Button'
import Spinner from '../common/Spinner'
import GenericDialog from '../common/GenericDialog'
import {
  getProviderIdName,
  orgProviderIcons,
  providerButtons,
  providerIdIcons,
} from '../auth/providerMeta'
import { accountErrorMessage, isReauthError, requestReauthPrompt } from '@/utils/accountErrors'
import { relativeTimeFromDates } from '@/utils/time'
import { useUser } from '@/contexts/userContext'
import { useSsoProviders } from './SsoProvidersContext'
import {
  useReauthGuard,
  useReauthRestore,
  useReauthStateSync,
  useSessionFresh,
} from './useReauthState'

type LinkedIdentity = {
  id: string
  provider: string
  providerName: string
  uid: string
  email: string
  name: string
  avatarUrl: string | null
  createdAt: string | null
  lastUsedAt: string | null
  isLastMethod: boolean
  managedByOrg: boolean
  blockedReason: 'last_method' | 'org_enforced' | 'scim_managed' | null
  blockedOrgName: string | null
  organisationName: string | null
}

type AvailableInstanceProvider = {
  slug: string
  providerId: string
}

type AvailableOrgProvider = {
  id: string
  provider: string
  providerId: string
  providerName: string
  organisationName: string
}

// One card in the sign-in-methods list — either a linked identity (has
// `identity`) or an available-but-unlinked provider (has `linkKey`/`linkPath`).
type Method = {
  key: string
  displayName: string
  Icon: IconType | undefined
  identity?: LinkedIdentity
  linkKey?: string
  linkPath?: string
  password?: boolean
}

const blockedReasonCopy = (identity: LinkedIdentity): string => {
  switch (identity.blockedReason) {
    case 'last_method':
      return 'This is your only sign-in method'
    case 'org_enforced':
      return `Your organisation ${identity.blockedOrgName} requires this sign-in method`
    case 'scim_managed':
      return `Your organisation ${identity.blockedOrgName} manages this sign-in method`
    default:
      return ''
  }
}

const OrgBadge = ({ name }: { name: string }) => (
  <span className="shrink-0 flex items-center gap-1 text-2xs rounded-full px-1.5 py-0.5 ring-1 ring-inset ring-neutral-500/40 text-neutral-500">
    <FaBuilding className="shrink-0" />
    {name}
  </span>
)

const UnlinkDialog = ({
  identity,
  onUnlink,
  autoOpen,
}: {
  identity: LinkedIdentity
  onUnlink: (identity: LinkedIdentity) => Promise<boolean>
  // Post-reauth restore: reopen the confirm dialog for this identity.
  autoOpen?: boolean
}) => {
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)

  // If the fresh-session gate interrupts the unlink, reopen this dialog
  // after the re-login.
  useReauthStateSync(open, () => ({ action: 'unlink', identity: identity.id }))

  useEffect(() => {
    if (autoOpen) dialogRef.current?.openModal()
  }, [autoOpen])

  // Unlinking is reauth-gated — ask at open, not at confirm.
  const ensureFresh = useReauthGuard({ action: 'unlink', identity: identity.id })
  const handleOpenClick = () => {
    if (ensureFresh()) dialogRef.current?.openModal()
  }

  const handleConfirm = async () => {
    setPending(true)
    const success = await onUnlink(identity)
    setPending(false)
    if (success) dialogRef.current?.closeModal()
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={`Unlink ${identity.providerName}`}
      buttonVariant="danger"
      buttonContent="Unlink"
      buttonProps={{ icon: FaUnlink, onClick: handleOpenClick }}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      size="sm"
    >
      <div className="space-y-4 pt-2">
        <p className="text-sm text-zinc-900 dark:text-zinc-100">
          Are you sure? You will no longer be able to sign in to your account using this{' '}
          {identity.providerName} account:
        </p>
        <div className="flex items-center gap-3 rounded-md ring-1 ring-inset ring-neutral-500/20 bg-neutral-200/40 dark:bg-neutral-800/40 px-4 py-3">
          {(() => {
            const Icon = providerIdIcons[identity.provider]
            return Icon ? <Icon className="shrink-0 h-6 w-6" /> : null
          })()}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate ph-no-capture">
                {identity.name || identity.providerName}
              </span>
              {identity.organisationName && <OrgBadge name={identity.organisationName} />}
            </div>
            {(identity.email || identity.uid) && (
              <span className="text-xs text-neutral-500 truncate ph-no-capture">
                {identity.email || identity.uid}
              </span>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            variant="danger"
            icon={FaUnlink}
            onClick={handleConfirm}
            isLoading={pending}
            disabled={pending}
          >
            Unlink
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}

export default function SocialConnections() {
  // Which link button was clicked — the browser navigates away shortly
  // after, but the redirect isn't instant.
  const [linkingKey, setLinkingKey] = useState<string | null>(null)
  // Identity whose unlink dialog reopens after a reauth round trip.
  const [restoreUnlinkId, setRestoreUnlinkId] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const allowedSlugs = new Set(useSsoProviders())
  const { user } = useUser()

  const {
    data: queryData,
    loading,
    refetch,
  } = useQuery(GetAccountIdentities, {
    fetchPolicy: 'cache-and-network',
  })
  // The component owns the error toast (and the reauth redirect).
  const [unlinkIdentity] = useMutation(UnlinkIdentityOp, {
    context: { suppressGlobalErrorToast: true },
  })

  const data = queryData?.accountIdentities

  // Surface the outcome of a link round trip (?linked= / ?error=), then
  // clean the params so refreshes don't re-toast.
  useEffect(() => {
    const linked = searchParams?.get('linked')
    const error = searchParams?.get('error')
    if (!linked && !error) return
    if (linked) {
      toast.success(`${getProviderIdName(linked)} is now linked to your account.`)
    }
    if (error) {
      toast.error(accountErrorMessage(error), { autoClose: 8000 })
    }
    router.replace('/account')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const { isFresh } = useSessionFresh()

  const handleLink = (key: string, path: string) => {
    const authorizeUrl = `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}${path}?intent=link`
    // Stale session: the backend would bounce this navigation to /login
    // anyway — ask first so the user can back out. The prompt's Sign in
    // goes to the authorize URL; the backend owns the login redirect and
    // the post-login link resume.
    if (!isFresh() && requestReauthPrompt(authorizeUrl)) return
    setLinkingKey(key)
    window.location.href = authorizeUrl
  }

  const handleUnlink = async (identity: LinkedIdentity): Promise<boolean> => {
    try {
      await unlinkIdentity({ variables: { accountId: identity.id } })
      toast.success(`Unlinked ${identity.providerName}.`)
      await refetch()
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      // The errorLink redirects on the reauth gate; skip our toast.
      if (isReauthError(message)) return false
      // The mutation raises GraphQLError with a user-facing message for
      // last-method / org-managed guards.
      toast.error(message || 'Failed to unlink this sign-in method.', { autoClose: 8000 })
      return false
    }
  }

  const identities = (data?.identities ?? []) as LinkedIdentity[]
  const instanceProviders = (data?.availableInstanceProviders ?? []) as AvailableInstanceProvider[]
  const orgProviders = (data?.availableOrgProviders ?? []) as AvailableOrgProvider[]

  // Build one card per method, tracking which linked identities we've placed
  // so none is ever hidden (a linked identity for a provider that's no longer
  // offered still gets a card so it can be unlinked).
  const placedIdentityIds = new Set<string>()

  // Org groups: one card per org SSO provider (linked or linkable).
  const orgGroups: Record<string, Method[]> = {}
  for (const op of orgProviders) {
    const identity = identities.find(
      (i) => i.provider === op.providerId && i.organisationName === op.organisationName
    )
    if (identity) placedIdentityIds.add(identity.id)
    ;(orgGroups[op.organisationName] ??= []).push({
      key: identity ? identity.id : `org:${op.id}`,
      displayName: op.providerName,
      Icon: orgProviderIcons[op.provider],
      identity,
      linkKey: op.id,
      linkPath: `/auth/sso/org/${op.id}/authorize/`,
    })
  }

  // Instance methods: providers offered by the SSO_PROVIDERS env var (same
  // list the login page uses), linked or linkable.
  const orgProviderIds = new Set(orgProviders.map((p) => p.providerId))
  const instanceMethods: Method[] = []
  for (const ip of instanceProviders) {
    if (!allowedSlugs.has(ip.slug)) continue
    const identity = identities.find((i) => i.provider === ip.providerId && !i.organisationName)
    // Don't offer an instance link for a provider already linked through an
    // org — its org card covers it (org and instance share a provider_id).
    if (
      !identity &&
      orgProviderIds.has(ip.providerId) &&
      identities.some((i) => i.provider === ip.providerId)
    ) {
      continue
    }
    if (identity) placedIdentityIds.add(identity.id)
    const meta = providerButtons.find((b) => b.id === ip.slug)
    instanceMethods.push({
      key: identity ? identity.id : `inst:${ip.slug}`,
      displayName: identity?.providerName || meta?.name || ip.slug,
      Icon: providerIdIcons[ip.providerId] || meta?.icon,
      identity,
      linkKey: ip.slug,
      linkPath: `/auth/sso/${ip.slug}/authorize/`,
    })
  }

  // Any linked identity not placed above (its provider was removed from the
  // offered set) still gets a card so the user can see and unlink it.
  for (const identity of identities) {
    if (placedIdentityIds.has(identity.id)) continue
    placedIdentityIds.add(identity.id)
    instanceMethods.push({
      key: identity.id,
      displayName: identity.providerName,
      Icon: providerIdIcons[identity.provider],
      identity,
    })
  }

  // Email + password is a first-class sign-in method — list it as a card too.
  if (data?.hasUsablePassword) {
    instanceMethods.unshift({
      key: 'password',
      displayName: 'Password',
      Icon: FaKey,
      password: true,
    })
  }

  const orgGroupNames = Object.keys(orgGroups)
  const hasAnyMethod = orgGroupNames.length > 0 || instanceMethods.length > 0

  // Post-reauth restores — both wait for the identities query so the target
  // method exists in the lists built above.
  useReauthRestore('unlink', (params) => setRestoreUnlinkId(params.get('identity')), !!data)

  // A link attempt bounced by the backend's freshness check resumes here:
  // navigate to the same provider's authorize URL again, now with a fresh
  // session. The target must match a known, not-yet-linked method.
  useReauthRestore(
    'link',
    (params) => {
      const target = params.get('target')
      const allMethods = Object.values(orgGroups)
        .reduce((acc, group) => acc.concat(group), [] as Method[])
        .concat(instanceMethods)
      const method = allMethods.find((m) => m.linkKey === target && !m.identity)
      if (method) handleLink(method.linkKey!, method.linkPath!)
    },
    !!data
  )

  const renderMethod = (method: Method) => {
    const { Icon, displayName, identity, linkKey, linkPath, password } = method
    const active = password || identity != null
    const blocked = identity != null && identity.blockedReason !== null
    return (
      <div
        key={method.key}
        className="group flex items-center justify-between gap-4 rounded-md ring-1 ring-inset ring-neutral-500/20 bg-neutral-200/40 dark:bg-neutral-800/40 px-4 py-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          {Icon && <Icon className={`shrink-0 h-6 w-6 ${active ? '' : 'opacity-60'}`} />}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {displayName}
              </span>
              {active && (
                <span className="shrink-0 flex items-center gap-1 text-2xs text-emerald-500">
                  {/* A password isn't "linked" to anything — it's a
                      capability that is on. */}
                  {password ? (
                    <>
                      <FaCheckCircle className="shrink-0" /> Enabled
                    </>
                  ) : (
                    <>
                      <FaLink className="shrink-0" /> Linked
                    </>
                  )}
                </span>
              )}
            </div>
            {password ? (
              <span className="text-xs text-neutral-500 truncate ph-no-capture">{user?.email}</span>
            ) : identity ? (
              <>
                <span className="text-xs text-neutral-500 truncate ph-no-capture">
                  {identity.email || identity.name || identity.uid}
                </span>
                <span className="text-2xs text-neutral-500">
                  {identity.lastUsedAt
                    ? `Last used ${relativeTimeFromDates(new Date(identity.lastUsedAt))}`
                    : identity.createdAt
                      ? `Linked ${relativeTimeFromDates(new Date(identity.createdAt))}`
                      : ''}
                </span>
              </>
            ) : (
              <span className="text-xs text-neutral-500">Not linked</span>
            )}
          </div>
        </div>
        {/* Reveal on hover (or keyboard focus) — the resting card stays a
            clean listing. Password is managed elsewhere, so it has no action. */}
        <div className="shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {password ? null : identity ? (
            blocked ? (
              <Button
                variant="secondary"
                icon={FaUnlink}
                disabled
                title={blockedReasonCopy(identity)}
              >
                Unlink
              </Button>
            ) : (
              <UnlinkDialog
                identity={identity}
                onUnlink={handleUnlink}
                autoOpen={identity.id === restoreUnlinkId}
              />
            )
          ) : (
            <Button
              variant="outline"
              icon={FaLink}
              isLoading={linkingKey === linkKey}
              disabled={linkingKey !== null}
              onClick={() => handleLink(linkKey!, linkPath!)}
            >
              Link
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (loading)
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
    )

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-base sm:text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Sign-in methods
        </h2>
        <p className="text-sm text-neutral-500">
          Sign in to your account with any of these. Active methods show a badge. Hover a card to
          link or unlink it.
        </p>
      </div>

      <div className="space-y-4">
        {/* Org-level SSO methods first, grouped by organisation */}
        {orgGroupNames.map((orgName) => (
          <div key={orgName} className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
              <FaBuilding className="shrink-0" />
              {orgName}
            </h4>
            <div className="space-y-2">{orgGroups[orgName].map(renderMethod)}</div>
          </div>
        ))}

        {/* Instance-level methods */}
        {instanceMethods.length > 0 && (
          <div className="space-y-2">
            {orgGroupNames.length > 0 && (
              <h4 className="text-xs font-medium text-neutral-500">Other</h4>
            )}
            <div className="space-y-2">{instanceMethods.map(renderMethod)}</div>
          </div>
        )}

        {!hasAnyMethod && (
          <div className="text-sm text-neutral-500 py-2">
            No third-party sign-in methods are available on this instance.
          </div>
        )}
      </div>
    </section>
  )
}
