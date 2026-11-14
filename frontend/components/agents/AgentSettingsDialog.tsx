'use client'

import { FormEvent, useId, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { FaCheck, FaCog } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { AgentSelect } from '@/components/agents/AgentSelect'
import { AgentTime } from '@/components/agents/AgentUI'
import { UpdateAgentSettingsOp } from '@/graphql/mutations/agents/manageAgentSettings.gql'
import GetAgentSettings from '@/graphql/queries/agents/getAgentSettings.gql'
import {
  DURATION_UNITS,
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  customSeconds,
  describeDuration,
  settingsProblem,
  splitDuration,
  type DurationUnit,
} from '@/utils/agents/accessDuration'

type Amount = { amount: string; unit: DurationUnit }

const toAmount = (seconds: number): Amount => {
  const { amount, unit } = splitDuration(seconds)
  return { amount: String(amount), unit }
}

function DurationInput({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string
  label: string
  value: Amount
  onChange: (value: Amount) => void
  hint: string
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs text-neutral-500">
        {label}
      </label>
      <div className="flex items-start gap-2">
        <div className="w-28 shrink-0">
          <Input
            id={id}
            inputMode="numeric"
            maxLength={9}
            value={value.amount}
            setValue={(amount) => onChange({ ...value, amount: amount.replace(/[^0-9]/g, '') })}
          />
        </div>
        <div className="min-w-0 flex-1">
          <AgentSelect
            id={`${id}-unit`}
            value={value.unit}
            onChange={(unit) => onChange({ ...value, unit: unit as DurationUnit })}
            options={DURATION_UNITS.map((unit) => ({ value: unit.value, label: unit.label }))}
          />
        </div>
      </div>
      <p className="text-xs text-neutral-500">{hint}</p>
    </div>
  )
}

/** The form itself. It starts from the stored settings, so it is mounted once they are read. */
export function AgentSettingsForm({
  organisationId,
  settings,
  onSaved,
}: {
  organisationId: string
  settings: {
    maxRequestDurationSeconds: number
    defaultRequestDurationSeconds: number
    minDurationSeconds?: number
    maxDurationSeconds?: number
    updatedAt?: string | null
  }
  onSaved: () => void
}) {
  const id = useId()
  const bounds = {
    min: settings.minDurationSeconds ?? MIN_DURATION_SECONDS,
    max: settings.maxDurationSeconds ?? MAX_DURATION_SECONDS,
  }
  const [maximum, setMaximum] = useState(() => toAmount(settings.maxRequestDurationSeconds))
  const [fallback, setFallback] = useState(() => toAmount(settings.defaultRequestDurationSeconds))
  const [failure, setFailure] = useState('')
  const [save, { loading }] = useMutation(UpdateAgentSettingsOp)
  const maximumSeconds = customSeconds(maximum.amount, maximum.unit)
  const defaultSeconds = customSeconds(fallback.amount, fallback.unit)
  const problem = settingsProblem(maximumSeconds, defaultSeconds, bounds)
  const changed =
    maximumSeconds !== settings.maxRequestDurationSeconds ||
    defaultSeconds !== settings.defaultRequestDurationSeconds

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure('')
    if (problem || !changed) return
    try {
      await save({
        variables: {
          organisationId,
          maxRequestDurationSeconds: maximumSeconds,
          defaultRequestDurationSeconds: defaultSeconds,
        },
        refetchQueries: ['GetAgentSettings'],
        awaitRefetchQueries: true,
      })
      toast.success('Agent settings saved')
      onSaved()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not save the settings')
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 pt-4">
      <p className="text-xs text-neutral-500">
        How long access lasts when an Agent asks for it. You can still grant a different time, or
        until revoked, when you approve a request.
      </p>
      <DurationInput
        id={`${id}-max`}
        label="Longest an Agent may ask for"
        value={maximum}
        onChange={setMaximum}
        hint={`Between ${describeDuration(bounds.min)} and ${describeDuration(bounds.max)}. A longer request is refused.`}
      />
      <DurationInput
        id={`${id}-default`}
        label="Used when an Agent does not say"
        value={fallback}
        onChange={setFallback}
        hint="Cannot be longer than the maximum."
      />
      {problem && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {problem}
        </p>
      )}
      {failure && (
        <div role="alert">
          <Alert variant="danger" icon size="sm">
            <span className="text-xs">{failure}</span>
          </Alert>
        </div>
      )}
      {settings.updatedAt && (
        <p className="text-2xs text-neutral-500">
          Last changed <AgentTime value={settings.updatedAt} />
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          icon={FaCheck}
          isLoading={loading}
          disabled={!!problem || !changed}
          title={problem || (changed ? undefined : 'Nothing has changed.')}
        >
          Save settings
        </Button>
      </div>
    </form>
  )
}

function SettingsBody({
  organisationId,
  onSaved,
}: {
  organisationId: string
  onSaved: () => void
}) {
  const { data, loading, error } = useQuery(GetAgentSettings, {
    variables: { organisationId },
    fetchPolicy: 'cache-and-network',
  })
  const settings = data?.agentSettings
  if (!settings)
    return (
      <p className="pt-4 text-xs text-neutral-500" role={error ? 'alert' : 'status'}>
        {error ? error.message : loading ? 'Loading settings' : 'Settings are not available.'}
      </p>
    )
  return <AgentSettingsForm organisationId={organisationId} settings={settings} onSaved={onSaved} />
}

/** The organisation-wide limits on how long access an Agent may ask for lasts. */
export function AgentSettingsDialog({ organisationId }: { organisationId: string }) {
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  return (
    <GenericDialog
      ref={dialogRef}
      title="Agent settings"
      size="sm"
      buttonVariant="secondary"
      buttonContent="Settings"
      buttonProps={{ icon: FaCog }}
    >
      <SettingsBody
        organisationId={organisationId}
        onSaved={() => dialogRef.current?.closeModal()}
      />
    </GenericDialog>
  )
}
