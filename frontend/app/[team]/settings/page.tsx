'use client'

import { Alert } from '@/components/common/Alert'
import { Avatar } from '@/components/common/Avatar'
import { Button } from '@/components/common/Button'
import { ModeToggle } from '@/components/common/ModeToggle'
import { AccountSeedGen } from '@/components/onboarding/AccountSeedGen'
import { RoleLabel } from '@/components/users/RoleLabel'
import { organisationContext } from '@/contexts/organisationContext'
import { cryptoUtils } from '@/utils/auth'
import { Dialog, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { useSession } from 'next-auth/react'
import { Fragment, useContext, useState } from 'react'
import { FaEye, FaEyeSlash, FaLock, FaMoon, FaSun, FaTimes } from 'react-icons/fa'

const ViewRecoveryDialog = () => {
  const { activeOrganisation } = useContext(organisationContext)

  const { data: session } = useSession()

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [password, setPassword] = useState<string>('')
  const [showPw, setShowPw] = useState<boolean>(false)
  const [recovery, setRecovery] = useState<string>('')

  const handleDecryptRecovery = async (event: { preventDefault: () => void }) => {
    event.preventDefault()

    const deviceKey = await cryptoUtils.deviceVaultKey(password, session?.user?.email!)

    const decryptedRecovery = await cryptoUtils.decryptAccountRecovery(
      activeOrganisation?.recovery!,
      deviceKey
    )
    setRecovery(decryptedRecovery)
  }

  const reset = () => {
    setRecovery('')
    setPassword('')
  }

  const closeModal = () => {
    reset()
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <Alert variant="info" icon={true}>
          <div className="flex flex-col gap-2">
            <p>Your recovery phrase is encrypted.</p>

            <p>
              Backup your account recovery phrase in a safe place if you haven&apos;t already. If
              you forget your sudo password, it is the only way to restore your accout keys.
            </p>
          </div>
        </Alert>
        <div>
          <Button variant="primary" onClick={openModal} title="View recovery">
            <FaEye /> View recovery
          </Button>
        </div>
      </div>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={closeModal}>
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
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      View account recovery
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="py-4">
                    {recovery && <AccountSeedGen mnemonic={recovery} />}

                    {!recovery && (
                      <form onSubmit={handleDecryptRecovery}>
                        <div className="py-4">
                          <p className="text-neutral-500">
                            Please enter your <code>sudo</code> password to decrypt your account
                            recovery phrase.
                          </p>
                        </div>
                        <div className="flex justify-between items-end gap-4">
                          <div className="space-y-1 w-full">
                            <label
                              className="block text-gray-700 text-sm font-bold mb-2"
                              htmlFor="password"
                            >
                              Sudo password
                            </label>
                            <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 roudned-md focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
                              <input
                                id="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                type={showPw ? 'text' : 'password'}
                                minLength={16}
                                required
                                autoFocus
                                className="custom w-full text-zinc-800 font-mono dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md"
                              />
                              <button
                                className="bg-zinc-100 dark:bg-zinc-800 px-4 text-neutral-500 rounded-md"
                                type="button"
                                onClick={() => setShowPw(!showPw)}
                                tabIndex={-1}
                              >
                                {showPw ? <FaEyeSlash /> : <FaEye />}
                              </button>
                            </div>
                          </div>
                          <div>
                            <Button type="submit" variant="primary">
                              Unlock
                            </Button>
                          </div>
                        </div>
                      </form>
                    )}
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}

export default function Settings({ params }: { params: { team: string } }) {
  const { activeOrganisation } = useContext(organisationContext)

  const { data: session } = useSession()

  return (
    <section className="w-full max-w-screen-lg mx-auto space-y-10 divide-y divide-neutral-500/40 p-8 text-black dark:text-white">
      <h1 className="text-3xl font-semibold">Settings</h1>

      <div className="space-y-6 py-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold">Account</h2>
          <p className="text-neutral-500">Account information and recovery.</p>
        </div>
        <div className="py-4 whitespace-nowrap flex items-center gap-2">
          <Avatar imagePath={session?.user?.image!} size="xl" />
          <div className="flex flex-col gap-2">
            <div className="flex flex-col">
              <span className="text-lg font-medium">{session?.user?.name}</span>
              <span className="text-neutral-500 text-sm">{session?.user?.email}</span>
            </div>

            <div className="flex items-center gap-2">
              <RoleLabel role={activeOrganisation?.role!} />
              <span>at {activeOrganisation?.name}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="text-lg font-medium">Recovery phrase</div>
          <ViewRecoveryDialog />
        </div>

        <div className="flex flex-col gap-4">
          <div className="text-lg font-medium">Public key</div>
          <code className="font-mono text-neutral-500 bg-zinc-300 dark:bg-zinc-800 p-4 rounded-md">
            {activeOrganisation?.identityKey}
          </code>
        </div>
      </div>

      <div className="space-y-6 py-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold">App</h2>
          <p className="text-neutral-500">Control the behavior and appearance of UI elements.</p>
        </div>
        <div className="flex items-center gap-8">
          <div className="font-semibold">Theme</div>
          <div className="flex items-center gap-2">
            <FaSun />
            <ModeToggle />
            <FaMoon />
          </div>
        </div>
      </div>
    </section>
  )
}
