import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useContext, useEffect, useState } from 'react'
import { FaEye, FaEyeSlash, FaLock, FaTimes } from 'react-icons/fa'
import { Button } from '../common/Button'
import { KeyringContext } from '@/contexts/keyringContext'
import { cryptoUtils } from '@/utils/auth'
import { getLocalKeyring } from '@/utils/localStorage'
import { useSession } from 'next-auth/react'
import clsx from 'clsx'
import { toast } from 'react-toastify'

export default function UnlockKeyringDialog(props: { organisationId: string }) {
  const [password, setPassword] = useState<string>('')
  const [showPw, setShowPw] = useState<boolean>(false)
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const { keyring, setKeyring } = useContext(KeyringContext)
  const { data: session } = useSession()

  useEffect(() => {
    if (keyring === null) openModal()
  })

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const decryptLocalKeyring = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const encryptedKeyring = getLocalKeyring(props.organisationId)
    if (!encryptedKeyring) {
      toast.error('Error fetching local encrypted keys from browser')
      return false
    }
    try {
      const deviceKey = await cryptoUtils.deviceVaultKey(password, session?.user?.email!)
      const decryptedKeyring = await cryptoUtils.decryptAccountKeyring(encryptedKeyring!, deviceKey)
      setKeyring(decryptedKeyring)
      toast.success('Unlocked user keyring!', { autoClose: 2000 })
      closeModal()
    } catch (e) {
      console.log(`Error unlocking user keyring: ${e}`)
      toast.error('Failed to decrypt keys. Please verify your sudo password and try again.')
      return false
    }
  }

  return (
    <>
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={() => {}}>
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
                  <Dialog.Title as="div" className="flex w-full gap-2 items-center">
                    <FaLock
                      className={clsx(
                        keyring === null ? 'text-red-500' : 'text-emerald-500',
                        'transition-colors ease'
                      )}
                    />
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Unlock User Keyring
                    </h3>
                  </Dialog.Title>
                  <form onSubmit={decryptLocalKeyring}>
                    <div className="py-4">
                      <p className="text-neutral-500">
                        Please enter your <code>sudo</code> password to unlock the user keyring.
                        This is required for data to be decrypted on this screen.
                      </p>
                    </div>
                    <div className="flex justify-between items-end gap-4">
                      <div className="space-y-4 w-full">
                        <label
                          className="block text-gray-700 text-sm font-bold mb-2"
                          htmlFor="password"
                        >
                          Sudo password
                        </label>
                        <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-sm p-px">
                          <input
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            type={showPw ? 'text' : 'password'}
                            minLength={16}
                            required
                            autoFocus
                            className="custom w-full text-zinc-800 font-mono  dark:text-white"
                          />
                          <button
                            className="bg-zinc-100 dark:bg-zinc-800 px-4 text-neutral-500"
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
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
