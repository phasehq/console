'use client'

import { OrganisationType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { HeroPattern } from '@/components/common/HeroPattern'
import { RoleLabel } from '@/components/users/RoleLabel'
import { KeyringContext } from '@/contexts/keyringContext'
import { organisationContext } from '@/contexts/organisationContext'
import { CreateNewUserToken } from '@/graphql/mutations/users/createUserToken.gql'
import { OrganisationKeyring, cryptoUtils } from '@/utils/auth'
import { getUserKxPublicKey, getUserKxPrivateKey, encryptAsymmetric } from '@/utils/crypto'
import { generateUserToken } from '@/utils/environments'
import { useMutation } from '@apollo/client'
import { Disclosure, Transition } from '@headlessui/react'
import axios from 'axios'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { useContext, useEffect, useState } from 'react'
import { FaEyeSlash, FaEye } from 'react-icons/fa'
import { toast } from 'react-toastify'

interface WebAuthRequestParams {
  port: number
  publicKey: string
  requestedTokenName: string
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
  const { organisations, activeOrganisation, setActiveOrganisation, loading } =
    useContext(organisationContext)
  const { keyring, setKeyring } = useContext(KeyringContext)

  const [createUserToken] = useMutation(CreateNewUserToken)

  const [requestParams, setRequestParams] = useState<WebAuthRequestParams | null>(null)

  const { data: session } = useSession()

  const handleCreatePat = (name: string, organisationId: string) => {
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
      if (keyring) resolve(keyring)
      else {
        const decryptedKeyring = await cryptoUtils.getKeyring(
          session?.user?.email!,
          organisation!.id,
          password
        )
        setKeyring(decryptedKeyring)
        resolve(decryptedKeyring)
      }
    })
  }

  const authenticate = async (organisation: OrganisationType, password: string) => {
    if (!requestParams) {
      toast.error('Invalid webauth request')
      return false
    }
    await validateKeyring(password, organisation)
    const pssUser = await handleCreatePat(requestParams.requestedTokenName, organisation.id)

    const encryptedUserToken = await encryptAsymmetric(pssUser, requestParams.publicKey)
    const encryptedEmail = await encryptAsymmetric(session?.user?.email!, requestParams.publicKey)

    console.log('POST to', `http://127.0.0.1:${requestParams.port}`)

    const cliResponse = await axios.post(`http://127.0.0.1:${requestParams.port}`, {
      email: encryptedEmail,
      pss: encryptedUserToken,
    })

    console.log('cliResponse', cliResponse)
  }

  useEffect(() => {
    const validateWebAuthRequest = async () => {
      if (pathname) {
        const hash = window.location.hash.replace('#', '')
        console.log('path n hash', pathname, hash)
        const decodedWebAuthReq = await cryptoUtils.decodeb64string(hash)
        const authRequestParams = getWebAuthRequestParams(decodedWebAuthReq)
        console.log('request params', authRequestParams)

        setRequestParams(authRequestParams)
      }
    }

    validateWebAuthRequest()
  }, [pathname])

  // useEffect(() => {
  //   if (requestParams && keyring && organisations?.length === 1) {
  //     authenticate(activeOrganisation!)
  //   }
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [activeOrganisation, keyring, organisations?.length, requestParams])

  const OrganisationSelectPanel = (props: { organisation: OrganisationType }) => {
    const { organisation } = props

    const [password, setPassword] = useState<string>('')
    const [showPw, setShowPw] = useState<boolean>(false)

    const handleSubmit = async () => {
      console.log('keyring', keyring)

      await authenticate(organisation, password)
    }

    return (
      <Disclosure>
        <Disclosure.Button>
          <div className="p-8 bg-zinc-100 dark:bg-zinc-800 flex flex-col gap-2 text-center">
            <h2 className="text-3xl font-bold text-black dark:text-white">{organisation.name}</h2>
            <div className="text-neutral-500">
              You are {organisation.role!.toLowerCase() === 'dev' ? 'a' : 'an'}{' '}
              <RoleLabel role={organisation.role!} /> in this organisation
            </div>
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
            <div className="space-y-4 w-full p-4 bg-zinc-100 dark:bg-zinc-800">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">
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
              <Button variant="primary" onClick={handleSubmit}>
                Submit
              </Button>
            </div>
          </Disclosure.Panel>
        </Transition>
      </Disclosure>
    )
  }

  return (
    <div className="flex h-screen w-full">
      {/* {activeOrganisation && <UnlockKeyringDialog organisationId={activeOrganisation.id} />} */}
      <HeroPattern />
      <div className="mx-auto my-auto flex flex-col divide-y divide-neutral-500/40">
        {organisations?.map((organisation) => (
          <OrganisationSelectPanel key={organisation.id} organisation={organisation} />
        ))}
      </div>
    </div>
  )
}
