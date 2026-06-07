'use client'

import { ProviderCredentialsType, RotatingSecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { Input } from '@/components/common/Input'
import { ProviderCredentialPicker } from '@/components/syncing/ProviderCredentialPicker'
import { organisationContext } from '@/contexts/organisationContext'
import { GetRotatingSecrets } from '@/graphql/queries/secrets/rotation/getRotatingSecrets.gql'
import { UpdateRotatingSecretOP } from '@/graphql/mutations/environments/secrets/rotation/updateRotatingSecret.gql'
import { useMutation } from '@apollo/client'
import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { toast } from 'react-toastify'

type EditRotatingSecretDialogRef = {
  openModal: () => void
  closeModal: () => void
}

interface EditRotatingSecretDialogProps {
  rotatingSecret: RotatingSecretType
}

const INTERVAL_PRESETS = [
  { label: '5 minutes', seconds: 300 },
  { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: '30 days', seconds: 2592000 },
  { label: '60 days', seconds: 5184000 },
  { label: '120 days', seconds: 10368000 },
]

const REVOCATION_DELAY_PRESETS = [
  { label: 'Instant', seconds: 0 },
  { label: '5 minutes', seconds: 300 },
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '15 days', seconds: 1296000 },
  { label: '30 days', seconds: 2592000 },
]

export const EditRotatingSecretDialog = forwardRef<
  EditRotatingSecretDialogRef,
  EditRotatingSecretDialogProps
>(({ rotatingSecret }, ref) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  useImperativeHandle(ref, () => ({
    openModal: () => dialogRef.current?.openModal(),
    closeModal: () => dialogRef.current?.closeModal(),
  }))

  const [name, setName] = useState(rotatingSecret.name)
  const [description, setDescription] = useState(rotatingSecret.description ?? '')
  const [intervalSeconds, setIntervalSeconds] = useState(
    rotatingSecret.rotationIntervalSeconds ?? 3600
  )
  const [revocationDelaySeconds, setRevocationDelaySeconds] = useState(
    rotatingSecret.revocationDelaySeconds ?? 0
  )
  const [credential, setCredential] = useState<ProviderCredentialsType | null>(
    (rotatingSecret.authentication as ProviderCredentialsType | null) ?? null
  )

  // Re-sync when the underlying rotating-secret data changes (e.g. background poll).
  useEffect(() => {
    setName(rotatingSecret.name)
    setDescription(rotatingSecret.description ?? '')
    setIntervalSeconds(rotatingSecret.rotationIntervalSeconds ?? 3600)
    setRevocationDelaySeconds(rotatingSecret.revocationDelaySeconds ?? 0)
    setCredential((rotatingSecret.authentication as ProviderCredentialsType | null) ?? null)
  }, [rotatingSecret])

  const [updateRotatingSecret, { loading: saving }] = useMutation(UpdateRotatingSecretOP)

  const handleCredentialChange = useCallback(
    (cred: ProviderCredentialsType) => setCredential(cred),
    []
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (intervalSeconds < 60) {
      toast.error('Rotation interval must be at least 60 seconds')
      return
    }
    if (revocationDelaySeconds < 0) {
      toast.error('Revocation delay cannot be negative')
      return
    }
    if (revocationDelaySeconds >= intervalSeconds) {
      toast.error('Revocation delay must be less than the rotation interval')
      return
    }
    if (!credential) {
      toast.error('Select root credentials')
      return
    }

    try {
      await updateRotatingSecret({
        variables: {
          rotatingSecretId: rotatingSecret.id,
          name,
          description,
          rotationIntervalSeconds: intervalSeconds,
          revocationDelaySeconds,
          authenticationId: credential.id,
        },
        refetchQueries: [
          {
            query: GetRotatingSecrets,
            variables: { orgId: organisation?.id, envId: rotatingSecret.environment?.id },
          },
        ],
      })
      toast.success('Rotating secret updated')
      dialogRef.current?.closeModal()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update rotating secret')
    }
  }

  return (
    <GenericDialog ref={dialogRef} title="Edit Rotating Secret" size="md">
      <form onSubmit={handleSubmit} className="space-y-4 pt-4 text-sm">
        <Input label="Name" required value={name} setValue={setName} />
        <Input
          label="Description"
          placeholder="Optional"
          value={description}
          setValue={setDescription}
        />

        <div>
          <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
            Root credentials
          </div>
          <div className="text-2xs text-neutral-500 mb-2">
            Provider-specific config (project, scopes, etc.) can&apos;t be changed —
            delete and recreate the rotating secret to change those.
          </div>
          {organisation && (
            <ProviderCredentialPicker
              credential={credential}
              setCredential={handleCredentialChange}
              orgId={organisation.id}
              providerFilter={rotatingSecret.provider ?? undefined}
            />
          )}
        </div>

        <div>
          <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
            Rotation interval
          </div>
          <div className="flex items-end gap-3 mt-2">
            <div className="w-28 shrink-0">
              <Input
                type="number"
                min={60}
                label="Seconds"
                value={String(intervalSeconds)}
                setValue={(v) => setIntervalSeconds(parseInt(v || '0', 10))}
                required
              />
            </div>
            <div className="flex gap-2 flex-1 min-w-0 flex-wrap">
              {INTERVAL_PRESETS.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  variant={intervalSeconds === p.seconds ? 'secondary' : 'ghost'}
                  onClick={() => setIntervalSeconds(p.seconds)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
            Revocation delay
          </div>
          <div className="text-2xs text-neutral-500">
            Must be less than the rotation interval. Set to 0 to revoke the previous
            credential immediately.
          </div>
          <div className="flex items-end gap-3 mt-2">
            <div className="w-28 shrink-0">
              <Input
                type="number"
                min={0}
                label="Seconds"
                value={String(revocationDelaySeconds)}
                setValue={(v) => setRevocationDelaySeconds(parseInt(v || '0', 10))}
              />
            </div>
            <div className="flex gap-2 flex-1 min-w-0 flex-wrap">
              {REVOCATION_DELAY_PRESETS.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  variant={revocationDelaySeconds === p.seconds ? 'secondary' : 'ghost'}
                  onClick={() => setRevocationDelaySeconds(p.seconds)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
          {revocationDelaySeconds >= intervalSeconds && (
            <div className="text-2xs text-red-500 mt-1">
              Revocation delay must be less than the rotation interval.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-neutral-500/20">
          <Button variant="secondary" type="button" onClick={() => dialogRef.current?.closeModal()}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" isLoading={saving}>
            Save changes
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
})

EditRotatingSecretDialog.displayName = 'EditRotatingSecretDialog'
