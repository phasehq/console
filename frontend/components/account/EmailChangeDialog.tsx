'use client'

import { useContext, useRef, useState } from 'react'
import { useApolloClient, useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaArrowLeft, FaCheck, FaEnvelope, FaPen } from 'react-icons/fa'
import { OrganisationType } from '@/apollo/graphql'
import { useUser } from '@/contexts/userContext'
import { organisationContext } from '@/contexts/organisationContext'
import GetOrganisations from '@/graphql/queries/getOrganisations.gql'
import {
  decryptAccountKeyring,
  decryptAccountRecovery,
  deviceVaultKey,
  encryptAccountKeyring,
  encryptAccountRecovery,
  passwordAuthHash,
} from '@/utils/crypto'
import { getDeviceKey, setDeviceKey, setMemberDeviceKey } from '@/utils/localStorage'
import { isReauthError } from '@/utils/accountErrors'
import { useReauthGuard, useReauthRestore, useReauthStateSync } from './useReauthState'
import { Button } from '../common/Button'
import { Alert } from '../common/Alert'
import { Input } from '../common/Input'
import GenericDialog from '../common/GenericDialog'
import { RequestEmailChangeOp } from '@/graphql/mutations/account/requestEmailChange.gql'
import { ConfirmEmailChangeOp } from '@/graphql/mutations/account/confirmEmailChange.gql'

type DialogHandle = { openModal: () => void; closeModal: () => void }

const handleGqlError = (err: unknown, fallback: string) => {
  const message = err instanceof Error ? err.message : ''
  // The errorLink redirects on the reauth gate; signal the caller to stop.
  if (isReauthError(message)) return true
  toast.error(message || fallback, { autoClose: 6000 })
  return false
}

export default function EmailChangeDialog() {
  const { user, refetch } = useUser()
  const { organisations } = useContext(organisationContext)
  const apollo = useApolloClient()

  const dialogRef = useRef<DialogHandle>(null)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'request' | 'verify'>('request')
  const [newEmail, setNewEmail] = useState('')
  const [code, setCode] = useState('')
  // False on instances without SMTP (or SKIP_EMAIL_VERIFICATION) — same
  // convention as password signup: no code is sent or required.
  const [codeRequired, setCodeRequired] = useState(true)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // handleGqlError owns the toasts — suppress the global errorLink one.
  const [requestEmailChange] = useMutation(RequestEmailChangeOp, {
    context: { suppressGlobalErrorToast: true },
  })
  const [confirmEmailChange] = useMutation(ConfirmEmailChangeOp, {
    context: { suppressGlobalErrorToast: true },
  })

  // SCIM-managed users can't change their email — it's owned by the IdP.
  const scimManaged = (organisations ?? []).some((o) => o.memberScimManaged)

  const isPasswordUser = user?.authMethod === 'password'
  // Password proof is keyed on capability, not on how this session was
  // opened — a password account signed in via a linked SSO provider must
  // still rotate its login hash (the backend gates on has_usable_password).
  const hasLoginPassword = user?.hasUsablePassword ?? isPasswordUser

  const reset = () => {
    setOpen(false)
    setStep('request')
    setNewEmail('')
    setCode('')
    setCodeRequired(true)
    setPassword('')
    setLoading(false)
  }

  // If the fresh-session gate interrupts this flow, the redirect carries the
  // step and target address so the dialog reopens where the user left off.
  // The code and password are deliberately never captured — re-entered.
  useReauthStateSync(open, () => {
    const state: Record<string, string> = { action: 'email', step }
    const target = newEmail.trim()
    if (target) state.newEmail = target
    if (step === 'verify' && !codeRequired) state.codeRequired = '0'
    return state
  })

  useReauthRestore('email', (params) => {
    const restoredEmail = (params.get('newEmail') || '').toLowerCase().trim()
    setNewEmail(restoredEmail)
    // The verify step only makes sense with a pending address; the pending
    // change itself survives the re-login (session data is preserved).
    if (params.get('step') === 'verify' && restoredEmail) {
      setStep('verify')
      setCodeRequired(params.get('codeRequired') !== '0')
    }
    dialogRef.current?.openModal()
  })

  // The confirm step is reauth-gated — ask at open, not mid-flow.
  const ensureFresh = useReauthGuard({ action: 'email' })
  const handleOpenClick = () => {
    if (ensureFresh()) dialogRef.current?.openModal()
  }

  // Nothing to send until a different address is entered.
  const emailUnchanged =
    !newEmail.trim() || newEmail.trim().toLowerCase() === (user?.email ?? '').toLowerCase()

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    const target = newEmail.toLowerCase().trim()
    if (!target || target === (user?.email ?? '').toLowerCase()) return
    setLoading(true)
    try {
      const { data } = await requestEmailChange({ variables: { newEmail: target } })
      const verificationRequired = data?.requestEmailChange?.verificationRequired !== false
      setNewEmail(target)
      setCodeRequired(verificationRequired)
      setStep('verify')
      if (verificationRequired) {
        toast.success(`We sent a verification code to ${target}.`)
      }
    } catch (err) {
      handleGqlError(err, 'Failed to start the email change.')
    } finally {
      setLoading(false)
    }
  }

  const performCeremony = async () => {
    const oldEmail = user!.email
    // The device-key salt is the account-global email, so ONE new device
    // key re-wraps every org membership.
    const [oldDeviceKey, newDeviceKey] = await Promise.all([
      deviceVaultKey(password, oldEmail),
      deviceVaultKey(password, newEmail),
    ])

    // Re-wrap against a FRESH org list: a stale context could omit an org,
    // and the backend rejects an incomplete change. This avoids that.
    const { data } = await apollo.query({
      query: GetOrganisations,
      fetchPolicy: 'network-only',
    })
    const freshOrgs: OrganisationType[] = data?.organisations ?? []

    const keyrings: {
      orgId: string
      identityKey: string
      wrappedKeyring: string
      wrappedRecovery: string
    }[] = []

    for (const org of freshOrgs) {
      // Skip memberships with no established keyring (e.g. SCIM
      // pre-provisioned, not yet through key ceremony).
      if (!org.keyring || !org.identityKey) continue

      let keyring
      try {
        keyring = await decryptAccountKeyring(org.keyring, oldDeviceKey)
      } catch {
        throw new Error('Incorrect password.')
      }
      if (keyring.publicKey !== org.identityKey) {
        throw new Error('Keyring verification failed. Please try again.')
      }

      const wrappedKeyring = await encryptAccountKeyring(keyring, newDeviceKey)
      let wrappedRecovery = ''
      if (org.recovery) {
        const mnemonic = await decryptAccountRecovery(org.recovery, oldDeviceKey)
        wrappedRecovery = await encryptAccountRecovery(mnemonic, newDeviceKey)
      }
      keyrings.push({
        orgId: org.id,
        identityKey: org.identityKey,
        wrappedKeyring,
        wrappedRecovery,
      })
    }

    let currentAuthHash: string | undefined
    let newAuthHash: string | undefined
    if (hasLoginPassword) {
      ;[currentAuthHash, newAuthHash] = await Promise.all([
        passwordAuthHash(password, oldEmail),
        passwordAuthHash(password, newEmail),
      ])
    }

    await confirmEmailChange({
      variables: {
        code: codeRequired ? code.trim().toUpperCase() : null,
        newEmail,
        keyrings,
        currentAuthHash,
        newAuthHash,
      },
    })

    // Refresh the cached device keys with the new-email-salted key so
    // "remember this device" survives the change.
    if (isPasswordUser && user!.userId) {
      setDeviceKey(user!.userId, newDeviceKey)
    } else {
      for (const org of freshOrgs) {
        if (org.memberId) setMemberDeviceKey(org.memberId, newDeviceKey)
      }
      // A password-capable account in an SSO session may also hold a
      // userId-keyed entry from an earlier password session — refresh it
      // if present so the next password login doesn't hit a stale key.
      if (hasLoginPassword && user!.userId && getDeviceKey(user!.userId)) {
        setDeviceKey(user!.userId, newDeviceKey)
      }
    }
  }

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setLoading(true)
    // Yield so the spinner paints before the memory-hard Argon2id runs.
    await new Promise((r) => setTimeout(r, 50))
    try {
      await performCeremony()
      await refetch()
      // The ceremony's own network-only org query cached PRE-change data
      // (old email, old keyring wrappers) — clear the store so the org
      // context and member lists refetch post-change state.
      await apollo.resetStore().catch(() => {})
      toast.success('Your email address has been updated.')
      reset()
      dialogRef.current?.closeModal()
    } catch (err) {
      handleGqlError(err, 'Failed to change your email.')
    } finally {
      setLoading(false)
    }
  }

  // Inline affordance next to the email in the page header — the heavy
  // lifting (verification code, keyring re-wrap warnings) stays in the
  // dialog. SCIM-managed users can't change their email at all.
  if (scimManaged)
    return (
      <span
        className="text-neutral-500 shrink-0"
        title="Your email is managed by your organisation's identity provider"
      >
        <FaEnvelope className="text-xs" />
      </span>
    )

  return (
    <>
      <button
        type="button"
        onClick={handleOpenClick}
        title="Change email address"
        className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease shrink-0"
      >
        <FaPen className="text-xs" />
      </button>

      <GenericDialog
        ref={dialogRef}
        title="Change email address"
        size="md"
        onOpen={() => setOpen(true)}
        onClose={reset}
      >
        {step === 'request' ? (
          <form onSubmit={handleRequest} className="mt-4 space-y-6">
            <p className="text-sm text-neutral-500">
              Enter your new email address. We&apos;ll send a verification code to confirm you own
              it.
            </p>
            <Input
              id="new-email"
              label="New email address"
              type="email"
              value={newEmail}
              setValue={setNewEmail}
              required
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                icon={FaEnvelope}
                isLoading={loading}
                disabled={loading || emailUnchanged}
              >
                Send code
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleConfirm} className="mt-4 space-y-6">
            <p className="text-sm text-neutral-500">
              {codeRequired ? (
                <>
                  Enter the code sent to{' '}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{newEmail}</span>,
                  and your {hasLoginPassword ? 'password' : 'sudo password'} to re-encrypt your
                  keyrings.
                </>
              ) : (
                <>
                  Confirm changing your email to{' '}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{newEmail}</span>{' '}
                  by entering your {hasLoginPassword ? 'password' : 'sudo password'} to re-encrypt
                  your keyrings. Email verification is skipped because this instance has no email
                  gateway configured.
                </>
              )}
            </p>
            {(organisations?.length ?? 0) > 1 && (
              <Alert variant="info" size="sm" icon>
                This will re-encrypt your keyrings across all {organisations!.length} of your
                organisations.
              </Alert>
            )}
            <div className="space-y-4 max-w-md">
              {codeRequired && (
                <Input
                  id="verification-code"
                  label="Verification code"
                  value={code}
                  setValue={setCode}
                  required
                />
              )}
              <Input
                id="ceremony-password"
                label={hasLoginPassword ? 'Password' : 'Sudo password'}
                value={password}
                setValue={setPassword}
                secret
                required
                minLength={16}
              />
            </div>
            <div className="flex items-center justify-between">
              <Button
                variant="secondary"
                type="button"
                icon={FaArrowLeft}
                onClick={() => setStep('request')}
                disabled={loading}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon={FaCheck}
                isLoading={loading}
                disabled={loading}
              >
                Change email
              </Button>
            </div>
          </form>
        )}
      </GenericDialog>
    </>
  )
}
