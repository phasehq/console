import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useContext, useEffect, useState } from 'react'
import { FaEye, FaEyeSlash, FaLock, FaTimes, FaUnlock } from 'react-icons/fa'
import { Button } from '../common/Button'
import { KeyringContext } from '@/contexts/keyringContext'
import { cryptoUtils } from '@/utils/auth'
import { useSession } from 'next-auth/react'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { OrganisationType } from '@/apollo/graphql'
import { RoleLabel } from '../users/RoleLabel'
import { Avatar } from '../common/Avatar'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

export default function UnlockKeyringDialog(props: { organisation: OrganisationType }) {
  const { organisation } = props

  const [password, setPassword] = useState<string>('')
  const [showPw, setShowPw] = useState<boolean>(false)
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [unlocking, setUnlocking] = useState(false)

  const { keyring, setKeyring } = useContext(KeyringContext)
  const { data: session } = useSession()
  const pathname = usePathname()

  useEffect(() => {
    const IGNORE_PATHS = ['recovery']

    if (keyring === null) {
      if (pathname && !IGNORE_PATHS.includes(pathname?.split('/')[2])) {
        openModal()
      } else {
        closeModal()
      }
    }
  }, [keyring, pathname])

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const decryptKeyring = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    setUnlocking(true)

    try {
      const decryptedKeyring = await cryptoUtils.getKeyring(
        session?.user?.email!,
        organisation,
        password
      )
      setKeyring(decryptedKeyring)
      toast.success('Unlocked user keyring.', { autoClose: 2000 })
      setUnlocking(false)
      closeModal()
    } catch (e) {
      console.error(e)
      setUnlocking(false)
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
                  <form onSubmit={decryptKeyring}>
                    <div className="py-4">
                      <p className="text-neutral-500">
                        Please enter your <code>sudo</code> password to unlock the user keyring.
                        This is required for data to be decrypted on this screen.
                      </p>
                    </div>

                    <div className="ring-1 ring-inset ring-neutral-500/40 p-4 rounded-lg bg-zinc-200 dark:bg-zinc-800 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="whitespace-nowrap flex items-center gap-2">
                          <Avatar imagePath={session?.user?.image!} size="md" />
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-black dark:text-white">
                                {session?.user?.name}
                              </span>
                              <span className="text-neutral-500 text-2xs">
                                {session?.user?.email}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <h2 className="text-xl font-semibold text-black dark:text-white">
                            {organisation.name}
                          </h2>
                          <span className="text-neutral-500">
                            <RoleLabel role={organisation.role!} />
                          </span>
                        </div>
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
                          <Button type="submit" variant="primary" isLoading={unlocking}>
                            <FaUnlock /> Unlock
                          </Button>
                        </div>
                      </div>

                      <div className="flex">
                        <Link
                          className="text-xs text-neutral-500 hover:text-black dark:hover:text-white transition ease"
                          href={`/${organisation.name}/recovery`}
                        >
                          Forgot password
                        </Link>
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
