'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { QRCodeSVG } from 'qrcode.react'
import {
  FaArrowLeft,
  FaArrowRight,
  FaBan,
  FaCamera,
  FaCheck,
  FaCheckCircle,
  FaCog,
  FaCopy,
  FaDownload,
  FaEye,
  FaEyeSlash,
  FaSync,
} from 'react-icons/fa'
import { TbPasswordMobilePhone } from 'react-icons/tb'
import { useUser } from '@/contexts/userContext'
import { buildReauthUrl, isReauthError, requestReauthPrompt } from '@/utils/accountErrors'
import { useReauthRestore, useReauthStateSync, useSessionFresh } from './useReauthState'
import StaleSessionNotice from './StaleSessionNotice'
import { GetMfaStatus } from '@/graphql/queries/account/getMfaStatus.gql'
import { EnrollMfaOp } from '@/graphql/mutations/account/enrollMfa.gql'
import { ActivateMfaOp } from '@/graphql/mutations/account/activateMfa.gql'
import { DisableMfaOp } from '@/graphql/mutations/account/disableMfa.gql'
import { RegenerateRecoveryCodesOp } from '@/graphql/mutations/account/regenerateRecoveryCodes.gql'
import { Button } from '../common/Button'
import { Alert } from '../common/Alert'
import Spinner from '../common/Spinner'
import CopyButton from '../common/CopyButton'
import GenericDialog from '../common/GenericDialog'
import TotpCodeInput from '../auth/TotpCodeInput'
import { RecoveryCodeInput } from '../auth/RecoveryCodeInput'
import { relativeTimeFromDates } from '@/utils/time'

type MfaStatus = {
  enabled: boolean
  activatedAt: string | null
  recoveryCodesRemaining: number
}

type DialogHandle = { openModal: () => void; closeModal: () => void }

const handleMfaError = (e: unknown, fallback: string) => {
  const message = e instanceof Error ? e.message : ''
  // The Apollo errorLink redirects on the reauth gate; skip our toast.
  if (isReauthError(message)) return
  toast.error(message || fallback, { autoClose: 5000 })
}

export const recoveryCodesFileContent = (email: string, codes: string[]) =>
  [
    'Phase Console recovery codes',
    `Account: ${email}`,
    '',
    'Each code can be used once in place of an authenticator code.',
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
    link.download = 'phase-recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
    onInteracted?.()
  }

  return (
    <div className="space-y-4">
      <Alert variant="warning" size="sm" icon>
        These codes are shown only once. Each can be used a single time in place of an authenticator
        code if you lose access to your device.
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

const CodeInput = ({
  value,
  onChange,
  recovery,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  recovery?: boolean
  autoFocus?: boolean
}) =>
  recovery ? (
    <RecoveryCodeInput value={value} onChange={onChange} autoFocus={autoFocus} />
  ) : (
    <TotpCodeInput value={value} onChange={onChange} autoFocus={autoFocus} />
  )

const TwoFactorSetupDialog = ({ onComplete }: { onComplete: () => void }) => {
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
  const [step, setStep] = useState<'qr' | 'confirm' | 'codes'>('qr')
  const [secret, setSecret] = useState('')
  const [otpauthUri, setOtpauthUri] = useState('')
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  // Done unlocks only after the user reveals, copies or downloads the
  // codes — they're shown exactly once, so a blind "Done" means lockout.
  const [codesSaved, setCodesSaved] = useState(false)
  // canClose captures a stale `step`, so Done signals through a ref instead —
  // else a failed refetch leaves the codes step permanently unclosable.
  const doneRef = useRef(false)
  // Set by the post-reauth restore before opening, read by startEnrollment.
  const restoreConfirmRef = useRef(false)

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
    setCodesSaved(false)
    setSecret('')
    setOtpauthUri('')
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
    step: step === 'confirm' ? 'confirm' : 'qr',
  }))

  useReauthRestore('2fa-setup', (params) => {
    restoreConfirmRef.current = params.get('step') === 'confirm'
    dialogRef.current?.openModal()
  })

  const { isFresh } = useSessionFresh()

  // Enrollment itself is reauth-gated, so a stale session would flash the
  // dialog open and closed before the sign-in prompt. Ask first instead;
  // the restore param reopens setup after the re-login.
  const handleEnableClick = () => {
    if (!isFresh() && requestReauthPrompt(buildReauthUrl('/account?action=2fa-setup&step=qr')))
      return
    dialogRef.current?.openModal()
  }

  const handleActivate = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    setPending(true)
    try {
      const { data } = await activateMfa({ variables: { code } })
      setRecoveryCodes(data.activateMfa.recoveryCodes)
      setStep('codes')
      toast.success('Two-factor authentication enabled.')
    } catch (e) {
      handleMfaError(e, 'Invalid code. Please try again.')
      setCode('')
    } finally {
      setPending(false)
    }
  }

  const handleDone = () => {
    doneRef.current = true
    dialogRef.current?.closeModal()
    onComplete()
  }

  return (
    <>
      {/* External trigger (instead of GenericDialog's) so the freshness
          pre-check runs before the dialog opens. */}
      <Button
        variant="primary"
        icon={TbPasswordMobilePhone}
        title="Enable two-factor authentication"
        onClick={handleEnableClick}
      >
        Enable
      </Button>
      <GenericDialog
        ref={dialogRef}
        title="Set up two-factor authentication"
        onOpen={() => {
          setOpen(true)
          startEnrollment()
        }}
        onClose={() => setOpen(false)}
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
            <form onSubmit={handleActivate} className="space-y-4">
              <p className="text-sm text-neutral-500">
                Enter the 6-digit code from your authenticator app to confirm setup.
              </p>
              <CodeInput value={code} onChange={setCode} autoFocus />
              <div className="flex justify-between">
                <Button
                  variant="secondary"
                  type="button"
                  icon={FaArrowLeft}
                  onClick={() => {
                    setStep('qr')
                    // After a confirm-step restore there is no QR client-side —
                    // enroll again (fresh secret) to show one.
                    if (!otpauthUri) fetchEnrollment()
                  }}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  icon={TbPasswordMobilePhone}
                  type="submit"
                  isLoading={pending}
                  disabled={pending || code.length !== 6}
                >
                  Verify and enable
                </Button>
              </div>
            </form>
          )}

          {step === 'codes' && (
            <div className="space-y-4">
              <RecoveryCodesPanel
                codes={recoveryCodes}
                email={user?.email || ''}
                onInteracted={() => setCodesSaved(true)}
              />
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  icon={FaCheck}
                  onClick={handleDone}
                  disabled={!codesSaved}
                  title={
                    codesSaved ? undefined : 'Reveal, copy or download your recovery codes first'
                  }
                >
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

const ManageTotpDialog = ({
  email,
  onDisable,
  onRegenerate,
}: {
  email: string
  onDisable: (payload: { code?: string; recoveryCode?: string }) => Promise<boolean>
  onRegenerate: (payload: { code?: string; recoveryCode?: string }) => Promise<string[] | null>
}) => {
  const dialogRef = useRef<DialogHandle>(null)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'menu' | 'regenerate' | 'disable' | 'codes'>('menu')
  const [code, setCode] = useState('')
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [pending, setPending] = useState(false)
  const [newCodes, setNewCodes] = useState<string[]>([])

  const reset = () => {
    setStep('menu')
    setCode('')
    setRecoveryMode(false)
    setPending(false)
    setNewCodes([])
  }

  // If the fresh-session gate interrupts a regenerate/disable, reopen at
  // the same step after the re-login. The TOTP/recovery code is never
  // captured — re-entered. New recovery codes (codes step) are shown once
  // and never restorable, so that step maps back to the menu.
  useReauthStateSync(open, () => {
    const state: Record<string, string> = {
      action: '2fa-manage',
      step: step === 'codes' ? 'menu' : step,
    }
    if (recoveryMode && (step === 'regenerate' || step === 'disable')) state.recovery = '1'
    return state
  })

  useReauthRestore('2fa-manage', (params) => {
    // openModal fires onOpen → reset() first; these updates land after it.
    dialogRef.current?.openModal()
    const restoredStep = params.get('step')
    if (restoredStep === 'regenerate' || restoredStep === 'disable') {
      setStep(restoredStep)
      if (params.get('recovery') === '1') setRecoveryMode(true)
    }
  })

  const payload = () => (recoveryMode ? { recoveryCode: code } : { code })

  const handleRegenerate = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    setPending(true)
    const codes = await onRegenerate(payload())
    setPending(false)
    setCode('')
    if (codes) {
      setNewCodes(codes)
      setStep('codes')
    }
  }

  const handleDisable = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    setPending(true)
    const success = await onDisable(payload())
    setPending(false)
    setCode('')
    if (success) dialogRef.current?.closeModal()
  }

  const backToMenu = () => {
    setStep('menu')
    setCode('')
    setRecoveryMode(false)
  }

  const codeForm = (action: 'regenerate' | 'disable', description: string, submitLabel: string) => (
    <form
      onSubmit={action === 'regenerate' ? handleRegenerate : handleDisable}
      className="space-y-4 pt-4"
    >
      <StaleSessionNotice />
      <p className="text-sm text-neutral-500">{description}</p>
      <CodeInput value={code} onChange={setCode} recovery={recoveryMode} />
      <button
        type="button"
        onClick={() => {
          setRecoveryMode(!recoveryMode)
          setCode('')
        }}
        className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease block"
      >
        {recoveryMode ? 'Use your authenticator app instead' : 'Use a recovery code instead'}
      </button>
      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          type="button"
          icon={FaArrowLeft}
          onClick={backToMenu}
          disabled={pending}
        >
          Back
        </Button>
        <Button
          variant={action === 'disable' ? 'danger' : 'primary'}
          icon={action === 'disable' ? FaBan : FaSync}
          type="submit"
          isLoading={pending}
          disabled={pending || !code}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  )

  return (
    <GenericDialog
      ref={dialogRef}
      title="Manage two-factor authentication"
      buttonVariant="outline"
      buttonContent="Manage"
      buttonProps={{ icon: FaCog }}
      onOpen={() => {
        reset()
        setOpen(true)
      }}
      onClose={() => setOpen(false)}
      size="md"
    >
      {step === 'menu' && (
        <div className="space-y-3 pt-4">
          <StaleSessionNotice />
          <div className="flex items-center justify-between gap-4 rounded-md ring-1 ring-inset ring-neutral-500/20 p-4">
            <div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Regenerate recovery codes
              </div>
              <div className="text-sm text-neutral-500">
                Generate a fresh set of 10 codes. Your previous codes will stop working.
              </div>
            </div>
            <Button variant="outline" icon={FaSync} onClick={() => setStep('regenerate')}>
              Regenerate
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md ring-1 ring-inset ring-red-500/40 p-4">
            <div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Disable two-factor authentication
              </div>
              <div className="text-sm text-neutral-500">
                Signing in will no longer require an authenticator code.
              </div>
            </div>
            <Button variant="danger" icon={FaBan} onClick={() => setStep('disable')}>
              Disable
            </Button>
          </div>
        </div>
      )}

      {step === 'regenerate' &&
        codeForm(
          'regenerate',
          'Enter a code from your authenticator app (or an unused recovery code) to generate a new set.',
          'Regenerate'
        )}

      {step === 'disable' &&
        codeForm(
          'disable',
          'Enter a code from your authenticator app (or an unused recovery code) to disable two-factor authentication.',
          'Disable 2FA'
        )}

      {step === 'codes' && (
        <div className="space-y-4 pt-4">
          <RecoveryCodesPanel codes={newCodes} email={email} />
          <div className="flex justify-end">
            <Button
              variant="primary"
              icon={FaCheck}
              onClick={() => dialogRef.current?.closeModal()}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </GenericDialog>
  )
}

export default function TwoFactorSection() {
  const { user } = useUser()
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

  const status = (data?.mfaStatus ?? null) as MfaStatus | null

  const handleDisable = async (payload: {
    code?: string
    recoveryCode?: string
  }): Promise<boolean> => {
    try {
      await disableMfa({ variables: payload })
      toast.success('Two-factor authentication disabled.')
      await refetch()
      return true
    } catch (e) {
      handleMfaError(e, 'Failed to disable two-factor authentication.')
      return false
    }
  }

  const handleRegenerate = async (payload: {
    code?: string
    recoveryCode?: string
  }): Promise<string[] | null> => {
    try {
      const { data: result } = await regenerateRecoveryCodes({ variables: payload })
      toast.success('New recovery codes generated. Your previous codes no longer work.')
      await refetch()
      return result.regenerateRecoveryCodes.recoveryCodes
    } catch (e) {
      handleMfaError(e, 'Failed to regenerate recovery codes.')
      return null
    }
  }

  if (loading)
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
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

      {status?.enabled ? (
        <div className="space-y-4">
          {/* Same card treatment as the sign-in method cards: neutral
              surface + small emerald badge to signal the enabled state. */}
          <div className="group flex items-center justify-between gap-4 rounded-md ring-1 ring-inset ring-neutral-500/20 bg-neutral-200/40 dark:bg-neutral-800/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <TbPasswordMobilePhone className="shrink-0 h-6 w-6" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">TOTP</span>
                  <span className="shrink-0 flex items-center gap-1 text-2xs text-emerald-500">
                    <FaCheckCircle className="shrink-0" /> Enabled
                  </span>
                </div>
                <div className="text-xs text-neutral-500">Authenticator app</div>
                <div className="text-2xs text-neutral-500">
                  {status.activatedAt &&
                    `Enabled ${relativeTimeFromDates(new Date(status.activatedAt))} · `}
                  {status.recoveryCodesRemaining} recovery{' '}
                  {status.recoveryCodesRemaining === 1 ? 'code' : 'codes'} remaining
                </div>
              </div>
            </div>
            {/* Reveal on hover (or keyboard focus) — same treatment as the
                sign-in method cards. */}
            <div className="shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <ManageTotpDialog
                email={user?.email || ''}
                onDisable={handleDisable}
                onRegenerate={handleRegenerate}
              />
            </div>
          </div>

          {status.recoveryCodesRemaining < 3 && (
            <Alert variant="warning" size="sm" icon>
              You are running low on recovery codes. Regenerate a new set to avoid being locked out.
            </Alert>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-md ring-1 ring-inset ring-neutral-500/20 bg-neutral-200/40 dark:bg-neutral-800/40 px-4 py-3">
          <div className="flex items-center gap-3">
            <TbPasswordMobilePhone className="shrink-0 h-6 w-6 opacity-60" />
            <div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">TOTP</div>
              <div className="text-xs text-neutral-500">Authenticator app · Not enabled</div>
            </div>
          </div>
          <div className="shrink-0">
            <TwoFactorSetupDialog onComplete={refetch} />
          </div>
        </div>
      )}
    </section>
  )
}
