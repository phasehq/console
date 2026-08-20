'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { QRCodeSVG } from 'qrcode.react'
import { FaCamera, FaCopy, FaDownload, FaEye, FaEyeSlash, FaShieldAlt } from 'react-icons/fa'
import { useUser } from '@/contexts/userContext'
import { Button } from '../common/Button'
import { Alert } from '../common/Alert'
import Spinner from '../common/Spinner'
import CopyButton from '../common/CopyButton'
import GenericDialog from '../common/GenericDialog'
import TotpCodeInput from '../auth/TotpCodeInput'
import { UrlUtils } from '@/utils/auth'
import { relativeTimeFromDates } from '@/utils/time'

type MfaStatus = {
  enabled: boolean
  activatedAt: string | null
  recoveryCodesRemaining: number
}

type DialogHandle = { closeModal: () => void }

const mfaUrl = (...segments: string[]) =>
  UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'auth', 'mfa', ...segments)

const redirectToReauth = () => {
  window.location.href = '/login?callbackUrl=%2Faccount&reauth=1'
}

const handleMfaError = (e: unknown, fallback: string) => {
  if (axios.isAxiosError(e) && e.response) {
    if (e.response.status === 401 && e.response.data?.code === 'reauth_required') {
      redirectToReauth()
      return
    }
    toast.error(e.response.data?.error || fallback, { autoClose: 5000 })
  } else {
    toast.error(fallback, { autoClose: 5000 })
  }
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
        These codes are shown only once. Each can be used a single time in place of an
        authenticator code if you lose access to your device.
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
}: {
  value: string
  onChange: (value: string) => void
  recovery?: boolean
}) =>
  recovery ? (
    <input
      type="text"
      maxLength={11}
      placeholder="xxxxx-xxxxx"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
      className="custom w-full text-zinc-800 font-mono dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md text-center tracking-widest ph-no-capture"
    />
  ) : (
    <TotpCodeInput value={value} onChange={onChange} />
  )

const TwoFactorSetupDialog = ({ onComplete }: { onComplete: () => void }) => {
  const { user } = useUser()
  const dialogRef = useRef<DialogHandle>(null)
  const [step, setStep] = useState<'qr' | 'confirm' | 'codes'>('qr')
  const [secret, setSecret] = useState('')
  const [otpauthUri, setOtpauthUri] = useState('')
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  // Done unlocks only after the user reveals, copies or downloads the
  // codes — they're shown exactly once, so a blind "Done" means lockout.
  const [codesSaved, setCodesSaved] = useState(false)
  // canClose reads a stale `step` closure, so the Done path signals intent
  // through a ref instead — otherwise a failed status refetch would leave
  // the dialog permanently unclosable on the recovery-codes step.
  const doneRef = useRef(false)

  const startEnrollment = async () => {
    doneRef.current = false
    setStep('qr')
    setCode('')
    setRecoveryCodes([])
    setCodesSaved(false)
    try {
      const { data } = await axios.post(
        mfaUrl('enroll'),
        {},
        { withCredentials: true, headers: { 'Content-Type': 'application/json' } }
      )
      setSecret(data.secret)
      setOtpauthUri(data.otpauthUri)
    } catch (e) {
      handleMfaError(e, 'Failed to start two-factor setup.')
      dialogRef.current?.closeModal()
    }
  }

  const handleActivate = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    setPending(true)
    try {
      const { data } = await axios.post(
        mfaUrl('enroll', 'activate'),
        { code },
        { withCredentials: true, headers: { 'Content-Type': 'application/json' } }
      )
      setRecoveryCodes(data.recoveryCodes)
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
    <GenericDialog
      ref={dialogRef}
      title="Set up two-factor authentication"
      buttonVariant="primary"
      buttonContent="Enable 2FA"
      buttonProps={{ icon: FaShieldAlt }}
      onOpen={startEnrollment}
      canClose={() => step !== 'codes' || doneRef.current}
      size="md"
    >
      <div className="pt-4">
        {step === 'qr' && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-500">
              Scan this QR code with your authenticator app (e.g. Google Authenticator, Authy,
              1Password), or enter the secret manually.
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
                <div className="text-sm text-neutral-500 pt-2">
                  Or copy and paste the secret:
                </div>
                <div className="max-w-full ph-no-capture">
                  <CopyButton value={secret} buttonVariant="ghost" title="Copy secret">
                    <span className="flex items-center gap-1.5">
                      <FaCopy className="shrink-0" />
                      <span className="font-mono text-xs tracking-widest text-neutral-500">
                        {'•'.repeat(16)}
                      </span>
                    </span>
                  </CopyButton>
                </div>
              </div>
            ) : (
              <div className="flex justify-center py-8">
                <Spinner size="md" />
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setStep('confirm')} disabled={!otpauthUri}>
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
            <CodeInput value={code} onChange={setCode} />
            <div className="flex justify-between">
              <Button variant="secondary" type="button" onClick={() => setStep('qr')}>
                Back
              </Button>
              <Button
                variant="primary"
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
                onClick={handleDone}
                disabled={!codesSaved}
                title={
                  codesSaved
                    ? undefined
                    : 'Reveal, copy or download your recovery codes first'
                }
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </GenericDialog>
  )
}

const CodeConfirmDialog = ({
  title,
  buttonContent,
  buttonVariant,
  description,
  submitLabel,
  onSubmitCode,
}: {
  title: string
  buttonContent: React.ReactNode
  buttonVariant: 'danger' | 'outline'
  description: string
  submitLabel: string
  onSubmitCode: (payload: { code?: string; recoveryCode?: string }) => Promise<boolean>
}) => {
  const dialogRef = useRef<DialogHandle>(null)
  const [code, setCode] = useState('')
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [pending, setPending] = useState(false)

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    setPending(true)
    const payload = recoveryMode ? { recoveryCode: code } : { code }
    const success = await onSubmitCode(payload)
    setPending(false)
    setCode('')
    if (success) dialogRef.current?.closeModal()
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={title}
      buttonVariant={buttonVariant}
      buttonContent={buttonContent}
      onOpen={() => {
        setCode('')
        setRecoveryMode(false)
      }}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-4">
        <p className="text-sm text-neutral-500">{description}</p>
        <CodeInput value={code} onChange={setCode} recovery={recoveryMode} />
        <button
          type="button"
          onClick={() => {
            setRecoveryMode(!recoveryMode)
            setCode('')
          }}
          className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease"
        >
          {recoveryMode ? 'Use your authenticator app instead' : 'Use a recovery code'}
        </button>
        <div className="flex justify-end">
          <Button
            variant={buttonVariant === 'danger' ? 'danger' : 'primary'}
            type="submit"
            isLoading={pending}
            disabled={pending || !code}
          >
            {submitLabel}
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}

export default function TwoFactorSection() {
  const { user } = useUser()
  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [regeneratedCodes, setRegeneratedCodes] = useState<string[] | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await axios.get(mfaUrl('status'), { withCredentials: true })
      setStatus(data)
    } catch {
      toast.error('Failed to load two-factor authentication status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const handleDisable = async (payload: {
    code?: string
    recoveryCode?: string
  }): Promise<boolean> => {
    try {
      await axios.post(mfaUrl('disable'), payload, {
        withCredentials: true,
        headers: { 'Content-Type': 'application/json' },
      })
      toast.success('Two-factor authentication disabled.')
      setRegeneratedCodes(null)
      await fetchStatus()
      return true
    } catch (e) {
      handleMfaError(e, 'Failed to disable two-factor authentication.')
      return false
    }
  }

  const handleRegenerate = async (payload: {
    code?: string
    recoveryCode?: string
  }): Promise<boolean> => {
    try {
      const { data } = await axios.post(mfaUrl('recovery-codes'), payload, {
        withCredentials: true,
        headers: { 'Content-Type': 'application/json' },
      })
      setRegeneratedCodes(data.recoveryCodes)
      toast.success('New recovery codes generated. Your previous codes no longer work.')
      await fetchStatus()
      return true
    } catch (e) {
      handleMfaError(e, 'Failed to regenerate recovery codes.')
      return false
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
          Require a code from an authenticator app every time you sign in, with any sign-in
          method.
        </p>
      </div>

      {status?.enabled ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-md ring-1 ring-inset ring-emerald-500/40 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-3">
              <FaShieldAlt className="text-emerald-500 shrink-0" />
              <div>
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Enabled
                  {status.activatedAt &&
                    ` ${relativeTimeFromDates(new Date(status.activatedAt))}`}
                </div>
                <div className="text-xs text-neutral-500">
                  {status.recoveryCodesRemaining} recovery{' '}
                  {status.recoveryCodesRemaining === 1 ? 'code' : 'codes'} remaining
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <CodeConfirmDialog
                title="Regenerate recovery codes"
                buttonVariant="outline"
                buttonContent={<span className="text-xs">Regenerate codes</span>}
                description="Enter a code from your authenticator app (or an unused recovery code) to generate a new set. Your previous codes will stop working."
                submitLabel="Regenerate"
                onSubmitCode={handleRegenerate}
              />
              <CodeConfirmDialog
                title="Disable two-factor authentication"
                buttonVariant="danger"
                buttonContent={<span className="text-xs">Disable</span>}
                description="Enter a code from your authenticator app (or an unused recovery code) to disable two-factor authentication. Signing in will no longer require a code."
                submitLabel="Disable 2FA"
                onSubmitCode={handleDisable}
              />
            </div>
          </div>

          {status.recoveryCodesRemaining < 3 && !regeneratedCodes && (
            <Alert variant="warning" size="sm" icon>
              You are running low on recovery codes. Regenerate a new set to avoid being
              locked out.
            </Alert>
          )}

          {regeneratedCodes && (
            <RecoveryCodesPanel codes={regeneratedCodes} email={user?.email || ''} />
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-md ring-1 ring-inset ring-neutral-500/20 bg-neutral-200/40 dark:bg-neutral-800/40 p-4">
          <div className="text-sm text-neutral-500">
            Two-factor authentication is not enabled on your account.
          </div>
          <div className="shrink-0">
            <TwoFactorSetupDialog onComplete={fetchStatus} />
          </div>
        </div>
      )}
    </section>
  )
}
