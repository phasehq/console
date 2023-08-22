import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useContext, useEffect, useState } from 'react'
import { FaEye, FaEyeSlash, FaTimes } from 'react-icons/fa'
import { Button } from '../common/Button'
import { KeyringContext } from '@/contexts/keyringContext'
import { cryptoUtils } from '@/utils/auth'
import { getLocalKeyring } from '@/utils/localStorage'
import { useSession } from 'next-auth/react'

export default function SudoPasswordDialog(props: { organisationId: string }) {
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
    if (!encryptedKeyring) throw 'Error fetching local encrypted keys from browser'
    const deviceKey = await cryptoUtils.deviceVaultKey(password, session?.user?.email!)
    const decryptedKeyring = await cryptoUtils.decryptAccountKeyring(encryptedKeyring!, deviceKey)
    if (!decryptedKeyring) throw 'Failed to decrypt keys'
    setKeyring(decryptedKeyring)
    closeModal()
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
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Unlock User Keyring
                    </h3>
                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>
                  <form onSubmit={decryptLocalKeyring}>
                    <div className="space-y-4 max-w-md mx-auto">
                      <label
                        className="block text-gray-700 text-sm font-bold mb-2"
                        htmlFor="password"
                      >
                        Sudo password
                      </label>
                      <div className="relative">
                        <input
                          id="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          type={showPw ? 'text' : 'password'}
                          minLength={16}
                          required
                          autoFocus
                          className="w-full "
                        />
                        <button
                          className="absolute inset-y-0 right-4"
                          type="button"
                          onClick={() => setShowPw(!showPw)}
                          tabIndex={-1}
                        >
                          {showPw ? <FaEyeSlash /> : <FaEye />}
                        </button>
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
