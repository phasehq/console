'use client'

import { useContext, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { organisationContext } from '@/contexts/organisationContext'
import { useUser } from '@/contexts/userContext'
import { userHasPermission } from '@/utils/access/permissions'
import { GetOrgSSOProviders } from '@/graphql/queries/sso/getOrgSSOProviders.gql'
import { UpdateOrgSSOProvider } from '@/graphql/mutations/sso/updateOrgSSOProvider.gql'
import { DeleteOrgSSOProvider } from '@/graphql/mutations/sso/deleteOrgSSOProvider.gql'
import { UpdateOrgSecurity } from '@/graphql/mutations/sso/updateOrgSecurity.gql'
import { Alert } from '@/components/common/Alert'
import { EmptyState } from '@/components/common/EmptyState'
import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { EntraIDSetup } from '@/components/access/sso/EntraIDSetup'
import { OktaSetup } from '@/components/access/sso/OktaSetup'
import { EntraIDLogo, OktaLogo } from '@/components/common/logos'
import CopyButton from '@/components/common/CopyButton'
import { toast } from 'react-toastify'
import { relativeTimeFromDates } from '@/utils/time'
import { Avatar } from '@/components/common/Avatar'
import { UpsellDialog } from '@/components/settings/organisation/UpsellDialog'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'
import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { FaBan, FaCheckCircle, FaShieldAlt, FaTrashAlt, FaPen, FaSignInAlt } from 'react-icons/fa'

const PROVIDER_INFO = {
  entra_id: {
    name: 'Microsoft Entra ID',
    description: 'OIDC authentication via Microsoft Entra ID (Azure AD)',
    icon: EntraIDLogo,
  },
  okta: {
    name: 'Okta',
    description: 'OIDC authentication via Okta',
    icon: OktaLogo,
  },
} as const

type ProviderType = keyof typeof PROVIDER_INFO

export default function OIDCPage({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { user } = useUser()

  const userCanReadSSO = organisation
    ? userHasPermission(organisation?.role?.permissions, 'SSO', 'read')
    : false

  const userCanManageSSO = organisation
    ? userHasPermission(organisation?.role?.permissions, 'SSO', 'create')
    : false

  const { data, refetch } = useQuery(GetOrgSSOProviders, {
    skip: !organisation || !userCanReadSSO,
  })

  // Find this org's data from the organisations list
  const orgData = data?.organisations?.find((o: any) => o.id === organisation?.id)
  const ssoProviders = orgData?.ssoProviders || []
  const requireSso = orgData?.requireSso || false
  const serverPublicKey = data?.serverPublicKey || ''

  const [setupProvider, setSetupProvider] = useState<ProviderType | null>(null)
  const [editingProvider, setEditingProvider] = useState<any>(null)

  const setupDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const deleteDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const enforceDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const disableDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const testSSODialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const [deletingProvider, setDeletingProvider] = useState<any>(null)
  const [testingProvider, setTestingProvider] = useState<any>(null)
  const [enforceAck, setEnforceAck] = useState(false)

  const [updateProvider] = useMutation(UpdateOrgSSOProvider)
  const [deleteProvider] = useMutation(DeleteOrgSSOProvider)
  const [updateSecurity] = useMutation(UpdateOrgSecurity)

  const handleSetup = (type: ProviderType) => {
    setSetupProvider(type)
    setEditingProvider(null)
    setupDialogRef.current?.openModal()
  }

  const handleEdit = (provider: any) => {
    const type = normalizeType(provider.providerType)
    setSetupProvider(type)
    // Parse publicConfig if it's a string so the dialog can read field values
    const parsed = {
      ...provider,
      publicConfig:
        typeof provider.publicConfig === 'string'
          ? JSON.parse(provider.publicConfig)
          : provider.publicConfig || {},
    }
    setEditingProvider(parsed)
    setupDialogRef.current?.openModal()
  }

  const handleSetupSuccess = () => {
    setupDialogRef.current?.closeModal()
    setSetupProvider(null)
    setEditingProvider(null)
    refetch()
  }

  const handleToggleEnabled = async (provider: any) => {
    try {
      await updateProvider({
        variables: {
          providerId: provider.id,
          enabled: !provider.enabled,
        },
      })
      toast.success(provider.enabled ? 'Provider deactivated' : 'Provider activated')
      refetch()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update provider')
    }
  }

  const handleDelete = async () => {
    if (!deletingProvider) return
    try {
      await deleteProvider({
        variables: { providerId: deletingProvider.id },
      })
      toast.success('SSO provider deleted')
      deleteDialogRef.current?.closeModal()
      setDeletingProvider(null)
      refetch()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete provider')
    }
  }

  const handleTestSSO = (provider: any) => {
    const callbackUrl = `/${params.team}/access/sso/oidc?sso_test=${provider.id}`
    window.location.href = `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/auth/sso/org/${provider.id}/authorize/?callbackUrl=${encodeURIComponent(callbackUrl)}`
  }

  const handleToggleEnforcement = async () => {
    try {
      const result = await updateSecurity({
        variables: {
          orgId: organisation?.id,
          requireSso: !requireSso,
        },
      })
      if (result.data?.updateOrganisationSecurity?.sessionInvalidated) {
        // Backend killed this admin's session because they enforced SSO
        // without being SSO-authenticated themselves. Skip the success
        // toast here (it would flash for 0ms before the redirect) and
        // carry the message on the /login page instead via ?sso_enforced.
        window.location.href = '/login?sso_enforced=true'
        return
      }
      toast.success(requireSso ? 'SSO enforcement disabled' : 'SSO enforcement enabled')
      refetch()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update SSO enforcement')
    }
  }

  const openEnforceDialog = () => {
    setEnforceAck(false)
    enforceDialogRef.current?.openModal()
  }

  // State 1: Plan gate (checked before permissions, so non-admin users
  const planAllowsSSO = organisation?.plan === ApiOrganisationPlanChoices.En

  if (organisation && !planAllowsSSO) {
    return (
      <div className="space-y-8 text-zinc-900 dark:text-zinc-100">
        <div>
          <h2 className="text-base font-medium">OIDC Providers</h2>
          <p className="text-neutral-500 text-sm">
            Configure OIDC single sign-on for your organisation.
          </p>
        </div>
        <EmptyState
          title="OIDC SSO is available on the Enterprise tier"
          subtitle="Upgrade your organisation to configure OIDC single sign-on with providers like Microsoft Entra ID and Okta."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaShieldAlt />
            </div>
          }
        >
          <div className="pt-2">
            <UpsellDialog
              title="Upgrade to Enterprise to configure SSO"
              buttonLabel={
                <span className="flex items-center gap-2">
                  Upgrade
                  <PlanLabel plan={ApiOrganisationPlanChoices.En} />
                </span>
              }
            />
          </div>
        </EmptyState>
      </div>
    )
  }

  // State 2: Access denied
  if (!userCanReadSSO) {
    return (
      <EmptyState
        title="Access restricted"
        subtitle="You don't have the permissions required to view SSO configuration."
        graphic={
          <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
            <FaBan />
          </div>
        }
      >
        <></>
      </EmptyState>
    )
  }

  // Normalize providerType from GraphQL (ENTRA_ID) to match our keys (entra_id)
  const normalizeType = (t: string) => t.toLowerCase() as ProviderType

  // Determine which provider types are already configured
  const configuredTypes = new Set(ssoProviders.map((p: any) => normalizeType(p.providerType)))
  const availableProviders = (Object.keys(PROVIDER_INFO) as ProviderType[]).filter(
    (type) => !configuredTypes.has(type)
  )
  const activeProvider = ssoProviders.find((p: any) => p.enabled)

  return (
    <div className="space-y-8 text-zinc-900 dark:text-zinc-100">
      <div>
        <h2 className="text-base font-medium">OIDC Providers</h2>
        <p className="text-neutral-500 text-sm">
          Configure OIDC single sign-on for your organisation.
        </p>
      </div>

      {/* Active provider + Enforce SSO */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500">Active Provider:</span>
          {activeProvider ? (
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <FaCheckCircle className="text-xs" />
              {activeProvider.name}
            </span>
          ) : (
            <span className="text-neutral-500 italic">None</span>
          )}
        </div>

        {userCanManageSSO && (
          <div className="flex flex-col items-end gap-1">
            <Button
              variant={requireSso ? 'danger' : 'primary'}
              disabled={!activeProvider && !requireSso}
              onClick={() => {
                if (requireSso) {
                  handleToggleEnforcement()
                } else {
                  openEnforceDialog()
                }
              }}
            >
              <FaShieldAlt className="text-xs" />
              <span className="text-xs">
                {requireSso ? 'Disable SSO Enforcement' : 'Enforce SSO'}
              </span>
            </Button>
            <span className="text-xs text-neutral-500">
              {requireSso
                ? 'SSO is required for all members'
                : 'Require all members to sign in via SSO'}
            </span>
          </div>
        )}
      </div>

      {/* Configured providers */}
      {ssoProviders.length > 0 && (
        <div className="space-y-4">
          {ssoProviders.map((provider: any) => {
            const info = PROVIDER_INFO[normalizeType(provider.providerType)]
            if (!info) return null
            const Icon = info.icon
            const parsedConfig =
              typeof provider.publicConfig === 'string'
                ? JSON.parse(provider.publicConfig)
                : provider.publicConfig || {}

            return (
              <div
                key={provider.id}
                className="group/card border border-neutral-500/20 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon className="w-8 h-8" />
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {provider.name}
                        {provider.enabled && (
                          <span className="text-2xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-medium">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-neutral-500 text-xs">{info.name}</div>
                    </div>
                  </div>

                  {userCanManageSSO && (
                    <div className="flex items-center gap-2 opacity-0 group-hover/card:opacity-100 transition ease">
                      <Button
                        variant={provider.enabled ? 'warning' : 'primary'}
                        onClick={() => {
                          if (provider.enabled) {
                            setDeletingProvider(provider)
                            disableDialogRef.current?.openModal()
                          } else {
                            handleToggleEnabled(provider)
                          }
                        }}
                      >
                        <span className="text-xs">
                          {provider.enabled ? 'Deactivate' : 'Activate'}
                        </span>
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setTestingProvider(provider)
                          testSSODialogRef.current?.openModal()
                        }}
                        title="Test SSO login flow"
                      >
                        <FaSignInAlt className="text-xs" />
                        <span className="text-xs">Test SSO</span>
                      </Button>
                      <Button variant="outline" onClick={() => handleEdit(provider)}>
                        <FaPen className="text-xs" />
                        <span className="text-xs">Edit</span>
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => {
                          setDeletingProvider(provider)
                          deleteDialogRef.current?.openModal()
                        }}
                      >
                        <FaTrashAlt className="text-xs" />
                        <span className="text-xs">Delete</span>
                      </Button>
                    </div>
                  )}
                </div>

                {/* Config details — copyable */}
                {Object.keys(parsedConfig).length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-neutral-500/10">
                    {Object.entries(parsedConfig).map(([key, value]) => (
                      <CopyButton
                        key={key}
                        value={value as string}
                        buttonVariant="ghost"
                        title={`Copy ${key.replace(/_/g, ' ')}`}
                      >
                        <span className="text-xs text-neutral-500">
                          {key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}:{' '}
                        </span>
                        <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300">
                          {value as string}
                        </span>
                      </CopyButton>
                    ))}
                  </div>
                )}

                {/* Audit trail */}
                <div className="flex items-center gap-4 text-xs text-neutral-500 pt-1">
                  {provider.createdBy && (
                    <div className="flex items-center gap-1">
                      <span>Added</span>
                      <span>{relativeTimeFromDates(new Date(provider.createdAt))}</span>
                      <span>by</span>
                      <Avatar member={provider.createdBy} size="sm" />
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {provider.createdBy.fullName}
                      </span>
                    </div>
                  )}
                  {provider.updatedBy && provider.updatedAt !== provider.createdAt && (
                    <div className="flex items-center gap-1">
                      <span>Updated</span>
                      <span>{relativeTimeFromDates(new Date(provider.updatedAt))}</span>
                      <span>by</span>
                      <Avatar member={provider.updatedBy} size="sm" />
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {provider.updatedBy.fullName}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Available providers (empty state / add more) */}
      {availableProviders.length > 0 && (
        <div className="space-y-3">
          {ssoProviders.length > 0 && (
            <h3 className="text-sm font-medium text-neutral-500">Add Provider</h3>
          )}
          {ssoProviders.length === 0 && availableProviders.length > 0 ? (
            <EmptyState
              title="No OIDC providers configured"
              subtitle="Configure an OIDC identity provider to enable SSO for your organisation."
              graphic={
                <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                  <FaShieldAlt />
                </div>
              }
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 w-full max-w-lg">
                {availableProviders.map((type) => {
                  const info = PROVIDER_INFO[type]
                  const Icon = info.icon
                  return (
                    <button
                      key={type}
                      onClick={() => handleSetup(type)}
                      disabled={!userCanManageSSO}
                      className="flex items-center gap-3 p-4 rounded-xl border border-neutral-500/20 hover:border-emerald-500/40 hover:bg-zinc-800/50 transition ease text-left disabled:opacity-50 disabled:pointer-events-none"
                    >
                      <Icon className="w-10 h-10 shrink-0" />
                      <div>
                        <div className="font-medium text-sm">{info.name}</div>
                        <div className="text-neutral-500 text-xs">{info.description}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </EmptyState>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {availableProviders.map((type) => {
                const info = PROVIDER_INFO[type]
                const Icon = info.icon
                return (
                  <button
                    key={type}
                    onClick={() => handleSetup(type)}
                    disabled={!userCanManageSSO}
                    className="flex items-center gap-3 p-4 rounded-xl border border-neutral-500/20 hover:border-emerald-500/40 hover:bg-zinc-800/50 transition ease text-left disabled:opacity-50 disabled:pointer-events-none"
                  >
                    <Icon className="w-10 h-10 shrink-0" />
                    <div>
                      <div className="font-medium text-sm">{info.name}</div>
                      <div className="text-neutral-500 text-xs">{info.description}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Setup Dialog */}
      <GenericDialog
        ref={setupDialogRef}
        title={
          editingProvider
            ? `Edit ${PROVIDER_INFO[setupProvider!]?.name || 'Provider'}`
            : `Configure ${PROVIDER_INFO[setupProvider!]?.name || 'Provider'}`
        }
        size="md"
      >
        {setupProvider === 'entra_id' && (
          <EntraIDSetup
            orgId={organisation?.id || ''}
            serverPublicKey={serverPublicKey}
            existingProvider={editingProvider}
            onSuccess={handleSetupSuccess}
            onCancel={() => setupDialogRef.current?.closeModal()}
          />
        )}
        {setupProvider === 'okta' && (
          <OktaSetup
            orgId={organisation?.id || ''}
            serverPublicKey={serverPublicKey}
            existingProvider={editingProvider}
            onSuccess={handleSetupSuccess}
            onCancel={() => setupDialogRef.current?.closeModal()}
          />
        )}
      </GenericDialog>

      {/* Delete Confirmation Dialog */}
      <GenericDialog ref={deleteDialogRef} title="Delete SSO Provider" size="sm">
        <div className="py-4 space-y-4">
          <p className="text-sm text-neutral-500">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {deletingProvider?.name}
            </span>
            ?
            {deletingProvider?.enabled && (
              <span className="text-amber-500 dark:text-amber-400">
                {' '}
                This provider is currently active. Members using SSO will need to use password
                login.
              </span>
            )}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => deleteDialogRef.current?.closeModal()}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </div>
      </GenericDialog>

      {/* Enforce SSO Confirmation Dialog */}
      <GenericDialog ref={enforceDialogRef} title="Enforce SSO" size="sm">
        <div className="py-4 space-y-4">
          <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
            <p>
              Once enforced, this takes effect <span className="font-semibold">immediately</span>:
            </p>
            <ul className="list-disc list-inside space-y-1 text-zinc-600 dark:text-zinc-400">
              <li>Password login will be disabled for all new and existing members.</li>
              <li>Sign-in via other SSO providers (Google, GitHub, etc.) will also be disabled.</li>
              <li>
                All members will be required to authenticate via{' '}
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {activeProvider?.name || 'your SSO provider'}
                </span>
                .
              </li>
              <li>Users are matched to their existing accounts by email address.</li>
            </ul>
          </div>

          <Alert variant="info" icon>
            <p className="text-sm">
              Before enforcing SSO, make sure you have tested the provider and signed in
              successfully at least once.
            </p>
          </Alert>

          <Alert variant="danger" icon>
            <label className="flex items-start gap-2 text-sm cursor-pointer leading-5">
              <input
                type="checkbox"
                checked={enforceAck}
                onChange={(e) => setEnforceAck(e.target.checked)}
                className="size-4 mt-0.5 shrink-0"
              />
              <span>
                I understand that enforcing SSO will end my current session. If I cannot sign back
                in via SSO, I will be locked out of this organisation.
              </span>
            </label>
          </Alert>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => enforceDialogRef.current?.closeModal()}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!enforceAck}
              onClick={() => {
                enforceDialogRef.current?.closeModal()
                handleToggleEnforcement()
              }}
            >
              Enforce SSO
            </Button>
          </div>
        </div>
      </GenericDialog>

      {/* Test SSO Confirmation Dialog */}
      <GenericDialog ref={testSSODialogRef} title="Test SSO" size="sm">
        <div className="pt-4 space-y-4">
          {testingProvider?.enabled ? (
            <>
              <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                <p>
                  You will be redirected to your identity provider to complete a test
                  authentication. Once complete, you will be sent back to Phase Console.
                </p>
                <Alert variant="warning" icon>
                  <p>
                    Make sure you sign in with{' '}
                    <strong className="text-zinc-900 dark:text-zinc-100">{user?.email}</strong> at
                    your identity provider. If you use a different email, a new account will be
                    created and you will be logged out of your current session.
                  </p>
                </Alert>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={() => testSSODialogRef.current?.closeModal()}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    testSSODialogRef.current?.closeModal()
                    if (testingProvider) handleTestSSO(testingProvider)
                  }}
                >
                  Continue
                </Button>
              </div>
            </>
          ) : (
            <>
              <Alert variant="info" icon>
                <p>You need to activate this provider before you can test it.</p>
              </Alert>
              <div className="flex justify-end pt-2">
                <Button variant="secondary" onClick={() => testSSODialogRef.current?.closeModal()}>
                  Close
                </Button>
              </div>
            </>
          )}
        </div>
      </GenericDialog>

      {/* Disable Provider Confirmation Dialog */}
      <GenericDialog ref={disableDialogRef} title="Deactivate SSO Provider" size="sm">
        <div className="py-4 space-y-4">
          <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
            <p>
              Are you sure you want to deactivate{' '}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {deletingProvider?.name}
              </span>
              ?
            </p>
            <ul className="list-disc list-inside space-y-1 text-zinc-600 dark:text-zinc-400">
              <li>
                Members who signed in via this provider will not be able to log in until another SSO
                provider is enabled or they reset their password.
              </li>
              {requireSso && (
                <li className="text-amber-500 dark:text-amber-400">
                  SSO enforcement is currently active — deactivating this provider will also turn
                  off enforcement, allowing password login.
                </li>
              )}
            </ul>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => disableDialogRef.current?.closeModal()}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                disableDialogRef.current?.closeModal()
                handleToggleEnabled(deletingProvider)
              }}
            >
              Deactivate
            </Button>
          </div>
        </div>
      </GenericDialog>
    </div>
  )
}
