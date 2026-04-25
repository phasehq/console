'use client'

import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useContext, useEffect, useRef, useState } from 'react'
import { FaEye, FaEyeSlash, FaLock, FaSignOutAlt, FaUnlock } from 'react-icons/fa'
import { Button } from '../common/Button'
import { KeyringContext } from '@/contexts/keyringContext'
import { useSession } from '@/contexts/userContext'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { OrganisationType } from '@/apollo/graphql'
import { RoleLabel } from '../users/RoleLabel'
import { Avatar } from '../common/Avatar'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { handleSignout } from '@/apollo/client'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { decryptAccountKeyring, deviceVaultKey } from '@/utils/crypto'
import Spinner from '../common/Spinner'
import {
  getDevicePassword,
  deleteDevicePassword,
  setDeviceKey,
  getDeviceKey,
  deleteDeviceKey,
  setMemberDeviceKey,
  getMemberDeviceKey,
  deleteMemberDeviceKey,
} from '@/utils/localStorage'
import { useUser } from '@/contexts/userContext'

export default function UnlockKeyringDialog(props: { organisation: OrganisationType }) {
  const { organisation } = props

  const [password, setPassword] = useState<string>('')
  const [showPw, setShowPw] = useState<boolean>(false)

  const [trustDevice, setTrustDevice] = useState(false)

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [unlocking, setUnlocking] = useState(false)

  const { keyring, setKeyring } = useContext(KeyringContext)

  const [devicePasswordExists, setDevicePasswordExists] = useState<boolean>(false)

  const { data: session } = useSession()
  const { user } = useUser()
  const pathname = usePathname()
  const router = useRouter()

  let inputRef = useRef(null)

  const reset = () => {
    setPassword('')
    setShowPw(false)
  }

  // Decrypt the keyring directly with a known deviceKey (hex). Used for the
  // cached-key fast path; no password derivation needed.
  const decryptKeyringWithDeviceKey = async (deviceKey: string) => {
    if (!organisation.keyring) {
      throw new Error('Organisation has no wrapped keyring')
    }
    const decryptedKeyring = await decryptAccountKeyring(organisation.keyring, deviceKey)
    setKeyring(decryptedKeyring)
  }

  const decryptKeyring = (sudoPassword: string) => {
    return new Promise(async (resolve, reject) => {
      setUnlocking(true)
      setTimeout(async () => {
        try {
          const email = session?.user?.email!
          // Derive once; we both decrypt with this and (optionally) cache it.
          const deviceKey = await deviceVaultKey(sudoPassword, email)
          if (trustDevice) {
            // Password users have one deviceKey per account (auth ==
            // sudo password, server-enforced). SSO users can have a
            // distinct sudo password per org → cache per-membership.
            if (user?.authMethod === 'password' && user?.userId) {
              setDeviceKey(user.userId, deviceKey)
            } else if (organisation.memberId) {
              setMemberDeviceKey(organisation.memberId, deviceKey)
            }
          }
          await decryptKeyringWithDeviceKey(deviceKey)
          setUnlocking(false)
          reset()
          closeModal()
          resolve(true)
        } catch (e) {
          console.error(e)
          setUnlocking(false)
          reject(e)
        }
      }, 100)
    })
  }

  useEffect(() => {
    const IGNORE_PATHS = ['recovery']

    // Once the keyring is unlocked the dialog must close — both for the
    // explicit-password path (already calls closeModal) and the cached-
    // deviceKey auto-unlock path which only sets the keyring.
    if (keyring !== null) {
      closeModal()
      return
    }

    if (pathname && !IGNORE_PATHS.includes(pathname?.split('/')[2])) {
      openModal()
    } else {
      closeModal()
    }
  }, [keyring, pathname])

  useEffect(() => {
    // Wait for org data, user session, and userId before attempting auto-unlock.
    if (!organisation.id || !session?.user?.email || !user?.userId) return

    reset()

    const isPasswordUser = user.authMethod === 'password'

    // Preferred: cached deviceKey. Password users have a single per-user
    // entry (auth and sudo unified); SSO users have a per-membership entry.
    const cachedDeviceKey = isPasswordUser
      ? getDeviceKey(user.userId)
      : organisation.memberId
        ? getMemberDeviceKey(organisation.memberId)
        : null

    if (cachedDeviceKey) {
      setDevicePasswordExists(true)
      ;(async () => {
        try {
          await decryptKeyringWithDeviceKey(cachedDeviceKey)
        } catch (e) {
          // Stale cache. For password users, this signals a password
          // change in another org — the only correct fix is to route to
          // this org's keyring recovery, where the user's CURRENT login
          // password will be verified server-side and the keyring
          // rewrapped. Showing a password prompt here would accept the
          // OLD password and silently re-store an outdated deviceKey,
          // breaking the org they just changed password in.
          //
          // For SSO users there's no auth-vs-sudo coupling — different
          // sudo passwords across orgs are valid. Drop the stale entry
          // and fall through to the password prompt.
          if (isPasswordUser) {
            deleteDeviceKey(user.userId)
            router.push(`/${organisation.name}/recovery`)
          } else if (organisation.memberId) {
            deleteMemberDeviceKey(organisation.memberId)
            setDevicePasswordExists(false)
          }
        }
      })()
      return
    }

    // Legacy: per-membership stored password from before the deviceKey
    // scheme. Migrate transparently — derive the deviceKey, store it
    // under the appropriate new key, drop the old entry.
    const legacyPassword = getDevicePassword(organisation.memberId!)
    if (legacyPassword) {
      setDevicePasswordExists(true)
      setPassword(legacyPassword)
      ;(async () => {
        try {
          const email = session.user!.email!
          const deviceKey = await deviceVaultKey(legacyPassword, email)
          if (isPasswordUser) {
            setDeviceKey(user.userId, deviceKey)
          } else if (organisation.memberId) {
            setMemberDeviceKey(organisation.memberId, deviceKey)
          }
          deleteDevicePassword(organisation.memberId!)
          await decryptKeyringWithDeviceKey(deviceKey)
        } catch (e) {
          // Legacy password also failed. Password users → recovery
          // (auth/sudo unified, server-validated). SSO users → password
          // prompt (no server check applies).
          deleteDevicePassword(organisation.memberId!)
          if (isPasswordUser) {
            router.push(`/${organisation.name}/recovery`)
          } else {
            setDevicePasswordExists(false)
          }
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisation.id, session?.user?.email, user?.userId])

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleFormSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    toast.promise(decryptKeyring(password), {
      pending: 'Unlocking...',
      success: {
        render() {
          return 'Keyring unlocked.'
        },
        autoClose: 2000,
      },
      error: {
        render() {
          return 'Unlock failed! Please check your sudo password and try again.'
        },
        autoClose: 2000,
      },
    })
  }

  return (
    <>
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={() => {}} initialFocus={inputRef}>
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
                <Dialog.Panel className="w-full max-w-2xl transform rounded-2xl bg-white dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  {!devicePasswordExists && (
                    <Dialog.Title as="div" className="flex w-full gap-2 items-center">
                      <FaLock className='text-neutral-500'/>
                      <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                        Enter your <code className="text-neutral-500">sudo</code> password
                      </h3>
                    </Dialog.Title>
                  )}
                  {devicePasswordExists ? (
                    <div className="flex flex-col items-center justify-center gap-4 p-8">
                      <div className="font-medium text-lg text-neutral-500">
                        Initializing account keys...
                      </div>
                      <Spinner size="lg" />
                    </div>
                  ) : (
                    <form onSubmit={handleFormSubmit}>
                      <div className="pt-2 pb-4">
                        <p className="text-neutral-500">
                          This is required for data to be decrypted on this screen.
                        </p>
                      </div>

                      <div className="ring-1 ring-inset ring-neutral-500/40 shadow-lg p-4 rounded-lg bg-zinc-200 dark:bg-zinc-800 space-y-4">
                        <div className="flex justify-between">
                          <div className="flex flex-col gap-4">
                            <div className="whitespace-nowrap flex items-start gap-2">
                              <div className="pt-2">
                                <Avatar user={session?.user} size="md" />
                              </div>
                              <div className="flex flex-col gap-2">
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium text-black dark:text-white">
                                    {session?.user?.name}
                                  </span>
                                  <span className="text-neutral-500 text-2xs">
                                    {session?.user?.email}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-xs">
                                  <h2 className="font-semibold text-black dark:text-white">
                                    {organisation.name}
                                  </h2>
                                  <span className="text-neutral-500">
                                    <RoleLabel role={organisation.role!} />
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div>
                            <Button type="button" variant="outline" onClick={() => handleSignout()}>
                              <div className="flex items-center gap-1 text-xs">
                                <FaSignOutAlt /> Log out
                              </div>
                            </Button>
                          </div>
                        </div>

                        <div className="flex justify-between items-end gap-4">
                          <div className="space-y-2 w-full">
                            <label
                              className="block text-gray-700 text-sm font-bold mb-2"
                              htmlFor="password"
                            >
                            </label>
                            <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 roudned-md focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
                              <input
                                id="password"
                                ref={inputRef}
                                tabIndex={0}
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
                          <div className="pb-1">
                            <Button
                              type="submit"
                              variant="primary"
                              isLoading={unlocking}
                              disabled={unlocking}
                            >
                              <FaUnlock className="shrink-0" />
                              Unlock
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div
                            className={clsx(
                              'flex items-center gap-2 text-sm',
                              trustDevice ? 'text-emerald-500' : 'text-neutral-500'
                            )}
                          >
                            <ToggleSwitch
                              value={trustDevice}
                              onToggle={() => setTrustDevice(!trustDevice)}
                            />
                            Remember password
                          </div>
                        </div>

                        <div className="flex items-center justify-between border-t border-neutral-500/20 pt-4 mt-4">
                          <Link
                            className="text-xs text-neutral-500 hover:text-black dark:hover:text-white transition ease"
                            href={`/${organisation.name}/recovery`}
                          >
                            Forgot password?
                          </Link>
                        </div>
                      </div>
                    </form>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
