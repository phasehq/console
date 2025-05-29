import { ProviderType } from '@/apollo/graphql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import SaveNewProviderCreds from '@/graphql/mutations/syncing/saveNewProviderCreds.gql'
import { useState, useEffect, useContext, Fragment } from 'react'
import { FaQuestionCircle } from 'react-icons/fa'
import { Button } from '../../common/Button'
import { useMutation } from '@apollo/client'
import { Input } from '../../common/Input'
import { organisationContext } from '@/contexts/organisationContext'
import { toast } from 'react-toastify'
import { encryptProviderCredentials } from '@/utils/syncing/general'
import { ProviderIcon } from '../ProviderIcon'
import { AWSRegionPicker } from './AWSRegionPicker'
import { awsRegions } from '@/utils/syncing/aws'
import Link from 'next/link'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'

interface CredentialState {
  [key: string]: string
}

export const SetupAWSAuth = (props: {
  provider: ProviderType
  serverPublicKey: string
  onComplete: () => void
  onBack: () => void
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  
  const [tabIndex, setTabIndex] = useState(0)
  const [name, setName] = useState<string>('AWS credentials')
  const [credentials, setCredentials] = useState<CredentialState>({})

  const [saveNewCreds] = useMutation(SaveNewProviderCreds)

  useEffect(() => {
    const initialCredentials: CredentialState = {}
    
    // Always initialize region
    initialCredentials['region'] = awsRegions[0].region
    
    if (tabIndex === 0) {
      // Access Keys tab - initialize access key fields
      initialCredentials['access_key_id'] = ''
      initialCredentials['secret_access_key'] = ''
      setName('AWS Access Keys credentials')
    } else {
      // Assume Role tab - initialize assume role fields
      initialCredentials['role_arn'] = ''
      initialCredentials['external_id'] = ''
      setName('AWS Assume Role credentials')
    }
    
    setCredentials(initialCredentials)
  }, [tabIndex])

  const handleCredentialChange = (key: string, value: string) => {
    setCredentials({ ...credentials, [key]: value })
  }

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    const encryptedCredentials = JSON.stringify(
      await encryptProviderCredentials(props.provider, credentials, props.serverPublicKey)
    )

    await saveNewCreds({
      variables: {
        orgId: organisation!.id,
        provider: props.provider.id,
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

  const docsLink = 'https://docs.phase.dev/integrations/platforms/aws-secrets-manager'

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="border-b border-neutral-500/20 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-lg">
          <ProviderIcon providerId="aws" />
          <span className="font-semibold text-black dark:text-white">AWS</span>
        </div>
        <Link href={docsLink} target="_blank">
          <Button type="button" variant="secondary">
            <FaQuestionCircle className="my-1 shrink-0" />
            Help
          </Button>
        </Link>
      </div>

      <Tab.Group selectedIndex={tabIndex} onChange={(index) => setTabIndex(index)}>
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
                Access Keys
              </div>
            )}
          </Tab>

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
                Assume Role
              </div>
            )}
          </Tab>
        </Tab.List>
      </Tab.Group>

      <div className="text-neutral-500 space-y-4">
        {tabIndex === 0 ? (
          <p>Use AWS Access Keys and Secret Access Keys for authentication.</p>
        ) : (
          <p>Use AWS STS to assume a role for temporary credentials. Ideal for cross-account access and enhanced security.</p>
        )}
      </div>

      {tabIndex === 0 ? (
        // Access Keys fields
        <>
          <Input
            value={credentials['access_key_id'] || ''}
            setValue={(value) => handleCredentialChange('access_key_id', value)}
            label="ACCESS KEY ID"
            required
            secret={false}
          />
          <Input
            value={credentials['secret_access_key'] || ''}
            setValue={(value) => handleCredentialChange('secret_access_key', value)}
            label="SECRET ACCESS KEY"
            required
            secret={true}
          />
        </>
      ) : (
        // Assume Role fields
        <>
          <Input
            value={credentials['role_arn'] || ''}
            setValue={(value) => handleCredentialChange('role_arn', value)}
            label="ROLE ARN"
            required
            secret={false}
          />
          <Input
            value={credentials['external_id'] || ''}
            setValue={(value) => handleCredentialChange('external_id', value)}
            label="EXTERNAL ID (Optional)"
            required={false}
            secret={false}
          />
        </>
      )}

      <AWSRegionPicker 
        value={credentials['region']} 
        onChange={(region) => handleCredentialChange('region', region)} 
      />

      <Input required value={name} setValue={(value) => setName(value)} label="Name" />

      <div className="flex justify-between">
        <Button variant="secondary" type="button" onClick={props.onBack}>
          Back
        </Button>

        <Button variant="primary" type="submit">
          Save
        </Button>
      </div>
    </form>
  )
}
