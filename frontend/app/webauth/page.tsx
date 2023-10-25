'use client'

import { OrganisationType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { HeroPattern } from '@/components/common/HeroPattern'
import { Logo } from '@/components/common/Logo'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'
import { RoleLabel } from '@/components/users/RoleLabel'
import { organisationContext } from '@/contexts/organisationContext'
import { CreateNewUserToken } from '@/graphql/mutations/users/createUserToken.gql'
import { OrganisationKeyring, cryptoUtils } from '@/utils/auth'
import { copyToClipBoard } from '@/utils/clipboard'
import { getUserKxPublicKey, getUserKxPrivateKey, encryptAsymmetric } from '@/utils/crypto'
import { generateUserToken } from '@/utils/environments'
import { useMutation } from '@apollo/client'
import { Disclosure, Transition } from '@headlessui/react'
import axios from 'axios'
import clsx from 'clsx'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { useContext, useEffect, useState } from 'react'
import { FaEyeSlash, FaEye, FaChevronRight } from 'react-icons/fa'
import { MdContentCopy } from 'react-icons/md'
import { toast } from 'react-toastify'

interface WebAuthRequestParams {
  port: number
  publicKey: string
  requestedTokenName: string
}

const handleCopy = (val: string) => {
  copyToClipBoard(val)
  toast.info('Copied', {
    autoClose: 2000,
  })
}

const getWebAuthRequestParams = (hash: string): WebAuthRequestParams => {
  const delimiter = '-'
  const params = hash.split(delimiter)

  return {
    port: Number(params[0]),
    publicKey: params[1],
    requestedTokenName: params[2],
  }
}

export default function WebAuth() {
  const pathname = usePathname()
  const { organisations } = useContext(organisationContext)
  const [status, setStatus] = useState<'in progress' | 'success' | 'error'>('in progress')
  const [userToken, setUserToken] = useState<string>('')

  const [createUserToken] = useMutation(CreateNewUserToken)

  const [requestParams, setRequestParams] = useState<WebAuthRequestParams | null>(null)

  const { data: session } = useSession()

  const handleCreatePat = (name: string, organisationId: string, keyring: OrganisationKeyring) => {
    return new Promise<string>(async (resolve, reject) => {
      if (keyring) {
        const userKxKeys = {
          publicKey: await getUserKxPublicKey(keyring.publicKey),
          privateKey: await getUserKxPrivateKey(keyring.privateKey),
        }

        const { pssUser, mutationPayload } = await generateUserToken(
          organisationId,
          userKxKeys,
          name,
          null
        )

        const { data } = await createUserToken({
          variables: mutationPayload,
        })

        if (data) resolve(pssUser)
        else reject('Failed to create user token')
      } else {
        reject('Keyring is locked')
      }
    })
  }

  const validateKeyring = async (password: string, organisation: OrganisationType) => {
    return new Promise<OrganisationKeyring>(async (resolve) => {
      const decryptedKeyring = await cryptoUtils.getKeyring(
        session?.user?.email!,
        organisation!.id,
        password
      )
      //setKeyring(decryptedKeyring)
      resolve(decryptedKeyring)
    })
  }

  const authenticate = async (organisation: OrganisationType, password: string) => {
    if (!requestParams) {
      toast.error('Invalid webauth request')
      setStatus('error')
      return false
    }

    try {
      const keyring = await validateKeyring(password, organisation)

      const pssUser = await handleCreatePat(
        requestParams.requestedTokenName,
        organisation.id,
        keyring
      )
      setUserToken(pssUser)

      const encryptedUserToken = await encryptAsymmetric(pssUser, requestParams.publicKey)
      const encryptedEmail = await encryptAsymmetric(session?.user?.email!, requestParams.publicKey)

      const cliResponse = await axios.post(`http://127.0.0.1:${requestParams.port}`, {
        email: encryptedEmail,
        pss: encryptedUserToken,
      })

      if (cliResponse.status === 200) {
        toast.success('CLI authentication complete')
        setStatus('success')
      } else {
        toast.error('Something went wrong.')
        setStatus('error')
      }
    } catch (error) {
      setStatus('error')
    }
  }

  useEffect(() => {
    const validateWebAuthRequest = async () => {
      if (pathname) {
        const hash = window.location.hash.replace('#', '')

        const decodedWebAuthReq = await cryptoUtils.decodeb64string(hash)
        const authRequestParams = getWebAuthRequestParams(decodedWebAuthReq)

        setRequestParams(authRequestParams)
      }
    }

    validateWebAuthRequest()
  }, [pathname])

  const OrganisationSelectPanel = (props: {
    organisation: OrganisationType
    defaultOpen: boolean
  }) => {
    const { organisation, defaultOpen } = props

    const [password, setPassword] = useState<string>('')
    const [showPw, setShowPw] = useState<boolean>(false)

    const handleSubmit = async (e: { preventDefault: () => void }) => {
      e.preventDefault()
      await authenticate(organisation, password)
    }

    return (
      <Disclosure
        as="div"
        defaultOpen={defaultOpen}
        className="ring-1 ring-inset ring-neutral-500/40 rounded-md p-px flex flex-col w-full"
      >
        {({ open }) => (
          <>
            <Disclosure.Button>
              <div
                className={clsx(
                  'p-4 flex justify-between items-center gap-8 transition ease  w-full',
                  open
                    ? 'bg-zinc-200 dark:bg-zinc-800 rounded-t-md'
                    : 'bg-zinc-300 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 rounded-md'
                )}
              >
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-semibold text-black dark:text-white">
                    {organisation.name}
                  </h2>
                  <span className="text-neutral-500">
                    <RoleLabel role={organisation.role!} />
                  </span>
                </div>
                <FaChevronRight
                  className={clsx(
                    'transform transition ease text-neutral-500',
                    open ? 'rotate-90' : 'rotate-0'
                  )}
                />
              </div>
            </Disclosure.Button>

            <Transition
              enter="transition duration-100 ease-out"
              enterFrom="transform scale-95 opacity-0"
              enterTo="transform scale-100 opacity-100"
              leave="transition duration-75 ease-out"
              leaveFrom="transform scale-100 opacity-100"
              leaveTo="transform scale-95 opacity-0"
            >
              <Disclosure.Panel>
                <form
                  onSubmit={handleSubmit}
                  className="flex items-end gap-4 justify-between p-4 bg-zinc-200 dark:bg-zinc-800"
                >
                  <div className="space-y-4 w-full ">
                    <label
                      className="block text-gray-700 text-sm font-bold mb-2"
                      htmlFor="password"
                    >
                      Sudo password
                    </label>
                    <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
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
                  <Button variant="primary" type="submit">
                    Login
                  </Button>
                </form>
              </Disclosure.Panel>
            </Transition>
          </>
        )}
      </Disclosure>
    )
  }

  return (
    <div className="flex h-screen w-full px-4">
      <HeroPattern />
      <OnboardingNavbar />

      {status == 'in progress' && (
        <div className="mx-auto my-auto space-y-8">
          <div className="text-center">
            <div className="mx-auto flex justify-center">
              <Logo boxSize={80} />
            </div>
            <h1 className="text-black dark:text-white text-4xl font-bold">CLI Auth</h1>
            <p className="text-neutral-500 text-lg">
              Choose an account below to authenticate with the Phase CLI
            </p>
          </div>
          <div className="flex flex-col gap-4 w-ful max-w-2xl">
            {organisations?.map((organisation, index) => (
              <OrganisationSelectPanel
                key={organisation.id}
                organisation={organisation}
                defaultOpen={index === 0}
              />
            ))}
          </div>
        </div>
      )}

      {status === 'success' && (
        <div className="mx-auto my-auto text-center">
          <div className="mx-auto flex justify-center">
            <Logo boxSize={80} />
          </div>
          <h1 className="text-black dark:text-white text-4xl font-bold">
            CLI Authentication complete
          </h1>
          <p className="text-neutral-500 text-lg">
            You can head back to your terminal and close this screen now
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="mx-auto my-auto w-full max-w-3xl flex flex-col gap-6">
          <div className="w-full max-w-md text-center mx-auto">
            <div className="mx-auto flex justify-center">
              <Logo boxSize={80} />
            </div>
            <h1 className="text-black dark:text-white text-4xl font-bold">
              CLI Authentication error
            </h1>
            <p className="text-neutral-500 text-lg">
              Something went wrong authenticating with the CLI. Please try the following steps:
            </p>
          </div>

          <ul className="text-left list-disc list-inside text-black dark:text-white">
            <li>
              If you are self-hosting Phase, please verify the url of your Phase Console instance
            </li>
            <li>
              Try authenticating with{' '}
              <code className="text-emerald-500">phase auth --mode token</code> and paste the
              following token into your terminal when prompted:
            </li>
          </ul>
          <div className="py-4">
            <div className="bg-blue-200 dark:bg-blue-400/10 shadow-inner p-3 rounded-lg">
              <div className="w-full flex items-center justify-between pb-4">
                <span className="uppercase text-xs tracking-widest text-gray-500">user token</span>
                <div className="flex gap-4">
                  {userToken && (
                    <Button variant="outline" onClick={() => handleCopy(userToken)}>
                      <MdContentCopy /> Copy
                    </Button>
                  )}
                </div>
              </div>
              <code className="text-xs break-all text-blue-500">{userToken}</code>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
