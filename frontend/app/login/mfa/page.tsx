'use client'

import { FaMoon, FaSun } from 'react-icons/fa6'
import MfaVerifyForm, { MfaVerifySuccess } from '@/components/auth/MfaVerifyForm'
import { LogoWordMark } from '@/components/common/LogoWordMark'
import { ModeToggle } from '@/components/common/ModeToggle'
import { isSafeRedirectPath } from '@/utils/auth'

export default function LoginMfa() {
  const handleSuccess = (data: MfaVerifySuccess) => {
    window.location.href = isSafeRedirectPath(data.returnTo) ? data.returnTo : '/'
  }

  return (
    <div className="h-screen w-full md:p-16 text-zinc-900 dark:text-zinc-100 flex items-center justify-center px-4">
      <div className="absolute top-4 px-4 md:px-8 md:top-8 w-full flex justify-end">
        <div className="flex items-center justify-between px-2 text-neutral-500">
          <div className="flex items-center gap-2">
            <FaSun />
            <ModeToggle />
            <FaMoon />
          </div>
        </div>
      </div>

      <div className="gap-y-4 flex flex-col items-center justify-center w-full max-w-md">
        <div className="flex flex-col items-center justify-center">
          <div className="mb-4">
            <LogoWordMark className="w-32 fill-neutral-500" />
          </div>
          <div className="text-lg font-medium text-center">Two-factor authentication</div>
          <p className="text-sm text-neutral-500 text-center max-w-sm pt-1 pb-4">
            Your account is protected with a second factor. Choose how to confirm it&apos;s you.
          </p>
        </div>

        <div className="flex flex-col gap-6 justify-center p-5 md:p-6 border border-neutral-500/20 shadow-lg dark:shadow-2xl rounded-lg bg-neutral-200/10 dark:bg-neutral-800/40 backdrop-blur-lg w-full max-w-md">
          <MfaVerifyForm onSuccess={handleSuccess} />
        </div>
      </div>
    </div>
  )
}
