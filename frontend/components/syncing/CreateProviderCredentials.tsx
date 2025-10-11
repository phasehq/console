import { ProviderType } from '@/apollo/graphql'
import GetProviderList from '@/graphql/queries/syncing/getProviders.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import SaveNewProviderCreds from '@/graphql/mutations/syncing/saveNewProviderCreds.gql'
import { useState, useEffect, useContext, Fragment } from 'react'
import { FaArrowRight } from 'react-icons/fa'
import { Button } from '../common/Button'
import { useMutation, useQuery } from '@apollo/client'
import { Input } from '../common/Input'
import { organisationContext } from '@/contexts/organisationContext'
import { toast } from 'react-toastify'
import { encryptProviderCredentials, isCredentialSecret } from '@/utils/syncing/general'
import { Card } from '../common/Card'
import { ProviderIcon } from './ProviderIcon'
import { AWSRegionPicker } from './AWS/AWSRegionPicker'
import { awsRegions } from '@/utils/syncing/aws'
import Link from 'next/link'
import { SetupGhAuth } from './GitHub/SetupGhAuth'
import { SetupAWSAuth } from './AWS/SetupAWSAuth'
import { MdMenuBook } from 'react-icons/md'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'

interface CredentialState {
  [key: string]: string
}

export const ProviderCard = (props: { provider: ProviderType }) => {
  const { provider } = props

  return (
    <Card>
      <div className="flex flex-auto gap-4 cursor-pointer">
        <div className="text-4xl">
          <ProviderIcon providerId={provider.id} />
        </div>
        <div className="flex flex-col gap-6 text-left">
          <div>
            <div className="text-black dark:text-white text-lg font-semibold">{provider.name}</div>
            <div className="text-neutral-500 text-sm">
              Set up authentication credentials to sync with {provider.name}.
            </div>
          </div>
          <div className="text-emerald-500 flex items-center gap-1 font-medium text-sm">
            Create <FaArrowRight />
          </div>
        </div>
      </div>
    </Card>
  )
}

export const CreateProviderCredentials = (props: {
  provider: ProviderType | null
  onComplete: () => void
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [provider, setProvider] = useState<ProviderType | null>(props.provider || null)
  const [authMethod, setAuthMethod] = useState<'oauth' | 'token'>('token')
  const [name, setName] = useState<string>('')
  const [credentials, setCredentials] = useState<CredentialState>({})

  const { data: providersData } = useQuery(GetProviderList)
  const [saveNewCreds] = useMutation(SaveNewProviderCreds)

  const providers: ProviderType[] = providersData?.providers ?? []

  useEffect(() => {
    const handleProviderChange = (provider: ProviderType) => {
      setProvider(provider)
      const initialCredentials: CredentialState = {}
      provider.expectedCredentials!.forEach((cred) => {
        initialCredentials[cred] = '' // Initialize each credential with an empty string
      })
      if (provider.optionalCredentials) {
        provider.optionalCredentials!.forEach((cred) => {
          initialCredentials[cred] = ''
        })
      }
      if (provider.id === 'aws' || provider.id === 'aws_assume_role')
        initialCredentials['region'] = awsRegions[0].region
      setCredentials(initialCredentials)

      if (name.length === 0) setName(`${provider.name} credentials`)
    }
    if (provider) handleProviderChange(provider)
  }, [provider])

  const handleCredentialChange = (key: string, value: string) => {
    setCredentials({ ...credentials, [key]: value })
  }

  const reset = () => {
    setProvider(null)
    setName('')
  }

  const docsLink = (provider: ProviderType) => {
    if (provider.id === 'cloudflare')
      return 'https://docs.phase.dev/integrations/platforms/cloudflare-pages'
    else if (provider.id === 'aws' || provider.id === 'aws_assume_role')
      return 'https://docs.phase.dev/integrations/platforms/aws-secrets-manager'
    else if (provider.id === 'hashicorp_vault')
      return 'https://docs.phase.dev/integrations/platforms/hashicorp-vault'
    else if (provider.id === 'hashicorp_nomad')
      return 'https://docs.phase.dev/integrations/platforms/hashicorp-nomad'
    else if (provider.id === 'github')
      return 'https://docs.phase.dev/integrations/platforms/github-actions'
    else if (provider.id === 'gitlab')
      return 'https://docs.phase.dev/integrations/platforms/gitlab-ci'
    else if (provider.id === 'railway')
      return 'https://docs.phase.dev/integrations/platforms/railway'
    else if (provider.id === 'vercel') return 'https://docs.phase.dev/integrations/platforms/vercel'
    else return 'https://docs.phase.dev/integrations'
  }

  const handleClickBack = () => {
    setProvider(null)
    setName('')
  }

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (provider === null) {
      return false
    }

    const encryptedCredentials = JSON.stringify(
      await encryptProviderCredentials(provider, credentials, providersData.serverPublicKey)
    )

    await saveNewCreds({
      variables: {
        orgId: organisation!.id,
        provider: provider?.id,
        name,
        credentials: encryptedCredentials,
      },
      refetchQueries: [
        {
          query: GetSavedCredentials,
          variables: {
            orgId: organisation!.id,
          },
        },
      ],
    })

    toast.success(`Saved ${name}`)
    props.onComplete()
  }

  const supportedAuthMethods = provider?.authScheme?.split(',') || []

  const toggleAuthMethod = () =>
    setAuthMethod((prevAuthMethod) => (prevAuthMethod === 'oauth' ? 'token' : 'oauth'))

  if (provider?.id === 'aws' || provider?.id === 'aws_assume_role') {
    return (
      <SetupAWSAuth
        provider={provider}
        serverPublicKey={providersData.serverPublicKey}
        onComplete={props.onComplete}
        onBack={handleClickBack}
      />
    )
  }

  return (
    <>
      <form className="space-y-6" onSubmit={handleSubmit}>
        {provider && (
          <div className="border-b border-neutral-500/20 pb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg">
              <ProviderIcon providerId={provider.id} />
              <span className="font-semibold text-black dark:text-white">{provider.name}</span>
            </div>
            <Link href={docsLink(provider)} target="_blank">
              <Button type="button" variant="outline">
                <MdMenuBook className="my-1 shrink-0" />
                Docs
              </Button>
            </Link>
          </div>
        )}

        {provider === null && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {providers
              .filter((provider) => provider.id !== 'aws_assume_role')
              .map((provider) => (
                <button key={provider.id} type="button" onClick={() => setProvider(provider)}>
                  <ProviderCard provider={provider} />
                </button>
              ))}
          </div>
        )}

        {provider && supportedAuthMethods.length > 1 && (
          <Tab.Group selectedIndex={authMethod === 'oauth' ? 0 : 1} onChange={toggleAuthMethod}>
            <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20">
              <Tab as={Fragment}>
                {({ selected }) => (
                  <div
                    className={clsx(
                      'p-3 font-medium border-b focus:outline-none text-black dark:text-white',
                      selected
                        ? 'border-emerald-500 font-semibold text-emerald-500'
                        : ' border-transparent cursor-pointer'
                    )}
                  >
                    GitHub OAuth
                  </div>
                )}
              </Tab>

              <Tab as={Fragment}>
                {({ selected }) => (
                  <div
                    className={clsx(
                      'p-3 font-medium border-b focus:outline-none text-black dark:text-white',
                      selected
                        ? 'border-emerald-500 font-semibold'
                        : ' border-transparent cursor-pointer'
                    )}
                  >
                    GitHub Token
                  </div>
                )}
              </Tab>
            </Tab.List>
          </Tab.Group>
        )}

        {authMethod === 'token' &&
          provider?.expectedCredentials
            .filter((credential) => credential !== 'region')
            .map((credential) => (
              <Input
                key={credential}
                value={credentials[credential]}
                setValue={(value) => handleCredentialChange(credential, value)}
                label={credential.replace(/_/g, ' ').toUpperCase()}
                required
                secret={isCredentialSecret(credential)}
              />
            ))}

        {authMethod === 'token' &&
          provider?.optionalCredentials
            .filter((credential) => credential !== 'region')
            .map((credential) => (
              <Input
                key={credential}
                value={credentials[credential]}
                setValue={(value) => handleCredentialChange(credential, value)}
                label={`${credential.replace(/_/g, ' ').toUpperCase()} (Optional)`}
                secret={isCredentialSecret(credential)}
              />
            ))}

        {(provider?.id === 'aws' || provider?.id === 'aws_assume_role') && (
          <AWSRegionPicker
            value={credentials['region']}
            onChange={(region) => handleCredentialChange('region', region)}
          />
        )}

        {provider && authMethod === 'token' && (
          <Input required value={name} setValue={(value) => setName(value)} label="Name" />
        )}

        {authMethod === 'token' && (
          <div className="flex justify-between">
            <Button variant="secondary" type="button" onClick={handleClickBack}>
              Back
            </Button>

            <Button variant="primary" type="submit">
              Save
            </Button>
          </div>
        )}
      </form>
      {provider?.id === 'github' && authMethod === 'oauth' && <SetupGhAuth />}
    </>
  )
}
