import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { AccountRecovery } from '@/components/onboarding/AccountRecovery'
import { organisationContext } from '@/contexts/organisationContext'
import { deviceVaultKey, decryptAccountRecovery } from '@/utils/crypto'
import { generateRecoveryPdf, copyRecoveryKit } from '@/utils/recovery'
import { Dialog, Transition } from '@headlessui/react'
import { useSession } from 'next-auth/react'
import { useContext, useState, Fragment } from 'react'
import { FaEye, FaTimes, FaEyeSlash } from 'react-icons/fa'
import { toast } from 'react-toastify'

export const ViewRecoveryDialog = () => {
  const { activeOrganisation } = useContext(organisationContext)

  const { data: session } = useSession()

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [password, setPassword] = useState<string>('')
  const [showPw, setShowPw] = useState<boolean>(false)
  const [recovery, setRecovery] = useState<string>('')
  const [isUnlocking, setIsUnlocking] = useState<boolean>(false)

  const handleDecryptRecovery = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    setIsUnlocking(true)

    try {
      // Add small delay to ensure loading state is visible for UX reasons
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const deviceKey = await deviceVaultKey(password, session?.user?.email!)

      const decryptedRecovery = await decryptAccountRecovery(activeOrganisation?.recovery!, deviceKey)
      setRecovery(decryptedRecovery)
    } catch (error) {
      toast.error("Invalid sudo password. Please check your password and try again.", {
        autoClose: 2000,
      })
    } finally {
      setIsUnlocking(false)
    }
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
                            <Button type="submit" variant="primary" isLoading={isUnlocking}>
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
