import { ProviderType } from '@/apollo/graphql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import SaveNewProviderCreds from '@/graphql/mutations/syncing/saveNewProviderCreds.gql'
import ValidateAWSAssumeRoleAuth from '@/graphql/queries/syncing/aws/validateAssumeRoleAuth.gql'
import ValidateAWSAssumeRoleCredentials from '@/graphql/queries/syncing/aws/validateAssumeRoleCredentials.gql'
import { useState, useEffect, useContext, Fragment, useCallback } from 'react'
import { FaQuestionCircle, FaExclamationTriangle } from 'react-icons/fa'
import { Button } from '../../common/Button'
import { useMutation, useLazyQuery } from '@apollo/client'
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
import { Alert } from '../../common/Alert'

interface CredentialState {
  [key: string]: string
}

interface ValidationResult {
  valid: boolean
  message: string
  method?: string
  error?: string
  assumedRoleArn?: string
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
  const [authValidation, setAuthValidation] = useState<ValidationResult | null>(null)
  const [credentialsValidation, setCredentialsValidation] = useState<ValidationResult | null>(null)

  const [saveNewCreds] = useMutation(SaveNewProviderCreds)
  const [validateAuth] = useLazyQuery(ValidateAWSAssumeRoleAuth)
  const [validateCredentials] = useLazyQuery(ValidateAWSAssumeRoleCredentials)

  const validateAssumeRoleCredentials = useCallback(async () => {
    if (!credentials['role_arn'] || credentials['role_arn'].trim() === '') {
      setCredentialsValidation(null)
      return
    }

    try {
      const { data } = await validateCredentials({
        variables: {
          roleArn: credentials['role_arn'],
          region: credentials['region'],
          externalId: credentials['external_id'] || null
        }
      })
      if (data?.validateAwsAssumeRoleCredentials) {
        setCredentialsValidation(data.validateAwsAssumeRoleCredentials)
      } else {
        setCredentialsValidation({
          valid: false,
          message: 'Validation query did not return expected data.',
          error: 'Empty or malformed response from validateAwsAssumeRoleCredentials query'
        });
      }
    } catch (error) {
      setCredentialsValidation({
        valid: false,
        message: 'Failed to validate role credentials',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }, [credentials, validateCredentials, setCredentialsValidation]);

  useEffect(() => {
    const initialCredentials: CredentialState = {}
    
    // Always initialize region
    initialCredentials['region'] = awsRegions[0].region
    
    if (tabIndex === 0) {
      // Access Keys tab - initialize access key fields
      initialCredentials['access_key_id'] = ''
      initialCredentials['secret_access_key'] = ''
      setName('AWS Access Keys credentials')
      setAuthValidation(null)
      setCredentialsValidation(null)
    } else {
      // Assume Role tab - initialize assume role fields
      initialCredentials['role_arn'] = ''
      initialCredentials['external_id'] = ''
      setName('AWS Assume Role credentials')
      
      // Validate assume role authentication when switching to assume role tab
      validateAssumeRoleAuth()
    }
    
    setCredentials(initialCredentials)
  }, [tabIndex])

  // Validate credentials when role ARN changes (for assume role tab)
  useEffect(() => {
    if (tabIndex === 1 && credentials['role_arn'] && credentials['role_arn'].trim() !== '') {
      validateAssumeRoleCredentials()
    } else {
      setCredentialsValidation(null)
    }
  }, [tabIndex, credentials, validateAssumeRoleCredentials, setCredentialsValidation])

  const validateAssumeRoleAuth = async () => {
    try {
      const { data } = await validateAuth()
      if (data?.validateAwsAssumeRoleAuth) {
        setAuthValidation(data.validateAwsAssumeRoleAuth)
      }
    } catch (error) {
      setAuthValidation({
        valid: false,
        message: 'Failed to validate assume role authentication',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleCredentialChange = (key: string, value: string) => {
    setCredentials({ ...credentials, [key]: value })
  }

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    // Determine the provider ID based on the selected tab
    const providerId = tabIndex === 0 ? 'aws' : 'aws_assume_role'

    // Create the appropriate provider object for encryption
    const providerForEncryption = tabIndex === 0 ? {
      // AWS Access Keys provider
      id: 'aws',
      name: 'AWS',
      expectedCredentials: ['access_key_id', 'secret_access_key', 'region'],
      optionalCredentials: []
    } : {
      // AWS Assume Role provider  
      id: 'aws_assume_role',
      name: 'AWS Assume Role',
      expectedCredentials: ['role_arn', 'region'],
      optionalCredentials: ['external_id']
    }

    const encryptedCredentials = JSON.stringify(
      await encryptProviderCredentials(providerForEncryption, credentials, props.serverPublicKey)
    )

    await saveNewCreds({
      variables: {
        orgId: organisation!.id,
        provider: providerId,
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
          <>
            <p>Use AWS STS to assume a role for temporary credentials. Ideal for cross-account access and enhanced security.</p>
            
            {/* Auth validation alert */}
            {authValidation && !authValidation.valid && (
              <Alert variant="warning" icon={true}>
                <div className="space-y-2">
                  <div className="font-medium">Assume Role Authentication Warning</div>
                  <div className="text-sm">{authValidation.message}</div>
                  {authValidation.method === 'none' && (
                    <div className="text-xs">
                      For Phase Cloud or self-hosted instances, set AWS_INTEGRATION_ACCESS_KEY_ID and AWS_INTEGRATION_SECRET_ACCESS_KEY environment variables.
                    </div>
                  )}
                </div>
              </Alert>
            )}
            
            {/* Auth validation success */}
            {authValidation && authValidation.valid && (
              <Alert variant="info" icon={true} size="sm">
                <div className="text-sm">
                  ✓ Phase can assume AWS roles using {authValidation.method === 'integration_credentials' ? 'integration credentials' : 'machine roles'}
                </div>
              </Alert>
            )}
          </>
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
          
          {/* Credential validation alerts */}
          {credentialsValidation && !credentialsValidation.valid && (
            <Alert variant="danger" icon={true} size="sm">
              <div className="space-y-1">
                <div className="font-medium">Role Validation Failed</div>
                <div className="text-xs">{credentialsValidation.message}</div>
              </div>
            </Alert>
          )}
          
          {credentialsValidation && credentialsValidation.valid && (
            <Alert variant="success" icon={true} size="sm">
              <div className="text-xs">
                ✓ Successfully validated role: {credentialsValidation.assumedRoleArn}
              </div>
            </Alert>
          )}
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
