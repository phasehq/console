'use client'

import { OrganisationType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { HeroPattern } from '@/components/common/HeroPattern'
import { Input } from '@/components/common/Input'
import Spinner from '@/components/common/Spinner'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'
import { RoleLabel } from '@/components/users/RoleLabel'
import { organisationContext } from '@/contexts/organisationContext'
import { CreateNewUserToken } from '@/graphql/mutations/users/createUserToken.gql'
import { OrganisationKeyring, cryptoUtils } from '@/utils/auth'
import { copyToClipBoard } from '@/utils/clipboard'
import { getUserKxPublicKey, getUserKxPrivateKey, encryptAsymmetric } from '@/utils/crypto'
import { generateUserToken } from '@/utils/environments'
import { getDevicePassword } from '@/utils/localStorage'
import { useMutation } from '@apollo/client'
import { Disclosure, Transition } from '@headlessui/react'
import axios from 'axios'
import clsx from 'clsx'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useContext, useEffect, useState } from 'react'
import { FaChevronRight, FaExclamationTriangle, FaCheckCircle, FaShieldAlt } from 'react-icons/fa'
import { MdContentCopy } from 'react-icons/md'
import { SiGithub, SiGnometerminal, SiSlack } from 'react-icons/si'
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

export default function WebAuth({ params }: { params: { requestCode: string } }) {
  const router = useRouter()
  const { organisations } = useContext(organisationContext)
  const [status, setStatus] = useState<
    'validating' | 'in progress' | 'success' | 'error' | 'invalid'
  >('validating')
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
        organisation,
        password
      )

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
      const decodedWebAuthReq = await cryptoUtils.decodeb64string(
        decodeURIComponent(params.requestCode)
      )
      const authRequestParams = getWebAuthRequestParams(decodedWebAuthReq)

      if (!authRequestParams.publicKey || !authRequestParams.requestedTokenName)
        setStatus('invalid')
      else {
        setStatus('in progress')
        setRequestParams(authRequestParams)
      }
    }

    validateWebAuthRequest()
  }, [params.requestCode])

  useEffect(() => {
    if (organisations?.length === 0) router.push('/signup')
  }, [organisations, router])

  const OrganisationSelectPanel = (props: {
    organisation: OrganisationType
    defaultOpen: boolean
  }) => {
    const { organisation, defaultOpen } = props

    const [password, setPassword] = useState<string>('')
    const [deviceIsTrusted, setDeviceIsTrusted] = useState(false)

    const handleSubmit = async (e: { preventDefault: () => void }) => {
      e.preventDefault()
      await authenticate(organisation, password)
    }

    useEffect(() => {
      const devicePassword = getDevicePassword(organisation.memberId!)

      if (devicePassword) {
        setPassword(devicePassword)
        setDeviceIsTrusted(true)
      }
    }, [organisation])

    return (
      <Disclosure
        as="div"
        defaultOpen={defaultOpen}
        className="ring-1 ring-inset ring-neutral-500/40 rounded-md p-px flex flex-col divide-y divide-neutral-500/30 w-full"
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
                  {deviceIsTrusted && (
                    <FaShieldAlt className="text-emerald-500" title="Trusted device" />
                  )}
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
                    <div className="flex justify-between w-full">
                      <Input
                        value={password}
                        setValue={setPassword}
                        label="Sudo password"
                        disabled={deviceIsTrusted}
                        secret={true}
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="py-1">
                    <Button variant="primary" type="submit">
                      Login
                    </Button>
                  </div>
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

      {status == 'validating' && (
        <div className="mx-auto my-auto">
          <Spinner size="xl" />
        </div>
      )}

      {status == 'in progress' && (
        <div className="mx-auto my-auto space-y-8">
          <div className="text-center">
            <div className="mx-auto flex justify-center py-2">
              <SiGnometerminal className="text-black/80 dark:text-white/80" size="40" />
            </div>
            <h1 className="text-black dark:text-white text-4xl font-semibold">
              CLI Authentication
            </h1>
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
        <div className="mx-auto my-auto text-center space-y-2">
          <div className="mx-auto flex justify-center">
            <FaCheckCircle className="text-emerald-500" size="40" />
          </div>
          <h1 className="text-black dark:text-white text-4xl font-semibold">
            CLI Authentication complete
          </h1>
          <p className="text-neutral-500 text-lg">
            You have logged into the Phase CLI as{' '}
            <code className="text-emerald-500">{session?.user?.email}</code>. <br /> You can head
            back to your terminal and close this screen now
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="mx-auto my-auto w-full max-w-3xl flex flex-col gap-6">
          <div className="w-full max-w-md text-center mx-auto">
            <div className="mx-auto flex justify-center">
              <FaExclamationTriangle className="text-amber-500" size="40" />
            </div>
            <h1 className="text-black dark:text-white text-4xl font-semibold">
              CLI Authentication error
            </h1>
            <p className="text-neutral-500 text-base">
              Something went wrong authenticating with the CLI. Please try the following steps:
            </p>
          </div>

          <ol className="text-left list-decimal list-inside text-black dark:text-white space-y-2">
            <li>
              Retry authentication with{' '}
              <code
                className="text-emerald-500 cursor-pointer"
                onClick={() => handleCopy('phase auth --mode token')}
              >
                phase auth --mode token
              </code>
              .
            </li>
            <li>Paste the following token into your terminal when prompted:</li>
          </ol>
          <div className="py-0">
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
              <code className="text-xs break-all text-blue-500 ph-no-capture">{userToken}</code>
            </div>
          </div>

          <div className="space-y-2 pt-20 text-center">
            <div className="text-neutral-500 text-sm">Still having issues? Get in touch.</div>
            <div className="flex items-center gap-2 justify-center">
              <a href="https://slack.phase.dev" target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  <SiSlack /> Slack
                </Button>
              </a>
              <a href="https://github.com/phasehq" target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  <SiGithub /> GitHub
                </Button>
              </a>
            </div>
          </div>
        </div>
      )}

      {status === 'invalid' && (
        <div className="mx-auto my-auto w-full max-w-3xl flex flex-col gap-6">
          <div className="w-full max-w-md text-center mx-auto">
            <div className="mx-auto flex justify-center py-2">
              <FaExclamationTriangle className="text-amber-500" size="40" />
            </div>
            <h1 className="text-black dark:text-white text-4xl font-semibold">
              CLI Authentication error
            </h1>
            <p className="text-neutral-500 text-base">
              This authentication link is invalid. Please try again.
            </p>
          </div>

          <div className="space-y-2 pt-20 text-center">
            <div className="text-neutral-500 text-sm">Still having issues? Get in touch.</div>
            <div className="flex items-center gap-2 justify-center">
              <a href="https://slack.phase.dev" target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  <SiSlack /> Slack
                </Button>
              </a>
              <a href="https://github.com/phasehq" target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  <SiGithub /> GitHub
                </Button>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
