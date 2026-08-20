'use client'

import { FaMoon, FaSun } from 'react-icons/fa6'
import TotpVerifyForm, { TotpVerifySuccess } from '@/components/auth/TotpVerifyForm'
import { LogoWordMark } from '@/components/common/LogoWordMark'
import { ModeToggle } from '@/components/common/ModeToggle'

export default function LoginMfa() {
  const handleSuccess = (data: TotpVerifySuccess) => {
    const returnTo = data.returnTo
    const isSafe = !!returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
    window.location.href = isSafe ? (returnTo as string) : '/'
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

      <div className="gap-y-4 flex flex-col items-center justify-center">
        <div className="flex flex-col items-center justify-center">
          <div className="mb-4">
            <LogoWordMark className="w-32 fill-neutral-500" />
          </div>
          <div className="text-lg font-medium pb-4 text-center">Two-factor authentication</div>
        </div>

        <div className="flex flex-col gap-6 justify-center p-5 md:p-8 border border-neutral-500/20 shadow-lg dark:shadow-2xl rounded-lg bg-neutral-200/10 dark:bg-neutral-800/40 backdrop-blur-lg min-w-[320px]">
          <p className="text-sm text-neutral-500 text-center max-w-xs">
            Enter the 6-digit code from your authenticator app to finish signing in.
          </p>
          <TotpVerifyForm onSuccess={handleSuccess} />
        </div>
      </div>
    </div>
  )
}
