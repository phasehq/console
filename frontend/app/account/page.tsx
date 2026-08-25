'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { FaArrowLeft } from 'react-icons/fa'
import { useSession } from '@/contexts/userContext'
import { Avatar } from '@/components/common/Avatar'
import Spinner from '@/components/common/Spinner'
import SocialConnections from '@/components/account/SocialConnections'
import AccountNameEditor from '@/components/account/AccountNameEditor'
import EmailChangeDialog from '@/components/account/EmailChangeDialog'
import TwoFactorSection from '@/components/account/TwoFactorSection'
import DeleteAccountSection from '@/components/account/DeleteAccountSection'
import ReauthPromptDialog from '@/components/account/ReauthPromptDialog'

export default function AccountPage() {
  const { data: session, status } = useSession()

  if (status === 'loading')
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    )

  return (
    <div className="flex w-full justify-center px-4 pt-24 pb-16 text-zinc-900 dark:text-zinc-100">
      {/* Confirm-before-redirect prompt for the fresh-session gate */}
      <ReauthPromptDialog />
      <div className="w-full max-w-3xl space-y-6 divide-y divide-neutral-500/40">
        <div className="space-y-1">
          <Link
            href="/"
            className="text-neutral-500 flex items-center gap-2 text-sm hover:text-zinc-800 dark:hover:text-zinc-200 transition ease pb-2"
          >
            <FaArrowLeft /> Back home
          </Link>
          <h1 className="text-2xl font-semibold">Account</h1>
          <p className="text-sm text-neutral-500">
            Manage how you sign in to Phase. These settings apply to your account across all
            organisations.
          </p>
          <div className="flex items-center gap-3 pt-4">
            <Avatar user={session?.user} size="lg" />
            <div className="flex flex-col min-w-0">
              <AccountNameEditor />
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-neutral-500 truncate ph-no-capture">
                  {session?.user?.email}
                </span>
                <EmailChangeDialog />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6">
          <Suspense
            fallback={
              <div className="flex justify-center py-8">
                <Spinner size="md" />
              </div>
            }
          >
            <SocialConnections />
          </Suspense>
        </div>

        <div className="pt-6">
          <TwoFactorSection />
        </div>

        <div className="pt-6">
          <DeleteAccountSection />
        </div>
      </div>
    </div>
  )
}
