'use client'

import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useContext, useEffect, useState } from 'react'
import { FaTimes } from 'react-icons/fa'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { PasswordStrengthMeter } from '@/components/common/PasswordStrengthMeter'
import { AccountSeedChecker } from '@/components/onboarding/AccountSeedChecker'
import { toast } from 'react-toastify'
import { useSession, useUser } from '@/contexts/userContext'
import { organisationContext } from '@/contexts/organisationContext'
import {
  deviceVaultKey,
  encryptAccountKeyring,
  encryptAccountRecovery,
  organisationKeyring,
  organisationSeed,
  passwordAuthHash,
} from '@/utils/crypto'
import { setDeviceKey } from '@/utils/localStorage'
import axios from 'axios'
import { UrlUtils } from '@/utils/auth'

const MNEMONIC_WORDS = 24

export function ChangePasswordSection() {
  const { user } = useUser()
  const { data: session } = useSession()
  const { activeOrganisation, organisations } = useContext(organisationContext)
  const hasOtherOrgs = (organisations?.length ?? 0) > 1

  const [isOpen, setIsOpen] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [mnemonicWords, setMnemonicWords] = useState<string[]>(
    Array(MNEMONIC_WORDS).fill('')
  )
  const [loading, setLoading] = useState(false)

  // Reset state every time the dialog reopens.
  useEffect(() => {
    if (!isOpen) {
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
      setMnemonicWords(Array(MNEMONIC_WORDS).fill(''))
      setLoading(false)
    }
  }, [isOpen])

  if (!user || user.authMethod !== 'password') return null

  const handleMnemonicWordUpdate = (newValue: string, index: number) => {
    // Pasting the full phrase into any field auto-fills all 24.
    const parts = newValue.trim().split(/\s+/)
    if (parts.length === MNEMONIC_WORDS) {
      setMnemonicWords(parts)
      return
    }
    setMnemonicWords((prev) => prev.map((w, i) => (i === index ? newValue : w)))
  }

  const performChange = async () => {
    const email = session?.user?.email!
    const orgId = activeOrganisation!.id
    const mnemonic = mnemonicWords.map((w) => w.trim()).join(' ')

    const seed = await organisationSeed(mnemonic, orgId)
    const keyring = await organisationKeyring(seed)

    if (keyring.publicKey !== activeOrganisation!.identityKey) {
      throw new Error('Recovery phrase does not match this organisation')
    }

    const [oldAuthHash, newAuthHash, newDeviceKey] = await Promise.all([
      passwordAuthHash(currentPw, email),
      passwordAuthHash(newPw, email),
      deviceVaultKey(newPw, email),
    ])

    const wrappedKeyring = await encryptAccountKeyring(keyring, newDeviceKey)
    const wrappedRecovery = await encryptAccountRecovery(mnemonic, newDeviceKey)

    await axios.post(
      UrlUtils.makeUrl(
        process.env.NEXT_PUBLIC_BACKEND_API_BASE!,
        'auth',
        'password',
        'change'
      ),
      {
        currentAuthHash: oldAuthHash,
        newAuthHash,
        orgId,
        identityKey: keyring.publicKey,
        wrappedKeyring,
        wrappedRecovery,
      },
      { withCredentials: true }
    )

    if (user.userId) setDeviceKey(user.userId, newDeviceKey)
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (newPw !== confirmPw) {
      toast.error("New passwords don't match")
      return
    }
    if (newPw.length < 16) {
      toast.error('Password must be at least 16 characters')
      return
    }
    if (mnemonicWords.some((w) => !w.trim())) {
      toast.error('Please enter your full recovery phrase')
      return
    }
    if (!session?.user?.email || !activeOrganisation) {
      toast.error('No active organisation — open an org and try again.')
      return
    }

    setLoading(true)
    // Yield to the browser so the loading spinner paints before the
    // memory-hard Argon2id derivations start. Without this the click
    // appears unresponsive while the main thread is locked up.
    await new Promise((r) => setTimeout(r, 50))

    try {
      await performChange()
      toast.success('Password changed successfully')
      setIsOpen(false)
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.error(err.response.data.error)
      } else if (err instanceof Error) {
        toast.error(err.message)
      } else {
        toast.error('Failed to change password.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4 border-t border-neutral-500/20 py-4">
        <div className="text-base font-medium">Change password</div>
        <p className="text-sm text-neutral-500 max-w-md">
          Update your password for this account.
        </p>
        <div>
          <Button variant="primary" onClick={() => setIsOpen(true)}>
            Change password
          </Button>
        </div>
      </div>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-10"
          onClose={() => !loading && setIsOpen(false)}
        >
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-md" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-3xl transform rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white">
                      Change password
                    </h3>
                    <Button
                      variant="text"
                      onClick={() => !loading && setIsOpen(false)}
                    >
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <form onSubmit={handleChangePassword} className="mt-4 space-y-6">
                    {hasOtherOrgs && (
                      <Alert variant="warning" size="sm" icon={true}>
                        You will need to recover your account keyring in other
                        organisations when you visit them.
                      </Alert>
                    )}

                    <div className="space-y-4 max-w-md">
                      <Input
                        id="current-password"
                        label="Current password"
                        value={currentPw}
                        setValue={setCurrentPw}
                        secret
                        required
                        minLength={16}
                      />
                      <div className="border-t border-neutral-500/20 pt-4" />
                      <Input
                        id="new-password"
                        label="New password"
                        value={newPw}
                        setValue={setNewPw}
                        secret
                        required
                        minLength={16}
                      />
                      <PasswordStrengthMeter password={newPw} />
                      <Input
                        id="confirm-password"
                        label="Confirm new password"
                        value={confirmPw}
                        setValue={setConfirmPw}
                        secret
                        required
                        minLength={16}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400">
                        Recovery phrase
                      </label>
                      <p className="text-xs text-neutral-500">
                        Required to re-encrypt your account keyring.
                      </p>
                      <AccountSeedChecker
                        mnemonic={''}
                        inputs={mnemonicWords}
                        updateInputs={handleMnemonicWordUpdate}
                        required={true}
                      />
                    </div>

                    <div className="mt-8 pt-4 flex items-center w-full justify-between">
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => setIsOpen(false)}
                        disabled={loading}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        variant="primary"
                        isLoading={loading}
                        disabled={loading}
                      >
                        Change password
                      </Button>
                    </div>
                  </form>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
