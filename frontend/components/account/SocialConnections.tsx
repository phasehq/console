'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaBuilding, FaLink, FaUnlink } from 'react-icons/fa'
import { GetAccountIdentities } from '@/graphql/queries/account/getAccountIdentities.gql'
import { UnlinkIdentityOp } from '@/graphql/mutations/account/unlinkIdentity.gql'
import { Button } from '../common/Button'
import { Alert } from '../common/Alert'
import Spinner from '../common/Spinner'
import GenericDialog from '../common/GenericDialog'
import {
  getProviderIdName,
  orgProviderIcons,
  providerButtons,
  providerIdIcons,
} from '../auth/providerMeta'
import { accountErrorMessage } from '@/utils/accountErrors'
import { relativeTimeFromDates } from '@/utils/time'

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

const redirectToReauth = () => {
  window.location.href = '/login?callbackUrl=%2Faccount&reauth=1'
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
}: {
  identity: LinkedIdentity
  onUnlink: (identity: LinkedIdentity) => Promise<boolean>
}) => {
  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const [pending, setPending] = useState(false)

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
      buttonProps={{ icon: FaUnlink }}
      size="sm"
    >
      <div className="space-y-4 pt-2">
        <p className="text-sm text-zinc-900 dark:text-zinc-100">
          Are you sure? You will no longer be able to sign in to your account using this{' '}
          {identity.providerName} account:
        </p>
        <div className="flex items-center gap-3 rounded-md ring-1 ring-inset ring-neutral-500/20 bg-neutral-200/40 dark:bg-neutral-800/40 p-3">
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
  const router = useRouter()
  const searchParams = useSearchParams()

  const { data: queryData, loading, refetch } = useQuery(GetAccountIdentities, {
    fetchPolicy: 'cache-and-network',
  })
  const [unlinkIdentity] = useMutation(UnlinkIdentityOp)

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

  const handleLink = (key: string, path: string) => {
    setLinkingKey(key)
    window.location.href = `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}${path}?intent=link`
  }

  const handleUnlink = async (identity: LinkedIdentity): Promise<boolean> => {
    try {
      await unlinkIdentity({ variables: { accountId: identity.id } })
      toast.success(`Unlinked ${identity.providerName}.`)
      await refetch()
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      // require_fresh_session_graphql raises GraphQLError("reauth_required").
      if (message.includes('reauth_required')) {
        redirectToReauth()
        return false
      }
      // The mutation raises GraphQLError with a user-facing message for
      // last-method / org-managed guards.
      toast.error(message || 'Failed to unlink this sign-in method.', { autoClose: 8000 })
      return false
    }
  }

  const identities = (data?.identities ?? []) as LinkedIdentity[]
  const instanceProviders = (data?.availableInstanceProviders ??
    []) as AvailableInstanceProvider[]
  const orgProviders = (data?.availableOrgProviders ?? []) as AvailableOrgProvider[]

  const isLinked = (providerId: string) => identities.some((i) => i.provider === providerId)

  // Org-level SSO methods are grouped under their organisation's name.
  const orgGroups = orgProviders.reduce<Record<string, AvailableOrgProvider[]>>((acc, p) => {
    ;(acc[p.organisationName] ??= []).push(p)
    return acc
  }, {})

  // Already-linked providers are inert "Connected" badges — re-linking is
  // a no-op round trip, so don't offer it.
  const renderInstanceButton = (provider: AvailableInstanceProvider) => {
    const meta = providerButtons.find((p) => p.id === provider.slug)
    const Icon = meta?.icon
    const label = meta?.name || provider.slug
    return isLinked(provider.providerId) ? (
      <Button
        key={provider.slug}
        variant="ghost"
        icon={Icon}
        disabled
        title="Already linked to your account"
      >
        {label}
        <span className="flex items-center gap-1 text-emerald-500">
          <FaLink className="shrink-0" /> Connected
        </span>
      </Button>
    ) : (
      <Button
        key={provider.slug}
        variant="outline"
        icon={Icon}
        isLoading={linkingKey === provider.slug}
        disabled={linkingKey !== null}
        onClick={() => handleLink(provider.slug, `/auth/sso/${provider.slug}/authorize/`)}
      >
        {label}
      </Button>
    )
  }

  const renderOrgButton = (provider: AvailableOrgProvider) => {
    const Icon = orgProviderIcons[provider.provider]
    // Org name lives in the group heading, so the button shows the
    // provider name alone.
    return isLinked(provider.providerId) ? (
      <Button
        key={provider.id}
        variant="ghost"
        icon={Icon}
        disabled
        title="Already linked to your account"
      >
        {provider.providerName}
        <span className="flex items-center gap-1 text-emerald-500">
          <FaLink className="shrink-0" /> Connected
        </span>
      </Button>
    ) : (
      <Button
        key={provider.id}
        variant="outline"
        icon={Icon}
        isLoading={linkingKey === provider.id}
        disabled={linkingKey !== null}
        onClick={() => handleLink(provider.id, `/auth/sso/org/${provider.id}/authorize/`)}
      >
        {provider.providerName}
      </Button>
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
          Identities linked to your account. You can sign in with any of these.
        </p>
      </div>

      {data?.hasUsablePassword && (
        <Alert variant="info" size="sm" icon>
          {identities.length > 0
            ? 'Your account also has a password that can be used to sign in.'
            : 'You sign in to your account with your email and password.'}
        </Alert>
      )}

      <div className="space-y-2">
        {identities.map((identity) => {
          const Icon = providerIdIcons[identity.provider]
          const blocked = identity.blockedReason !== null
          return (
            <div
              key={identity.id}
              className="group flex items-center justify-between gap-4 rounded-md ring-1 ring-inset ring-neutral-500/20 bg-neutral-200/40 dark:bg-neutral-800/40 p-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                {Icon && <Icon className="shrink-0 h-6 w-6" />}
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {identity.providerName}
                    </span>
                    {identity.organisationName && <OrgBadge name={identity.organisationName} />}
                  </div>
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
                </div>
              </div>
              {/* Reveal on hover (or keyboard focus) — the resting card
                  stays a clean identity listing */}
              <div className="shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                {blocked ? (
                  <Button
                    variant="secondary"
                    icon={FaUnlink}
                    disabled
                    title={blockedReasonCopy(identity)}
                  >
                    Unlink
                  </Button>
                ) : (
                  <UnlinkDialog identity={identity} onUnlink={handleUnlink} />
                )}
              </div>
            </div>
          )
        })}
        {identities.length === 0 && (
          <div className="text-sm text-neutral-500 py-2">
            No third-party sign-in methods are linked to your account.
          </div>
        )}
      </div>

      {(instanceProviders.length > 0 || orgProviders.length > 0) && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Link a sign-in method
            </h3>
            <p className="text-xs text-neutral-500">
              Link additional identities to sign in to this account with other providers.
            </p>
          </div>

          {/* Org-level SSO methods first, grouped by organisation */}
          {Object.entries(orgGroups).map(([orgName, providers]) => (
            <div key={orgName} className="space-y-2">
              <h4 className="text-xs font-medium text-neutral-500">{orgName}</h4>
              <div className="flex flex-wrap gap-2">{providers.map(renderOrgButton)}</div>
            </div>
          ))}

          {/* Instance-level methods */}
          {instanceProviders.length > 0 && (
            <div className="space-y-2">
              {orgProviders.length > 0 && (
                <h4 className="text-xs font-medium text-neutral-500">Other</h4>
              )}
              <div className="flex flex-wrap gap-2">
                {instanceProviders.map(renderInstanceButton)}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
