'use client'

import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { HeroPattern } from '@/components/common/HeroPattern'
import { LogoWordMark } from '@/components/common/LogoWordMark'
import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from '@/contexts/userContext'
import { FaCheckCircle } from 'react-icons/fa'
import Link from 'next/link'
import axios from 'axios'
import { UrlUtils } from '@/utils/auth'
import { passwordAuthHash } from '@/utils/crypto'
import { PasswordStrengthMeter } from '@/components/common/PasswordStrengthMeter'
import { ModeToggle } from '@/components/common/ModeToggle'
import { FaSun, FaMoon } from 'react-icons/fa6'
import { InstanceInfo } from '@/components/InstanceInfo'

const Signup = () => {
  const { status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingVerification, setPendingVerification] = useState(false)
  const [emailLocked, setEmailLocked] = useState(false)

  // When the user arrives from an invite, login forwards both `email` and
  // `callbackUrl` (e.g. /invite/<token>). Lock the email field — it must
  // match the invitee — and forward callbackUrl through to login on success
  // so the invite acceptance flow resumes after authentication.
  const callbackUrl = searchParams?.get('callbackUrl') ?? ''

  useEffect(() => {
    const emailParam = searchParams?.get('email')
    if (emailParam) {
      setEmail(emailParam)
      if (callbackUrl) setEmailLocked(true)
    }
  }, [searchParams, callbackUrl])

  useEffect(() => {
    // Authenticated users with orgs should go home, not signup
    if (status === 'authenticated') router.push('/')
  }, [status, router])

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password !== confirmPassword) {
      toast.error("Passwords don't match")
      return
    }

    if (password.length < 16) {
      toast.error('Password must be at least 16 characters')
      return
    }

    setLoading(true)
    try {
      const trimmedEmail = email.toLowerCase().trim()
      const authHash = await passwordAuthHash(password, trimmedEmail)

      const response = await axios.post(
        UrlUtils.makeUrl(
          process.env.NEXT_PUBLIC_BACKEND_API_BASE!,
          'auth',
          'password',
          'register'
        ),
        {
          email: trimmedEmail,
          fullName: fullName.trim(),
          authHash,
          ...(callbackUrl ? { callbackUrl } : {}),
        },
        { withCredentials: true }
      )

      if (response.data.verificationSkipped) {
        toast.success('Account created! You can now log in.')
        const loginQs = callbackUrl
          ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
          : ''
        router.push(`/login${loginQs}`)
      } else {
        setPendingVerification(true)
      }
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.error(err.response.data.error)
      } else {
        toast.error('Registration failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  const handleResendVerification = async () => {
    setResending(true)
    try {
      await axios.post(
        UrlUtils.makeUrl(
          process.env.NEXT_PUBLIC_BACKEND_API_BASE!,
          'auth',
          'verify-email',
          'resend'
        ),
        { email: email.toLowerCase().trim() },
        { withCredentials: true }
      )
      toast.success('Verification email sent!')
      setResent(true)
    } catch {
      toast.error('Failed to resend. Please try again later.')
    } finally {
      setResending(false)
    }
  }

  if (pendingVerification) {
    return (
      <main className="w-full flex flex-col justify-between h-screen">
        <HeroPattern />
        <div className="mx-auto my-auto w-full max-w-xl flex flex-col gap-8 p-16 rounded-lg text-center items-center bg-zinc-200 dark:bg-zinc-800/40 ring-1 ring-inset ring-neutral-500/40 shadow-xl">
          <FaCheckCircle className="text-emerald-500 text-5xl" />
          <div className="space-y-2">
            <h2 className="text-black dark:text-white font-semibold text-2xl">
              Check your email
            </h2>
            <p className="text-neutral-500">
              We sent a verification link to{' '}
              <span className="font-medium text-neutral-300">{email}</span>. Click the link to
              activate your account.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={handleResendVerification}
            isLoading={resending}
            disabled={resending || resent}
          >
            {resent ? 'Email sent' : 'Resend email'}
          </Button>
        </div>
      </main>
    )
  }

  return (
    <>
      <div className="h-screen w-full md:p-16 text-zinc-900 dark:text-zinc-100 flex items-center justify-center px-4">
        <div className="absolute top-4 px-4 md:px-8 md:top-8 w-full flex justify-between gap-6">
          <div className="flex items-center gap-2">
            <InstanceInfo />
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center justify-between px-2 text-neutral-500">
              <div className="flex items-center gap-2">
                <FaSun />
                <ModeToggle />
                <FaMoon />
              </div>
            </div>
          </div>
        </div>

        <div className="gap-y-4 flex flex-col items-center justify-center w-full max-w-md">
          <div className="flex flex-col items-center justify-center mb-4">
            <LogoWordMark className="w-32 fill-neutral-500" />
          </div>
          <div className="text-lg font-medium pb-4 text-center">Create your account</div>

          <div className="flex flex-col gap-6 justify-center p-5 md:p-8 border border-neutral-500/20 shadow-lg dark:shadow-2xl rounded-lg bg-neutral-200/10 dark:bg-neutral-800/40 backdrop-blur-lg w-full">
            <form onSubmit={handleSignup} className="flex flex-col gap-4">
              <Input
                id="full-name"
                label="Full name"
                value={fullName}
                setValue={setFullName}
                placeholder="Satoshi Nakamoto"
                required
              />
              <Input
                id="email"
                label="Email"
                type="email"
                value={email}
                setValue={setEmail}
                placeholder="satoshin@gmx.com"
                required
                readOnly={emailLocked}
                aria-readonly={emailLocked}
              />
              <Input
                id="password"
                label="Password"
                value={password}
                setValue={setPassword}
                secret
                required
                minLength={16}
              />
              <PasswordStrengthMeter password={password} />
              <Input
                id="confirm-password"
                label="Confirm password"
                value={confirmPassword}
                setValue={setConfirmPassword}
                secret
                required
                minLength={16}
              />
              <Button
                type="submit"
                variant="primary"
                isLoading={loading}
                disabled={loading}
              >
                {loading ? 'Creating account...' : 'Create account'}
              </Button>
              <div className="text-center">
                <Link
                  href="/login"
                  className="text-sm text-neutral-500 hover:text-neutral-300 transition ease"
                >
                  Already have an account? Log in
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  )
}

export default Signup
