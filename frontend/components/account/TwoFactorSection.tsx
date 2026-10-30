'use client'

import { ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { QRCodeSVG } from 'qrcode.react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { coldarkCold, vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import {
  FaArrowRight,
  FaBan,
  FaCamera,
  FaCheck,
  FaCheckCircle,
  FaCopy,
  FaDownload,
  FaEye,
  FaEyeSlash,
  FaInfoCircle,
  FaPlus,
  FaRedo,
  FaSync,
  FaTrash,
} from 'react-icons/fa'
import { GoPasskeyFill } from 'react-icons/go'
import { TbPasswordMobilePhone, TbShieldLock } from 'react-icons/tb'
import { useUser } from '@/contexts/userContext'
import { ThemeContext } from '@/contexts/themeContext'
import { isReauthError } from '@/utils/accountErrors'
import {
  cancellable,
  createPasskey,
  credentialIdOf,
  forgetPasskey,
  notifyPasskeyFailure,
  passkeysSupported,
  rpIdOf,
} from '@/utils/passkeys'
import { useReauthGuard, useReauthRestore, useReauthStateSync } from './useReauthState'
import { FactorProofFields, FactorProofPayload, useFactorProof } from './FactorProof'
import {
  PASSKEY_KINDS,
  PasskeyKind,
  passkeyIcon,
  passkeyKindInfo,
  transportLabels,
} from './PasskeyKinds'
import { GetMfaStatus } from '@/graphql/queries/account/getMfaStatus.gql'
import { EnrollMfaOp } from '@/graphql/mutations/account/enrollMfa.gql'
import { ActivateMfaOp } from '@/graphql/mutations/account/activateMfa.gql'
import { DisableMfaOp } from '@/graphql/mutations/account/disableMfa.gql'
import { RegenerateRecoveryCodesOp } from '@/graphql/mutations/account/regenerateRecoveryCodes.gql'
import { BeginPasskeyRegistrationOp } from '@/graphql/mutations/account/beginPasskeyRegistration.gql'
import { InspectPasskeyRegistrationOp } from '@/graphql/mutations/account/inspectPasskeyRegistration.gql'
import { FinishPasskeyRegistrationOp } from '@/graphql/mutations/account/finishPasskeyRegistration.gql'
import { DeletePasskeyOp } from '@/graphql/mutations/account/deletePasskey.gql'
import { Button, ButtonProps, ButtonVariant } from '../common/Button'
import { Alert } from '../common/Alert'
import { Checkbox } from '../common/Checkbox'
import { Input } from '../common/Input'
import Spinner from '../common/Spinner'
import CopyButton from '../common/CopyButton'
import GenericDialog from '../common/GenericDialog'
import TotpCodeInput from '../auth/TotpCodeInput'
import { relativeTimeFromDates } from '@/utils/time'

type Passkey = {
  id: string
  name: string
  credentialId: string
  createdAt: string | null
  lastUsedAt: string | null
  synced: boolean
  kind: string
  aaguid: string | null
  authenticatorName: string | null
  transports: string[]
  backedUp: boolean
  prfEnabled: boolean
  signCount: number
  // JWK fields, serialized (a JSONString).
  publicKey: string | null
}

type MfaStatus = {
  enabled: boolean
  totpEnabled: boolean
  activatedAt: string | null
  recoveryCodesRemaining: number
  passkeys: Passkey[]
  passkeyRpId: string
}

type DialogHandle = { openModal: () => void; closeModal: () => void }

// Mirrors the backend limit (api/utils/passkeys.py).
const PASSKEY_NAME_MAX_LENGTH = 64

// The new credential itself was rejected: the ceremony has to start over.
const PASSKEY_REGISTRATION_FAILED = 'PASSKEY_REGISTRATION_FAILED'
// It's already someone's registered passkey: start over, but keep it.
const PASSKEY_ALREADY_REGISTERED = 'PASSKEY_ALREADY_REGISTERED'
// The new authenticator app's code was wrong (or expired).
const TOTP_CODE_INVALID = 'TOTP_CODE_INVALID'

const LAST_FACTOR_WARNING =
  'This is your only two-factor method. Removing it turns off two-factor authentication and deletes your recovery codes.'

const handleMfaError = (e: unknown, fallback: string) => {
  const message = e instanceof Error ? e.message : ''
  // The Apollo errorLink redirects on the reauth gate; skip our toast.
  if (isReauthError(message)) return
  toast.error(message || fallback, { autoClose: 5000 })
}

const graphQLErrorCode = (e: unknown): string | undefined =>
  (e as { graphQLErrors?: { extensions?: { code?: string } }[] })?.graphQLErrors?.[0]?.extensions
    ?.code

const relativeTime = (value: string | null) => (value ? relativeTimeFromDates(new Date(value)) : '')

export const recoveryCodesFileContent = (email: string, codes: string[]) =>
  [
    'Phase Console two-factor authentication (2FA) recovery codes',
    `Account: ${email}`,
    '',
    'These are 2FA recovery codes: each can be used once, in place of your',
    'authenticator app or a passkey, to finish signing in.',
    'Keep these somewhere safe.',
    '',
    ...codes,
    '',
  ].join('\n')

const RecoveryCodesPanel = ({
  codes,
  email,
  onInteracted,
}: {
  codes: string[]
  email: string
  // Fired on reveal/copy/download — lets the setup dialog refuse "Done"
  // until the user has plausibly saved (or at least seen) the codes.
  onInteracted?: () => void
}) => {
  const [revealed, setRevealed] = useState(false)

  const downloadCodes = () => {
    const blob = new Blob([recoveryCodesFileContent(email, codes)], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'phase-console-2fa-recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
    onInteracted?.()
  }

  return (
    <div className="space-y-4">
      <Alert variant="warning" size="sm" icon>
        These codes are shown only once. Each can be used a single time in place of your
        authenticator app or a passkey if you lose access to them.
      </Alert>
      <div className="grid grid-cols-2 gap-2 rounded-md bg-zinc-100 dark:bg-zinc-800 p-4 font-mono text-sm ph-no-capture">
        {codes.map((code, index) => (
          <div key={index} className="tracking-wider">
            {revealed ? code : '•••••-•••••'}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          icon={revealed ? FaEyeSlash : FaEye}
          onClick={() => {
            setRevealed(!revealed)
            onInteracted?.()
          }}
        >
          {revealed ? 'Hide' : 'Reveal'}
        </Button>
        {/* CopyButton doesn't expose an onClick — observe it in the
            capture phase instead of modifying the shared component */}
        <span onClickCapture={() => onInteracted?.()}>
          <CopyButton value={codes.join('\n')} title="Copy all codes">
            <span className="flex items-center gap-1.5 text-xs">
              <FaCopy className="shrink-0" /> Copy
            </span>
          </CopyButton>
        </span>
        <Button variant="outline" icon={FaDownload} onClick={downloadCodes}>
          Download
        </Button>
      </div>
    </div>
  )
}

// New recovery codes (a first factor's, or regenerated ones), behind a Done
// that unlocks only after the user reveals, copies or downloads them — a
// blind "Done" means lockout.
const SaveCodesStep = ({
  codes,
  email,
  onDone,
}: {
  codes: string[]
  email: string
  onDone: () => void
}) => {
  const [codesSaved, setCodesSaved] = useState(false)

  return (
    <div className="space-y-4">
      <RecoveryCodesPanel codes={codes} email={email} onInteracted={() => setCodesSaved(true)} />
      <div className="flex justify-end">
        <Button
          variant="primary"
          icon={FaCheck}
          onClick={onDone}
          disabled={!codesSaved}
          title={codesSaved ? undefined : 'Reveal, copy or download your recovery codes first'}
        >
          Done
        </Button>
      </div>
    </div>
  )
}

const TwoFactorSetupDialog = ({
  hasPasskeys,
  onComplete,
  reloadStatus,
}: {
  // TOTP is then an additional factor: activation needs proof of a passkey
  // (or a recovery code), and the existing recovery codes stay.
  hasPasskeys: boolean
  onComplete: () => void
  // Fresh status from the server, or null when it can't be reached.
  reloadStatus: () => Promise<MfaStatus | null>
}) => {
  const { user } = useUser()
  // handleMfaError owns the toasts — suppress the global errorLink one.
  const [enrollMfa] = useMutation(EnrollMfaOp, {
    context: { suppressGlobalErrorToast: true },
  })
  const [activateMfa] = useMutation(ActivateMfaOp, {
    context: { suppressGlobalErrorToast: true },
  })
  const dialogRef = useRef<DialogHandle>(null)
  const [open, setOpen] = useState(false)
  // qr → confirm (the new app's code) → verify (proof of an existing
  // factor, only when there is one) → codes (first factor only).
  const [step, setStep] = useState<'qr' | 'confirm' | 'verify' | 'codes' | 'codes-lost'>('qr')
  // Set synchronously: a double click can't activate twice.
  const submittingRef = useRef(false)
  const [secret, setSecret] = useState('')
  const [otpauthUri, setOtpauthUri] = useState('')
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  // canClose captures a stale `step`, so Done signals through a ref instead —
  // else a failed refetch leaves the codes step permanently unclosable.
  const doneRef = useRef(false)
  // Set by the post-reauth restore before opening, read by startEnrollment.
  const restoreConfirmRef = useRef(false)
  const proof = useFactorProof({
    active: open && step === 'verify' && hasPasskeys,
    totp: false,
    passkey: hasPasskeys,
  })

  const fetchEnrollment = async () => {
    try {
      const { data } = await enrollMfa()
      setSecret(data.enrollMfa.secret)
      setOtpauthUri(data.enrollMfa.otpauthUri)
    } catch (e) {
      handleMfaError(e, 'Failed to start two-factor setup.')
      dialogRef.current?.closeModal()
    }
  }

  const startEnrollment = async () => {
    doneRef.current = false
    setCode('')
    setRecoveryCodes([])
    setSecret('')
    setOtpauthUri('')
    proof.reset()
    // Post-reauth restore: the pending enrollment survived the re-login, so
    // resume at the confirm step — the user's authenticator already holds
    // the scanned secret. Going Back re-enrolls with a fresh QR.
    if (restoreConfirmRef.current) {
      restoreConfirmRef.current = false
      setStep('confirm')
      return
    }
    setStep('qr')
    await fetchEnrollment()
  }

  // If the fresh-session gate interrupts setup, reopen at the same step
  // after the re-login.
  useReauthStateSync(open, () => ({
    action: '2fa-setup',
    // The proof is never captured: resume at the code.
    step: step === 'confirm' || step === 'verify' ? 'confirm' : 'qr',
  }))

  useReauthRestore('2fa-setup', (params) => {
    restoreConfirmRef.current = params.get('step') === 'confirm'
    dialogRef.current?.openModal()
  })

  // Ask at click — enroll fires on open and would flash the dialog closed.
  const ensureFresh = useReauthGuard({ action: '2fa-setup', step: 'qr' })
  const handleEnableClick = () => {
    if (ensureFresh()) dialogRef.current?.openModal()
  }

  const handleDone = () => {
    doneRef.current = true
    dialogRef.current?.closeModal()
    onComplete()
  }

  const activate = async (existingFactor: FactorProofPayload) => {
    try {
      const { data } = await activateMfa({ variables: { code, ...existingFactor } })
      const codes: string[] | null = data.activateMfa.recoveryCodes
      if (codes) {
        setRecoveryCodes(codes)
        setStep('codes')
        toast.success('Two-factor authentication enabled.')
      } else {
        toast.success('Authenticator app added. Your existing recovery codes still work.')
        handleDone()
      }
    } catch (e) {
      if (!(e as { graphQLErrors?: unknown[] })?.graphQLErrors?.length) {
        // No answer: the app may have been turned on anyway.
        const latest = await reloadStatus()
        if (latest?.totpEnabled) {
          if (hasPasskeys) {
            toast.success('Authenticator app added. Your existing recovery codes still work.')
            handleDone()
          } else {
            // On, with recovery codes this browser never received.
            setStep('codes-lost')
          }
          return
        }
        toast.error("Couldn't reach Phase Console. Please try again.", { autoClose: 5000 })
        proof.retry()
        return
      }
      if (graphQLErrorCode(e) === TOTP_CODE_INVALID) {
        // Checked before the proof, which stays unspent: back to the code.
        toast.error(
          step === 'verify'
            ? "The authenticator app code didn't work. It may have expired: enter the current one."
            : 'Invalid code. Please try again.',
          { autoClose: 5000 }
        )
        setCode('')
        setStep('confirm')
      } else handleMfaError(e, 'Failed to add the authenticator app.')
      proof.retry()
    }
  }

  const handleCodeSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (submittingRef.current || pending || code.length !== 6) return
    // With a factor already on the account, proving it is the next step.
    if (hasPasskeys) {
      setStep('verify')
      return
    }
    submittingRef.current = true
    setPending(true)
    await activate({})
    setPending(false)
    submittingRef.current = false
  }

  const handleVerifySubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (submittingRef.current || pending || !proof.ready) return
    submittingRef.current = true
    setPending(true)
    const existingFactor = await proof.collect()
    if (existingFactor) await activate(existingFactor)
    setPending(false)
    submittingRef.current = false
  }

  return (
    <>
      {/* External trigger (instead of GenericDialog's) so the freshness
          pre-check runs before the dialog opens. */}
      <Button
        variant="primary"
        icon={TbPasswordMobilePhone}
        title="Set up an authenticator app"
        onClick={handleEnableClick}
      >
        Enable
      </Button>
      <GenericDialog
        ref={dialogRef}
        title="Set up an authenticator app"
        onOpen={() => {
          setOpen(true)
          startEnrollment()
        }}
        onClose={() => {
          proof.cancel()
          setOpen(false)
        }}
        canClose={() => step !== 'codes' || doneRef.current}
        size="md"
      >
        <div className="pt-4">
          {step === 'qr' && (
            <div className="space-y-4">
              <p className="text-sm text-neutral-500">
                Scan this QR code with your authenticator app, or enter the secret manually.
              </p>
              {otpauthUri ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2 text-sm text-neutral-500">
                    <FaCamera className="shrink-0" /> Scan:
                  </div>
                  {/* The QR encodes the secret — keep it out of session
                    recordings too */}
                  <div className="bg-white p-3 rounded-md ph-no-capture">
                    <QRCodeSVG value={otpauthUri} size={180} />
                  </div>
                  <div className="text-sm text-neutral-500 pt-2">Or copy and paste the secret:</div>
                  <div className="flex items-center gap-2 w-full max-w-md rounded-lg bg-zinc-300/50 dark:bg-zinc-800/50 shadow-inner py-1 pl-3 pr-1">
                    <code className="flex-1 font-mono text-xs tracking-widest break-all text-emerald-500 ph-no-capture">
                      {secret}
                    </code>
                    <div className="shrink-0">
                      <CopyButton value={secret} buttonVariant="ghost" title="Copy secret" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex justify-center py-8">
                  <Spinner size="md" />
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  icon={FaArrowRight}
                  iconPosition="right"
                  onClick={() => setStep('confirm')}
                  disabled={!otpauthUri}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          {step === 'confirm' && (
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              <p className="text-sm text-neutral-500">
                Enter the 6-digit code from your authenticator app to confirm setup.
              </p>
              <TotpCodeInput value={code} onChange={setCode} autoFocus />
              <div className="flex justify-between">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    setStep('qr')
                    // After a confirm-step restore there is no QR client-side —
                    // enroll again (fresh secret) to show one.
                    if (!otpauthUri) fetchEnrollment()
                  }}
                >
                  Back
                </Button>
                {hasPasskeys ? (
                  <Button
                    variant="primary"
                    icon={FaArrowRight}
                    iconPosition="right"
                    type="submit"
                    disabled={code.length !== 6}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    icon={TbPasswordMobilePhone}
                    type="submit"
                    isLoading={pending}
                    disabled={pending || code.length !== 6}
                  >
                    Verify and enable
                  </Button>
                )}
              </div>
            </form>
          )}

          {step === 'verify' && (
            <form onSubmit={handleVerifySubmit} className="space-y-4">
              <p className="text-sm text-neutral-500">
                Confirm it&apos;s you with one of your existing two-factor methods to finish adding
                the authenticator app.
              </p>
              <FactorProofFields proof={proof} />
              <div className="flex justify-between">
                <Button
                  variant="secondary"
                  type="button"
                  disabled={pending}
                  onClick={() => setStep('confirm')}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  icon={TbPasswordMobilePhone}
                  type="submit"
                  isLoading={pending}
                  disabled={pending || !proof.ready}
                >
                  Enable
                </Button>
              </div>
            </form>
          )}

          {step === 'codes' && (
            <SaveCodesStep codes={recoveryCodes} email={user?.email || ''} onDone={handleDone} />
          )}

          {step === 'codes-lost' && (
            <div className="space-y-4">
              <Alert variant="warning" size="sm" icon>
                Your authenticator app was added and two-factor authentication is on, but your
                recovery codes didn&apos;t reach this browser. Regenerate them now from Recovery
                codes (you&apos;ll confirm with your authenticator app) so you have a way back in if
                you lose it.
              </Alert>
              <div className="flex justify-end">
                <Button variant="primary" icon={FaCheck} onClick={handleDone}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </GenericDialog>
    </>
  )
}

/**
 * A 2FA change confirmed with proof of a current factor: disabling TOTP,
 * removing a passkey, regenerating recovery codes.
 */
const FactorProofDialog = ({
  title,
  buttonContent,
  buttonIcon,
  reauth,
  methods,
  description,
  warning,
  submitLabel,
  submitVariant = 'primary',
  submitIcon,
  email,
  onConfirm,
}: {
  title: string
  buttonContent: ReactNode
  buttonIcon: ButtonProps['icon']
  // Restorable state for the reauth round trip; `action` names the flow.
  reauth: Record<string, string>
  methods: { totp: boolean; passkey: boolean }
  description: ReactNode
  warning?: ReactNode
  submitLabel: string
  submitVariant?: ButtonVariant
  submitIcon: ButtonProps['icon']
  email: string
  // false on failure (already toasted), true when done, or new recovery
  // codes to show once.
  onConfirm: (proof: FactorProofPayload) => Promise<boolean | string[]>
}) => {
  const dialogRef = useRef<DialogHandle>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [newCodes, setNewCodes] = useState<string[]>([])
  // New codes are showing (the old ones no longer work): only Done closes.
  // A ref, as canClose can capture a stale render.
  const codesShownRef = useRef(false)
  const proof = useFactorProof({ active: open && newCodes.length === 0, ...methods })

  // The proof itself is never captured — re-entered after the re-login.
  useReauthStateSync(open, () => reauth)
  useReauthRestore(reauth.action, (params) => {
    if (Object.entries(reauth).every(([key, value]) => params.get(key) === value))
      dialogRef.current?.openModal()
  })
  const ensureFresh = useReauthGuard(reauth)
  const handleOpenClick = () => {
    if (ensureFresh()) dialogRef.current?.openModal()
  }

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (pending || !proof.ready) return
    setPending(true)
    const payload = await proof.collect()
    const result = payload ? await onConfirm(payload) : null
    setPending(false)
    if (result === false) proof.retry()
    else if (Array.isArray(result)) {
      codesShownRef.current = true
      setNewCodes(result)
    } else if (result) dialogRef.current?.closeModal()
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={title}
      buttonVariant="outline"
      buttonContent={buttonContent}
      buttonProps={{ icon: buttonIcon, onClick: handleOpenClick }}
      onOpen={() => {
        codesShownRef.current = false
        setNewCodes([])
        setPending(false)
        proof.reset()
        setOpen(true)
      }}
      onClose={() => {
        proof.cancel()
        setOpen(false)
      }}
      canClose={() => !codesShownRef.current}
      size="md"
    >
      {newCodes.length > 0 ? (
        <div className="pt-4">
          <SaveCodesStep
            codes={newCodes}
            email={email}
            onDone={() => {
              codesShownRef.current = false
              dialogRef.current?.closeModal()
            }}
          />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <p className="text-sm text-neutral-500">{description}</p>
          {warning && (
            <Alert variant="warning" size="sm" icon>
              {warning}
            </Alert>
          )}
          <FactorProofFields proof={proof} />
          <div className="flex justify-end">
            <Button
              variant={submitVariant}
              icon={submitIcon}
              type="submit"
              isLoading={pending}
              disabled={pending || !proof.ready}
            >
              {submitLabel}
            </Button>
          </div>
        </form>
      )}
    </GenericDialog>
  )
}

// A credential the browser created that the server may not hold. `state`
// says what we know: "created" — never stored (finish not sent, or
// rejected before storing); "unconfirmed" — the finish response was lost.
type CreatedPasskey = { id: string | null; rpId: string | null; state: 'created' | 'unconfirmed' }

// A new passkey the server verified but hasn't stored, for the user to review.
type PasskeyCandidate = {
  suggestedName: string
  kind: string
  authenticatorName: string | null
  transports: string[]
  prfEnabled: boolean
}

const PASSKEY_OPTIONS: { kind: PasskeyKind; title: string; examples: string }[] = [
  {
    kind: 'security_key',
    title: 'Hardware security key',
    examples: 'YubiKey, Google Titan, Feitian or another FIDO2 key',
  },
  {
    kind: 'synced',
    title: 'Password manager',
    examples: 'Bitwarden, 1Password, iCloud Keychain or Google Password Manager',
  },
  {
    kind: 'device',
    title: "This device's screen lock",
    examples: 'Touch ID, Face ID, Windows Hello or your device PIN',
  },
]

const KIND_HINTS: Record<PasskeyKind, string> = {
  synced: 'Saved in a password manager or keychain, and available on your devices it syncs to.',
  security_key: 'Stored on the key itself: keep it with you to sign in.',
  device: 'Stored on this device only: you will need it to sign in.',
}

const metadataChip =
  'rounded-full bg-zinc-200 dark:bg-zinc-700/60 px-2 py-0.5 text-2xs font-medium text-zinc-700 dark:text-zinc-300'

const PasskeyCandidateSummary = ({ candidate }: { candidate: PasskeyCandidate }) => {
  const { label } = passkeyKindInfo(candidate.kind)
  const Icon = passkeyIcon(candidate.kind, candidate.authenticatorName)
  const hint = KIND_HINTS[candidate.kind as PasskeyKind]
  return (
    <div className="flex items-start gap-3 rounded-md bg-zinc-100 dark:bg-zinc-800 p-3">
      <div className="flex shrink-0 items-center justify-center size-10 rounded-md bg-white dark:bg-zinc-900 ring-1 ring-inset ring-neutral-500/20">
        <Icon className="size-6 text-zinc-900 dark:text-zinc-100" />
      </div>
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {candidate.authenticatorName ?? label}
        </div>
        {candidate.authenticatorName && <div className="text-xs text-neutral-500">{label}</div>}
        {hint && <div className="text-xs text-neutral-500">{hint}</div>}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {transportLabels(candidate.transports).map((transport) => (
            <span key={transport} className={metadataChip}>
              {transport}
            </span>
          ))}
          {candidate.prfEnabled && (
            <span
              className={metadataChip}
              title="Supports the WebAuthn PRF extension: it can derive encryption keys"
            >
              PRF
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

const AddPasskeyDialog = ({
  status,
  email,
  supported,
  onComplete,
  reloadStatus,
}: {
  status: MfaStatus
  email: string
  supported: boolean
  onComplete: () => void
  // Fresh status from the server, or null when it can't be reached.
  reloadStatus: () => Promise<MfaStatus | null>
}) => {
  const [beginRegistration] = useMutation(BeginPasskeyRegistrationOp, {
    context: { suppressGlobalErrorToast: true },
  })
  const [inspectRegistration] = useMutation(InspectPasskeyRegistrationOp, {
    context: { suppressGlobalErrorToast: true },
  })
  const [finishRegistration] = useMutation(FinishPasskeyRegistrationOp, {
    context: { suppressGlobalErrorToast: true },
  })
  const dialogRef = useRef<DialogHandle>(null)
  const [open, setOpen] = useState(false)
  // intro → (browser prompt) → review → confirm (proof, when 2FA is on) →
  // codes (first factor only).
  const [step, setStep] = useState<
    'intro' | 'review' | 'confirm' | 'codes' | 'codes-lost' | 'unconfirmed'
  >('intro')
  const [name, setName] = useState('')
  const [candidate, setCandidate] = useState<PasskeyCandidate | null>(null)
  const [mine, setMine] = useState(false)
  // Creation options, fetched up front so the click goes straight to the
  // browser prompt (Safari requires a user gesture for it).
  const [options, setOptions] = useState<unknown>(null)
  const [credential, setCredential] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const doneRef = useRef(false)
  // The finish request is in flight: its outcome decides whether the
  // credential is kept, so the dialog stays open until it settles.
  const finishingRef = useRef(false)
  // Set synchronously: a double click can't start a second finish before
  // `pending` re-renders.
  const submittingRef = useRef(false)
  // Cancels the open create prompt (browser or password manager): closing
  // the dialog settles it at once rather than waiting on it.
  const cancelPromptRef = useRef<(() => void) | null>(null)
  // Bumped on every open, so a prompt from an earlier opening can't act on
  // this one.
  const openingRef = useRef(0)
  const closedRef = useRef(false)
  const createdRef = useRef<CreatedPasskey | null>(null)
  // Whether this passkey is the account's first factor (codes come with it).
  const firstFactorRef = useRef(false)
  const proof = useFactorProof({
    active: open && step === 'confirm',
    totp: status.totpEnabled,
    passkey: status.passkeys.length > 0,
  })

  const fetchOptions = async () => {
    setOptions(null)
    try {
      const { data } = await beginRegistration()
      setOptions(data.beginPasskeyRegistration.options)
    } catch (e) {
      handleMfaError(e, 'Failed to start passkey setup.')
      dialogRef.current?.closeModal()
    }
  }

  useReauthStateSync(open, () => ({ action: 'passkey-add' }))
  useReauthRestore('passkey-add', () => dialogRef.current?.openModal())
  const ensureFresh = useReauthGuard({ action: 'passkey-add' })
  const handleAddClick = () => {
    if (ensureFresh()) dialogRef.current?.openModal()
  }

  const handleDone = () => {
    doneRef.current = true
    dialogRef.current?.closeModal()
    onComplete()
  }

  // The browser made a credential the server never stored: ask the
  // provider to drop it so it isn't offered at sign-in, and start over.
  const discardCreated = () => {
    const created = createdRef.current
    createdRef.current = null
    if (created?.state === 'created') forgetPasskey(created.rpId, created.id)
  }

  const restart = () => {
    discardCreated()
    setCredential(null)
    setCandidate(null)
    setMine(false)
    setStep('intro')
    fetchOptions()
  }

  const registered = (codes: string[] | null) => {
    createdRef.current = null
    if (codes) {
      toast.success('Passkey added.')
      setRecoveryCodes(codes)
      setStep('codes')
    } else if (firstFactorRef.current) {
      // Stored, but the codes issued with it never arrived.
      setStep('codes-lost')
    } else {
      toast.success('Passkey added.')
      handleDone()
    }
  }

  // After a lost response: is the passkey on the account?
  // After a lost response: is the passkey on the account? Not listed may
  // just mean not committed yet, so it's never forgotten here: an unused
  // passkey left in the provider is harmless (sign-in only offers stored
  // ones), a forgotten stored one locks its owner out.
  const reconcile = async () => {
    const created = createdRef.current
    const opening = openingRef.current
    const latest = await reloadStatus()
    if (!created || closedRef.current || opening !== openingRef.current) return
    if (latest?.passkeys.some((p) => p.credentialId === created.id)) {
      registered(null)
    } else {
      createdRef.current = { ...created, state: 'unconfirmed' }
      setStep('unconfirmed')
    }
  }

  const finish = async (created: string, existingFactor: FactorProofPayload) => {
    finishingRef.current = true
    try {
      const { data } = await finishRegistration({
        variables: { name: name.trim(), credential: created, ...existingFactor },
      })
      registered(data.finishPasskeyRegistration.recoveryCodes)
      return true
    } catch (e) {
      const code = graphQLErrorCode(e)
      if (!code && !(e as { graphQLErrors?: unknown[] })?.graphQLErrors?.length) {
        // No answer: the passkey may or may not have been stored.
        await reconcile()
        return false
      }
      handleMfaError(e, 'Failed to add the passkey.')
      if (code === PASSKEY_ALREADY_REGISTERED) {
        // A live passkey: never ask the provider to forget it.
        createdRef.current = null
        restart()
      } else if (code === PASSKEY_REGISTRATION_FAILED) {
        restart()
      }
      // Otherwise (a rejected proof): nothing stored; retry with this one.
      return false
    } finally {
      finishingRef.current = false
    }
  }

  // Have the server check the new passkey and describe it for review.
  // Nothing is stored yet.
  const inspect = async (created: string, opening: number) => {
    try {
      const { data } = await inspectRegistration({ variables: { credential: created } })
      if (closedRef.current || opening !== openingRef.current) return
      const found: PasskeyCandidate = data.inspectPasskeyRegistration.passkey
      setCandidate(found)
      setName(found.suggestedName)
      setMine(false)
      setCredential(created)
      setStep('review')
    } catch (e) {
      // Closing already discarded it.
      if (closedRef.current || opening !== openingRef.current) return
      // A live passkey: never ask the provider to forget it.
      if (graphQLErrorCode(e) === PASSKEY_ALREADY_REGISTERED) createdRef.current = null
      if ((e as { graphQLErrors?: unknown[] })?.graphQLErrors?.length)
        handleMfaError(e, 'The passkey could not be verified. Please try again.')
      else
        toast.error("Couldn't reach Phase Console to check the passkey. Please try again.", {
          autoClose: 5000,
        })
      restart()
    }
  }

  const handleCreate = async () => {
    if (pending || !options) return
    setPending(true)
    const opening = openingRef.current
    const prompt = cancellable(() => createPasskey(options))
    cancelPromptRef.current = prompt.cancel
    let created: string | null
    try {
      created = await prompt.result
    } catch (e) {
      // Nothing was created; the same options serve a retry.
      if (!closedRef.current && opening === openingRef.current)
        notifyPasskeyFailure(e, 'Could not create the passkey. Please try again.')
      setPending(false)
      return
    } finally {
      cancelPromptRef.current = null
    }
    if (created === null || closedRef.current || opening !== openingRef.current) {
      // Closed mid-prompt. If the browser made one anyway, nobody wants it.
      if (created) forgetPasskey(rpIdOf(options), credentialIdOf(created))
      setPending(false)
      return
    }
    createdRef.current = { id: credentialIdOf(created), rpId: rpIdOf(options), state: 'created' }
    await inspect(created, opening)
    setPending(false)
  }

  const handleReview = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (submittingRef.current || pending || !credential || !mine || !name.trim()) return
    const taken = status.passkeys.some(
      (p) => p.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase()
    )
    if (taken) {
      toast.error('You already have a passkey with this name.', { autoClose: 5000 })
      return
    }
    firstFactorRef.current = !status.enabled
    if (status.enabled) {
      // Adding a factor to an account with 2FA needs proof of a current one.
      setStep('confirm')
      return
    }
    submittingRef.current = true
    setPending(true)
    await finish(credential, {})
    setPending(false)
    submittingRef.current = false
  }

  const handleConfirm = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (submittingRef.current || pending || !credential || !proof.ready) return
    submittingRef.current = true
    setPending(true)
    const existingFactor = await proof.collect()
    if (existingFactor && !(await finish(credential, existingFactor))) proof.retry()
    setPending(false)
    submittingRef.current = false
  }

  const handleCheckAgain = async () => {
    setPending(true)
    await reconcile()
    setPending(false)
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Add a passkey"
      buttonVariant="outline"
      buttonContent="Add passkey"
      buttonProps={{
        icon: FaPlus,
        onClick: handleAddClick,
        disabled: !supported,
        title: supported ? 'Add a passkey' : "This browser doesn't support passkeys",
      }}
      onOpen={() => {
        openingRef.current += 1
        doneRef.current = false
        closedRef.current = false
        createdRef.current = null
        setStep('intro')
        setName('')
        setCandidate(null)
        setMine(false)
        setCredential(null)
        setRecoveryCodes([])
        setPending(false)
        proof.reset()
        setOpen(true)
        fetchOptions()
      }}
      onClose={() => {
        closedRef.current = true
        cancelPromptRef.current?.()
        proof.cancel()
        // Abandoned after the browser created it: drop the orphan.
        discardCreated()
        setOpen(false)
      }}
      // Done (the passkey is stored) always closes. Otherwise not while
      // the finish request is out, whose outcome decides whether the
      // credential is kept, and not before the first factor's codes are
      // saved. An open browser prompt is aborted.
      canClose={() => doneRef.current || (!finishingRef.current && step !== 'codes')}
      size="md"
    >
      <div className="pt-4">
        {step === 'intro' && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-500">
              Use any of these as a second factor. Your browser walks you through creating the
              passkey, then you can check it here before it&apos;s added to your account.
            </p>
            <ul className="divide-y divide-neutral-500/20 rounded-md ring-1 ring-inset ring-neutral-500/20">
              {PASSKEY_OPTIONS.map(({ kind, title, examples }) => {
                const Icon = PASSKEY_KINDS[kind].icon
                return (
                  <li key={kind} className="flex items-center gap-3 px-3 py-2.5">
                    <Icon className="shrink-0 size-5 text-neutral-500" />
                    <div>
                      <div className="text-sm text-zinc-900 dark:text-zinc-100">{title}</div>
                      <div className="text-2xs text-neutral-500">{examples}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-neutral-500">
              With a hardware key, your browser may ask to let Phase Console see its make and model.
              That only lets us show which key it is: it works either way.
            </p>
            <div className="flex justify-end">
              <Button
                variant="primary"
                icon={GoPasskeyFill}
                onClick={handleCreate}
                isLoading={pending || !options}
                disabled={pending || !options}
              >
                Add a passkey
              </Button>
            </div>
          </div>
        )}

        {step === 'review' && candidate && (
          <form onSubmit={handleReview} className="space-y-4">
            <p className="text-sm text-neutral-500">
              Your browser created this passkey. Check the details and its name, then add it.
            </p>
            <PasskeyCandidateSummary candidate={candidate} />
            <Input
              value={name}
              setValue={setName}
              label="Name"
              maxLength={PASSKEY_NAME_MAX_LENGTH}
              required
            />
            <Checkbox checked={mine} onChange={setMine} label="Yes, this is my passkey" />
            <div className="flex justify-between">
              <Button variant="secondary" type="button" onClick={restart} disabled={pending}>
                Back
              </Button>
              {status.enabled ? (
                <Button
                  variant="primary"
                  icon={FaArrowRight}
                  iconPosition="right"
                  type="submit"
                  disabled={!mine || !name.trim()}
                >
                  Next
                </Button>
              ) : (
                <Button
                  variant="primary"
                  icon={FaCheck}
                  type="submit"
                  isLoading={pending}
                  disabled={pending || !mine || !name.trim()}
                >
                  Add passkey
                </Button>
              )}
            </div>
          </form>
        )}

        {step === 'confirm' && (
          <form onSubmit={handleConfirm} className="space-y-4">
            <p className="text-sm text-neutral-500">
              Confirm it&apos;s you with one of your existing two-factor methods to finish adding
              &ldquo;<span className="ph-no-capture">{name.trim()}</span>&rdquo;.
            </p>
            <FactorProofFields proof={proof} />
            <div className="flex justify-between">
              <Button
                variant="secondary"
                type="button"
                disabled={pending}
                onClick={() => setStep('review')}
              >
                Back
              </Button>
              <Button
                variant="primary"
                icon={FaCheck}
                type="submit"
                isLoading={pending}
                disabled={pending || !proof.ready}
              >
                Add passkey
              </Button>
            </div>
          </form>
        )}

        {step === 'codes' && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-500">
              Two-factor authentication is now on. Save your recovery codes: they get you in if you
              lose your passkey.
            </p>
            <SaveCodesStep codes={recoveryCodes} email={email} onDone={handleDone} />
          </div>
        )}

        {step === 'codes-lost' && (
          <div className="space-y-4">
            <Alert variant="warning" size="sm" icon>
              Your passkey was added and two-factor authentication is on, but your recovery codes
              didn&apos;t reach this browser. Regenerate them now from Recovery codes (you&apos;ll
              confirm with this passkey) so you have a way back in if you lose it.
            </Alert>
            <div className="flex justify-end">
              <Button variant="primary" icon={FaCheck} onClick={handleDone}>
                Done
              </Button>
            </div>
          </div>
        )}

        {step === 'unconfirmed' && (
          <div className="space-y-4">
            <Alert variant="warning" size="sm" icon>
              Phase Console couldn&apos;t confirm whether &ldquo;
              <span className="ph-no-capture">{name.trim()}</span>&rdquo; was added. Check your
              connection and check again in a moment. If it still isn&apos;t listed, start over.
            </Alert>
            <div className="flex justify-between">
              <Button variant="secondary" type="button" onClick={restart} disabled={pending}>
                Start over
              </Button>
              <Button
                variant="primary"
                icon={FaRedo}
                onClick={handleCheckAgain}
                isLoading={pending}
                disabled={pending}
              >
                Check again
              </Button>
            </div>
          </div>
        )}
      </div>
    </GenericDialog>
  )
}

// Everything stored about a passkey (nothing secret: the private key never
// leaves the authenticator).
const passkeyDetails = (passkey: Passkey, rpId: string) => {
  let publicKey: unknown = passkey.publicKey
  try {
    // JSONString fields arrive serialized.
    if (typeof publicKey === 'string') publicKey = JSON.parse(publicKey)
  } catch {
    // Show it as it came.
  }
  return {
    id: passkey.id,
    name: passkey.name,
    kind: passkey.kind,
    authenticator: { name: passkey.authenticatorName, aaguid: passkey.aaguid },
    credentialId: passkey.credentialId,
    rpId,
    publicKey,
    transports: passkey.transports,
    backupEligible: passkey.synced,
    backedUp: passkey.backedUp,
    prfEnabled: passkey.prfEnabled,
    signCount: passkey.signCount,
    createdAt: passkey.createdAt,
    lastUsedAt: passkey.lastUsedAt,
  }
}

const PasskeyDetailsDialog = ({ passkey, rpId }: { passkey: Passkey; rpId: string }) => {
  const { theme } = useContext(ThemeContext)
  const { label } = passkeyKindInfo(passkey.kind)
  const Icon = passkeyIcon(passkey.kind, passkey.authenticatorName)
  const details = JSON.stringify(passkeyDetails(passkey, rpId), null, 2)
  // Provider and kind, unless the name already says them.
  const subtitle = [passkey.authenticatorName, label]
    .filter((part) => part && part !== passkey.name)
    .join(' · ')

  return (
    <GenericDialog
      title="Passkey details"
      buttonVariant="outline"
      buttonContent="Details"
      buttonProps={{ icon: FaInfoCircle, title: 'Show passkey details' }}
      size="lg"
    >
      <div className="space-y-4 pt-4">
        <div className="flex items-center gap-3">
          <Icon className="shrink-0 size-6 text-zinc-900 dark:text-zinc-100" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate ph-no-capture">
              {passkey.name}
            </div>
            {subtitle && <div className="text-xs text-neutral-500">{subtitle}</div>}
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          Everything Phase Console stores about this passkey. None of it is secret: the private key
          never leaves your authenticator.
        </p>
        {/* Copy sits in a header bar, clear of the scroll area and its
            scrollbar. Same highlighting as the other JSON and script blocks. */}
        <div className="overflow-hidden rounded-lg border border-neutral-500/40">
          <div className="flex items-center justify-between gap-2 border-b border-neutral-500/40 bg-zinc-200 dark:bg-zinc-800 py-1.5 pl-3 pr-1.5">
            <span className="text-2xs font-medium uppercase tracking-widest text-neutral-500">
              JSON
            </span>
            <CopyButton value={details} buttonVariant="ghost" title="Copy as JSON" />
          </div>
          <div className="ph-no-capture">
            <SyntaxHighlighter
              language="json"
              style={theme === 'dark' ? vscDarkPlus : coldarkCold}
              wrapLongLines
              customStyle={{
                margin: 0,
                padding: '0.75rem 1rem',
                borderRadius: 0,
                maxHeight: '22rem',
                overflowX: 'hidden',
                overflowY: 'auto',
                fontSize: '0.75rem',
                lineHeight: '1.5',
                fontFamily: 'var(--font-jetbrains-mono)',
                background: theme === 'dark' ? '#171717' : '#e4e4e7',
              }}
              codeTagProps={{
                style: {
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-jetbrains-mono)',
                  // Credential IDs and key coordinates are one long token.
                  wordBreak: 'break-all',
                },
              }}
            >
              {details}
            </SyntaxHighlighter>
          </div>
        </div>
      </div>
    </GenericDialog>
  )
}

export default function TwoFactorSection() {
  const { user } = useUser()
  const email = user?.email || ''
  const { data, loading, refetch } = useQuery(GetMfaStatus, {
    fetchPolicy: 'cache-and-network',
  })
  // handleMfaError owns the toasts — suppress the global errorLink one.
  const [disableMfa] = useMutation(DisableMfaOp, {
    context: { suppressGlobalErrorToast: true },
  })
  const [regenerateRecoveryCodes] = useMutation(RegenerateRecoveryCodesOp, {
    context: { suppressGlobalErrorToast: true },
  })
  const [deletePasskey] = useMutation(DeletePasskeyOp, {
    context: { suppressGlobalErrorToast: true },
  })

  const status = (data?.mfaStatus ?? null) as MfaStatus | null
  const [supported, setSupported] = useState(true)
  // Feature-detect after mount: the server render can't tell.
  useEffect(() => setSupported(passkeysSupported()), [])

  if (loading && !status)
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
    )

  const passkeys = status?.passkeys ?? []
  const methods = { totp: !!status?.totpEnabled, passkey: passkeys.length > 0 }
  const isLastFactor = (methods.totp ? 1 : 0) + passkeys.length === 1

  const reloadStatus = async () => {
    try {
      const { data: latest } = await refetch()
      return (latest?.mfaStatus ?? null) as MfaStatus | null
    } catch {
      return null
    }
  }

  const handleDisableTotp = async (proof: FactorProofPayload) => {
    try {
      await disableMfa({ variables: proof })
      toast.success(
        passkeys.length ? 'Authenticator app removed.' : 'Two-factor authentication disabled.'
      )
      refetch()
      return true
    } catch (e) {
      handleMfaError(e, 'Failed to disable the authenticator app.')
      return false
    }
  }

  const handleRegenerate = async (proof: FactorProofPayload) => {
    try {
      const { data: result } = await regenerateRecoveryCodes({ variables: proof })
      toast.success('New recovery codes generated. Your previous codes no longer work.')
      refetch()
      return result.regenerateRecoveryCodes.recoveryCodes as string[]
    } catch (e) {
      handleMfaError(e, 'Failed to regenerate recovery codes.')
      return false
    }
  }

  const handleRemovePasskey = async (passkey: Passkey, proof: FactorProofPayload) => {
    try {
      await deletePasskey({ variables: { passkeyId: passkey.id, ...proof } })
      // Gone server-side: stop password managers offering it.
      forgetPasskey(status?.passkeyRpId ?? null, passkey.credentialId)
      toast.success(
        isLastFactor ? 'Passkey removed. Two-factor authentication is off.' : 'Passkey removed.'
      )
      refetch()
      return true
    } catch (e) {
      handleMfaError(e, 'Failed to remove the passkey.')
      return false
    }
  }

  const cardClass =
    'rounded-md ring-1 ring-inset ring-neutral-500/20 bg-neutral-200/40 dark:bg-neutral-800/40'
  // Reveal on hover (or keyboard focus) — same treatment as the sign-in
  // method cards.
  const hoverReveal =
    'shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity'
  const enabledBadge = (
    <span className="shrink-0 flex items-center gap-1 text-2xs text-emerald-500">
      <FaCheckCircle className="shrink-0" /> Enabled
    </span>
  )

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base sm:text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Two-factor authentication
        </h2>
        <p className="text-sm text-neutral-500">
          Require a second factor in addition to your primary sign-in method.
        </p>
      </div>

      <div className="space-y-3">
        {/* Same card treatment as the sign-in method cards: neutral surface
            + small emerald badge to signal the enabled state. */}
        <div className={`group flex items-center justify-between gap-4 px-4 py-3 ${cardClass}`}>
          <div className="flex items-center gap-3">
            <TbPasswordMobilePhone
              className={`shrink-0 h-6 w-6 ${methods.totp ? '' : 'opacity-60'}`}
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">TOTP</span>
                {methods.totp && enabledBadge}
              </div>
              <div className="text-xs text-neutral-500">
                Authenticator app{methods.totp ? '' : ' · Not enabled'}
              </div>
              {methods.totp && status?.activatedAt && (
                <div className="text-2xs text-neutral-500">
                  Enabled {relativeTime(status.activatedAt)}
                </div>
              )}
            </div>
          </div>
          {methods.totp ? (
            <div className={hoverReveal}>
              <FactorProofDialog
                title="Disable authenticator app"
                buttonContent="Disable"
                buttonIcon={FaBan}
                reauth={{ action: '2fa-disable' }}
                methods={methods}
                description="Confirm it's you with one of your two-factor methods to stop using your authenticator app."
                warning={isLastFactor ? LAST_FACTOR_WARNING : undefined}
                submitLabel="Disable"
                submitVariant="danger"
                submitIcon={FaBan}
                email={email}
                onConfirm={handleDisableTotp}
              />
            </div>
          ) : (
            <div className="shrink-0">
              <TwoFactorSetupDialog
                hasPasskeys={methods.passkey}
                onComplete={refetch}
                reloadStatus={reloadStatus}
              />
            </div>
          )}
        </div>

        <div className={cardClass}>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-3">
              <GoPasskeyFill
                className={`shrink-0 h-6 w-6 ${methods.passkey ? '' : 'opacity-60'}`}
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Passkeys
                  </span>
                  {methods.passkey && enabledBadge}
                </div>
                <div className="text-xs text-neutral-500">
                  Hardware security keys, or passkeys on your device or in a password manager
                  {methods.passkey ? '' : ' · Not enabled'}
                  {supported ? '' : " · This browser doesn't support passkeys"}
                </div>
              </div>
            </div>
            {status && (
              <div className="shrink-0">
                <AddPasskeyDialog
                  status={status}
                  email={email}
                  supported={supported}
                  onComplete={refetch}
                  reloadStatus={reloadStatus}
                />
              </div>
            )}
          </div>
          {passkeys.map((passkey) => {
            const { label } = passkeyKindInfo(passkey.kind)
            const KindIcon = passkeyIcon(passkey.kind, passkey.authenticatorName)
            // The provider or key model, unless the name already says it.
            const provider =
              passkey.authenticatorName && passkey.authenticatorName !== passkey.name
                ? passkey.authenticatorName
                : null
            const kindLabel = label === passkey.name ? null : label
            return (
              <div
                key={passkey.id}
                className="group flex items-center justify-between gap-4 border-t border-neutral-500/20 px-4 py-3 pl-[3.25rem]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <KindIcon className="shrink-0 size-5 text-neutral-500" />
                  <div className="min-w-0">
                    <div className="text-sm text-zinc-900 dark:text-zinc-100 truncate ph-no-capture">
                      {passkey.name}
                    </div>
                    <div className="text-2xs text-neutral-500">
                      {[
                        provider,
                        kindLabel,
                        passkey.createdAt && `Added ${relativeTime(passkey.createdAt)}`,
                        passkey.lastUsedAt
                          ? `Last used ${relativeTime(passkey.lastUsedAt)}`
                          : 'Never used',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                </div>
                <div className={`flex items-center gap-2 ${hoverReveal}`}>
                  <PasskeyDetailsDialog passkey={passkey} rpId={status?.passkeyRpId ?? ''} />
                  <FactorProofDialog
                    title="Remove passkey"
                    buttonContent="Remove"
                    buttonIcon={FaTrash}
                    reauth={{ action: 'passkey-remove', passkey: passkey.id }}
                    methods={methods}
                    description={
                      <>
                        Confirm it&apos;s you with one of your two-factor methods to remove &ldquo;
                        <span className="ph-no-capture">{passkey.name}</span>&rdquo;.
                      </>
                    }
                    warning={isLastFactor ? LAST_FACTOR_WARNING : undefined}
                    submitLabel="Remove passkey"
                    submitVariant="danger"
                    submitIcon={FaTrash}
                    email={email}
                    onConfirm={(proof) => handleRemovePasskey(passkey, proof)}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {status?.enabled && (
          <div className={`group flex items-center justify-between gap-4 px-4 py-3 ${cardClass}`}>
            <div className="flex items-center gap-3">
              <TbShieldLock className="shrink-0 h-6 w-6" />
              <div>
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Recovery codes
                </div>
                <div className="text-xs text-neutral-500">
                  {status.recoveryCodesRemaining}{' '}
                  {status.recoveryCodesRemaining === 1 ? 'code' : 'codes'} remaining · Shared by all
                  your two-factor methods
                </div>
              </div>
            </div>
            <div className={hoverReveal}>
              <FactorProofDialog
                title="Regenerate recovery codes"
                buttonContent="Regenerate"
                buttonIcon={FaSync}
                reauth={{ action: 'recovery-regenerate' }}
                methods={methods}
                description="Confirm it's you with one of your two-factor methods to generate a fresh set of 10 codes. Your previous codes will stop working."
                submitLabel="Regenerate"
                submitIcon={FaSync}
                email={email}
                onConfirm={handleRegenerate}
              />
            </div>
          </div>
        )}
      </div>

      {status?.enabled && status.recoveryCodesRemaining < 3 && (
        <Alert variant="warning" size="sm" icon>
          You are running low on recovery codes. Regenerate a new set to avoid being locked out.
        </Alert>
      )}
    </section>
  )
}
