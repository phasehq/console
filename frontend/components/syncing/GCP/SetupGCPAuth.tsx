import { ProviderType } from '@/apollo/graphql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import SaveNewProviderCreds from '@/graphql/mutations/syncing/saveNewProviderCreds.gql'
import GenerateGcpWorkloadIdentityKey from '@/graphql/mutations/syncing/gcp/generateGcpWorkloadIdentityKey.gql'
import ValidateGcpWorkloadIdentity from '@/graphql/mutations/syncing/gcp/validateGcpWorkloadIdentity.gql'
import { useMutation } from '@apollo/client'
import { useContext, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'react-toastify'
import { FaExternalLinkAlt } from 'react-icons/fa'
import { MdMenuBook } from 'react-icons/md'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { Alert } from '@/components/common/Alert'
import CopyButton from '@/components/common/CopyButton'
import { organisationContext } from '@/contexts/organisationContext'
import { encryptAsymmetric } from '@/utils/crypto'
import {
  GCP_INTEGRATIONS,
  GCP_POOL_ID,
  GCP_PROJECT_NUMBER_REGEX,
  GCP_PROJECT_SELECTOR_URL,
  gcpProviderIdForKey,
  gcpSetupScript,
  workloadIdentityProviderName,
} from '@/utils/syncing/gcp'
import { ProviderIcon } from '../ProviderIcon'
import { GCPScriptTabs } from './GCPScriptTabs'

type WorkloadIdentityKey = {
  issuer: string
  subject: string
  keyId: string
  jwks: string
  sealedIdentity: string
}

type Verification = { valid: boolean; error?: string | null }

const DOCS_LINK = 'https://docs.phase.dev/integrations/platforms/gcp-secret-manager'

export const SetupGCPAuth = (props: {
  provider: ProviderType
  serverPublicKey: string
  onComplete: () => void
  onBack: () => void
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [identity, setIdentity] = useState<WorkloadIdentityKey | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [projectNumber, setProjectNumber] = useState('')
  const [name, setName] = useState('Google Cloud credentials')
  const [nameIsCustom, setNameIsCustom] = useState(false)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [busy, setBusy] = useState(false)

  const [generateKey] = useMutation(GenerateGcpWorkloadIdentityKey)
  const [validateIdentity] = useMutation(ValidateGcpWorkloadIdentity)
  const [saveNewCreds] = useMutation(SaveNewProviderCreds)

  useEffect(() => {
    if (!organisation) return
    generateKey({ variables: { organisationId: organisation.id } })
      .then(({ data }) => {
        const key = data?.generateGcpWorkloadIdentityKey?.key
        setIdentity(key)
      })
      .catch((error) => setGenerationError(error.message))
    // Only ever mint one key per visit to this form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisation?.id])

  const projectNumberIsValid = GCP_PROJECT_NUMBER_REGEX.test(projectNumber.trim())
  const providerId = identity ? gcpProviderIdForKey(identity.keyId) : ''
  const canSave = !!identity && projectNumberIsValid

  // Names the project in the default, so credentials for several projects
  // are easy to tell apart. Stops following the number once edited.
  useEffect(() => {
    if (nameIsCustom) return
    setName(
      projectNumberIsValid
        ? `Google Cloud credentials (${projectNumber.trim()})`
        : 'Google Cloud credentials'
    )
  }, [projectNumber, projectNumberIsValid, nameIsCustom])

  // Phase picks the pool and provider IDs, so the project number completes
  // the provider name; nothing has to be copied back from Google Cloud.
  const buildCredentials = async () => ({
    sealed_identity: identity!.sealedIdentity,
    workload_identity_provider: await encryptAsymmetric(
      workloadIdentityProviderName(projectNumber, providerId),
      props.serverPublicKey
    ),
  })

  const save = async (credentials: Record<string, string>) => {
    await saveNewCreds({
      variables: {
        orgId: organisation!.id,
        provider: props.provider.id,
        name,
        credentials: JSON.stringify(credentials),
      },
      refetchQueries: [{ query: GetSavedCredentials, variables: { orgId: organisation!.id } }],
    })
    toast.success(`Saved ${name}`)
    props.onComplete()
  }

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    try {
      const credentials = await buildCredentials()
      // Google doesn't check the uploaded key, so a token exchange is the
      // first real test of the setup.
      const { data } = await validateIdentity({
        variables: { organisationId: organisation!.id, credentials: JSON.stringify(credentials) },
      })
      const result: Verification = data?.validateGcpWorkloadIdentity ?? {
        valid: false,
        error: 'Could not verify these credentials.',
      }
      setVerification(result)
      if (result.valid) await save(credentials)
    } catch (error: any) {
      toast.error(error?.message ?? 'Failed to save credentials')
    } finally {
      setBusy(false)
    }
  }

  const handleSaveUnverified = async () => {
    setBusy(true)
    try {
      await save(await buildCredentials())
    } catch (error: any) {
      toast.error(error?.message ?? 'Failed to save credentials')
    } finally {
      setBusy(false)
    }
  }

  const scriptTabs = GCP_INTEGRATIONS.map((integration) => ({
    name: integration.name,
    script:
      identity && projectNumberIsValid
        ? gcpSetupScript({
            projectNumber,
            providerId,
            issuer: identity.issuer,
            subject: identity.subject,
            jwks: identity.jwks,
            integration,
          })
        : null,
  }))

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="border-b border-neutral-500/20 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-lg">
          <ProviderIcon providerId="gcp" />
          <span className="font-semibold text-black dark:text-white">Google Cloud</span>
        </div>
        <Link href={DOCS_LINK} target="_blank">
          <Button type="button" variant="outline">
            <MdMenuBook className="my-1 shrink-0" />
            Docs
          </Button>
        </Link>
      </div>

      <p className="text-neutral-500 text-sm">
        Securely integrate Phase with your Google Cloud Platform (GCP) account using Workload
        Identity Federation (WIF).
      </p>

      {generationError && (
        <Alert variant="danger" icon>
          {generationError}
        </Alert>
      )}

      {identity && (
        <>
          <div className="space-y-3">
            <div className="font-medium text-black dark:text-white">
              1. Enter your Google Cloud project number
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline gap-x-3">
                <label htmlFor="gcp-project-number" className="shrink-0 text-neutral-500 text-xs">
                  Project number
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <p className="min-w-0 text-neutral-500 text-2xs">
                  <a
                    href={GCP_PROJECT_SELECTOR_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-500 inline-flex items-center gap-1"
                  >
                    List your projects in the Google Cloud console{' '}
                    <FaExternalLinkAlt className="text-2xs" />
                  </a>{' '}
                  and open the one that will hold the Workload Identity pool.
                </p>
              </div>
              <Input
                id="gcp-project-number"
                value={projectNumber}
                setValue={(value) => {
                  setProjectNumber(value)
                  setVerification(null)
                }}
                placeholder="123456789012"
                inputMode="numeric"
                required
              />
            </div>
            {projectNumber && !projectNumberIsValid && (
              <p className="text-red-500 text-xs">
                Enter the numeric project number, not the project ID.
              </p>
            )}
          </div>

          <div className="space-y-3">
            <div className="font-medium text-black dark:text-white">
              2. Add the Phase public key to your Workload Identity Pool
            </div>
            <GCPScriptTabs
              tabs={scriptTabs}
              placeholder="Enter your project number above to generate the setup script."
            />
            <p className="text-neutral-500 text-xs">
              Run this in{' '}
              <a
                href="https://shell.cloud.google.com/?show=terminal"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-500 inline-flex items-center gap-1"
              >
                Cloud Shell <FaExternalLinkAlt className="text-2xs" />
              </a>{' '}
              or any terminal where gcloud is signed in to the project. It creates a Workload
              Identity pool and provider that trust this key, and grants the roles the integration
              needs. It&apos;s safe to run again.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-2xs text-neutral-500">
              <span>
                Setting it up another way (Google Cloud Console, gcloud or Terraform)? Follow{' '}
                <a
                  href={`${DOCS_LINK}#step-2-add-the-phase-public-key-to-your-workload-identity-pool`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-500"
                >
                  the steps in the docs
                </a>{' '}
                with pool ID <code>{GCP_POOL_ID}</code>, provider ID <code>{providerId}</code> and
                this public key (JWKS):
              </span>
              <CopyButton value={identity.jwks} buttonVariant="ghost" title="Copy JWKS">
                <span className="text-2xs">Copy JWKS</span>
              </CopyButton>
            </div>
          </div>

          {verification && !verification.valid && (
            <Alert variant="danger" icon size="sm">
              <div className="space-y-1">
                <div className="font-medium">Google Cloud didn&apos;t accept this setup yet</div>
                <div className="text-xs">{verification.error}</div>
                <div className="text-xs">
                  If an admin will run the script later, copy it before you save: it isn&apos;t
                  shown again. IAM changes can also take a few minutes, so you can try again
                  shortly.
                </div>
              </div>
            </Alert>
          )}

          <Input
            required
            value={name}
            setValue={(value) => {
              setName(value)
              setNameIsCustom(true)
            }}
            label="Name"
            maxLength={64}
          />
        </>
      )}

      <div className="flex justify-between gap-2">
        <Button variant="secondary" type="button" onClick={props.onBack}>
          Back
        </Button>
        <div className="flex gap-2">
          {verification && !verification.valid && (
            <Button
              variant="outline"
              type="button"
              onClick={handleSaveUnverified}
              disabled={busy || !canSave}
            >
              Save anyway
            </Button>
          )}
          <Button variant="primary" type="submit" isLoading={busy} disabled={!canSave}>
            Verify and save
          </Button>
        </div>
      </div>
    </form>
  )
}
