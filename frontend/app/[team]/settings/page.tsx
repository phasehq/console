'use client'

import { Alert } from '@/components/common/Alert'
import { Avatar } from '@/components/common/Avatar'
import { Button } from '@/components/common/Button'
import { ModeToggle } from '@/components/common/ModeToggle'
import { AccountRecovery } from '@/components/onboarding/AccountRecovery'
import { RoleLabel } from '@/components/users/RoleLabel'
import { KeyringContext } from '@/contexts/keyringContext'
import { organisationContext } from '@/contexts/organisationContext'
import { cryptoUtils } from '@/utils/auth'
import { deleteDevicePassword, getDevicePassword } from '@/utils/localStorage'
import { copyRecoveryKit, generateRecoveryPdf } from '@/utils/recovery'
import { Dialog, Transition } from '@headlessui/react'
import { useSession } from 'next-auth/react'
import { Fragment, useContext, useEffect, useState } from 'react'
import { FaEye, FaEyeSlash, FaMoon, FaShieldAlt, FaSun, FaTimes } from 'react-icons/fa'
import { toast } from 'react-toastify'

const TrustedDeviceStatus = () => {
  const { activeOrganisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const [isTrusted, setIsTrusted] = useState(false)

  useEffect(() => {
    if (keyring !== null) {
      const devicePassword = getDevicePassword(activeOrganisation?.memberId!)
      if (devicePassword) setIsTrusted(true)
    }
  }, [activeOrganisation?.memberId, keyring])

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleRemovePassword = () => {
    deleteDevicePassword(activeOrganisation?.memberId!)
    setIsTrusted(false)
    closeModal()
  }

  return (
    <>
      {isTrusted && (
        <div className="flex flex-col gap-4 border-t border-neutral-500/20 py-4">
          <div className="text-lg font-medium">Device</div>
          <div>
            <div className="flex items-center gap-2 text-emerald-500 text-lg font-medium">
              <FaShieldAlt /> This device is trusted
            </div>
            <div className="text-neutral-500">
              Your <code>sudo</code> password is stored locally on this device.
            </div>
          </div>
          <div>
            <Button variant="danger" onClick={openModal}>
              <FaTimes /> Remove stored password
            </Button>
          </div>
        </div>
      )}

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
                <Dialog.Panel className="w-full max-w-screen-md transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Remove stored password
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="py-4">
                    <div className="text-neutral-500">
                      Are you sure you want to remove your password from this device? Doing so will
                      require manually unlocking your user keyring on this device when logging in.{' '}
                    </div>
                    <div className="flex justify-end">
                      <Button variant="danger" onClick={handleRemovePassword}>
                        Remove
                      </Button>
                    </div>
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

  const handleDownloadRecoveryKit = async () => {
    toast.promise(
      generateRecoveryPdf(
        recovery,
        session?.user?.email!,
        activeOrganisation!.name,
        session?.user?.name || undefined
      ),
      {
        pending: 'Generating recovery kit',
        success: 'Downloaded recovery kit',
      }
    )
  }

  const handleCopyRecoveryKit = () => {
    copyRecoveryKit(
      recovery,
      session?.user?.email!,
      activeOrganisation!.name,
      session?.user?.name || undefined
    )
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <Alert variant="info" icon={true}>
          <div className="flex flex-col gap-2">
            <p>Your account keys are encrypted.</p>

            <p>
              Store your account recovery kit in a safe place if you haven&apos;t already. If you
              forget your sudo password, it is the only way to restore your account keys.
            </p>
          </div>
        </Alert>
        <div>
          <Button variant="primary" onClick={openModal} title="View recovery">
            <FaEye /> View recovery info
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
                <Dialog.Panel className="w-full max-w-screen-md transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      View account recovery
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="py-4">
                    {recovery && (
                      <AccountRecovery
                        mnemonic={recovery}
                        onDownload={handleDownloadRecoveryKit}
                        onCopy={handleCopyRecoveryKit}
                      />
                    )}

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
                                className="custom w-full text-zinc-800 font-mono dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md ph-no-capture"
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

      {activeOrganisation && (
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

          <div className="flex flex-col gap-4 border-t border-neutral-500/20 py-4">
            <div className="text-lg font-medium">Recovery</div>
            <ViewRecoveryDialog />
          </div>

          <TrustedDeviceStatus />

          <div className="flex flex-col gap-4 border-t border-neutral-500/20 py-4">
            <div className="text-lg font-medium">Public key</div>
            <code className="font-mono text-neutral-500 bg-zinc-300 dark:bg-zinc-800 p-4 rounded-md">
              {activeOrganisation?.identityKey}
            </code>
          </div>
        </div>
      )}

      <div className="space-y-6 py-4 border-t border-neutral-500/20">
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
