'use client'

import { OrganisationType } from '@/apollo/graphql'
import UnlockKeyringDialog from '@/components/auth/UnlockKeyringDialog'
import { KeyringContext } from '@/contexts/keyringContext'
import { organisationContext } from '@/contexts/organisationContext'
import { CreateNewUserToken } from '@/graphql/mutations/users/createUserToken.gql'
import { getUserKxPublicKey, getUserKxPrivateKey, encryptAsymmetric } from '@/utils/crypto'
import { generateUserToken } from '@/utils/environments'
import { useMutation } from '@apollo/client'
import axios from 'axios'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/router'
import { useContext, useEffect, useState } from 'react'

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
  const { keyring } = useContext(KeyringContext)

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

  const authenticate = async (params: WebAuthRequestParams, organisation: OrganisationType) => {
    const pssUser = await handleCreatePat(params.requestedTokenName, organisation.id)

    const encryptedUserToken = await encryptAsymmetric(pssUser, params.publicKey)

    console.log('POST to', `http://localhost:${params.port}`)

    const cliResponse = await axios.post(`http://localhost:${params.port}`, {
      email: session?.user?.email,
      pss: encryptedUserToken,
    })

    console.log('cliResponse', cliResponse)
  }

  useEffect(() => {
    if (pathname) {
      const hash = window.location.hash.replace('#', '')
      console.log('path n hash', pathname, hash)
      const authRequestParams = getWebAuthRequestParams(hash)
      console.log('request params', authRequestParams)

      setRequestParams(authRequestParams)
    }
  }, [pathname])

  useEffect(() => {
    if (requestParams && keyring && organisations?.length === 1) {
      authenticate(requestParams, activeOrganisation!)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrganisation, keyring, organisations?.length, requestParams])

  return (
    <div className="h-screen w-full">
      {activeOrganisation && <UnlockKeyringDialog organisationId={activeOrganisation.id} />}
    </div>
  )
}
