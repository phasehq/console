import { ReactNode, useContext, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaAngleDoubleDown, FaCheck, FaCheckCircle, FaVial } from 'react-icons/fa'
import clsx from 'clsx'
import {
  LogStreamProviderType,
  LogStreamSourceLagType,
  LogStreamSourceType,
  ProviderCredentialsType,
} from '@/apollo/graphql'
import { GetLogStreamProviders } from '@/graphql/queries/logstreams/getLogStreamProviders.gql'
import { TestLogStreamConnectionOp } from '@/graphql/mutations/logstreams/testLogStreamConnection.gql'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { ProviderCredentialPicker } from '@/components/syncing/ProviderCredentialPicker'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { organisationContext } from '@/contexts/organisationContext'
import { SourceIcon } from './sourceMeta'
import { humanizeLag, lagIsCritical } from './utils'

export type LogStreamFormValues = {
  name: string
  credential: ProviderCredentialsType | null
  sources: string[]
  service: string
  tags: string
  gzip: boolean
  maxAttempts: number
}

export const defaultLogStreamFormValues = (): LogStreamFormValues => ({
  name: '',
  credential: null,
  sources: [],
  service: 'phase-console',
  tags: '',
  gzip: true,
  maxAttempts: 5,
})

export const LogStreamForm = (props: {
  provider: LogStreamProviderType
  initialValues: LogStreamFormValues
  submitLabel: string
  submitting: boolean
  onSubmit: (values: LogStreamFormValues, provider: LogStreamProviderType) => void
  footerActions?: ReactNode
  sourceLags?: (LogStreamSourceLagType | null)[] | null
}) => {
  const {
    provider,
    initialValues,
    submitLabel,
    submitting,
    onSubmit,
    footerActions,
    sourceLags,
  } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: providersData } = useQuery(GetLogStreamProviders)
  const [testConnection, { loading: testing }] = useMutation(TestLogStreamConnectionOp)

  const allSources: LogStreamSourceType[] = providersData?.logStreamSources ?? []

  const [values, setValues] = useState<LogStreamFormValues>({
    ...initialValues,
    sources: initialValues.sources.length
      ? initialValues.sources
      : allSources.map((source) => source.id),
  })

  const setValue = <K extends keyof LogStreamFormValues>(
    key: K,
    value: LogStreamFormValues[K]
  ) => setValues((current) => ({ ...current, [key]: value }))

  const toggleSource = (sourceId: string) =>
    setValues((current) => ({
      ...current,
      sources: current.sources.includes(sourceId)
        ? current.sources.filter((id) => id !== sourceId)
        : [...current.sources, sourceId],
    }))

  const formValid =
    values.name.trim().length > 0 && values.credential !== null && values.sources.length > 0

  // Pristine forms must not fire a save — a no-op update still writes an
  // audit event and ships it.
  const normalize = (formValues: LogStreamFormValues) =>
    JSON.stringify({
      name: formValues.name.trim(),
      credential: formValues.credential?.id ?? null,
      sources: [...formValues.sources].sort(),
      service: formValues.service,
      tags: formValues.tags,
      maxAttempts: formValues.maxAttempts,
    })
  const dirty = normalize(values) !== normalize(initialValues)

  const lagBySource = Object.fromEntries(
    (sourceLags ?? []).filter(Boolean).map((lag) => [lag!.source, lag!.lagSeconds])
  ) as Record<string, number>

  // Stateless by design: tests whatever credential is currently selected,
  // saved or not.
  const handleTestConnection = async () => {
    if (!values.credential) {
      toast.error('Please select credentials to test the connection')
      return
    }
    try {
      const { data } = await testConnection({
        variables: {
          organisationId: organisation!.id,
          provider: provider.id,
          credentialId: values.credential.id,
          service: values.service,
          tags: values.tags,
          gzip: values.gzip,
        },
      })
      const result = data?.testLogStreamConnection
      if (result?.ok) toast.success(result.message || 'Connection successful')
      else toast.error(result?.message || 'Connection failed')
    } catch (error: any) {
      toast.error(error.message || 'Connection failed')
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formValid) return
    onSubmit(values, provider)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 py-4">
      <Input
        value={values.name}
        setValue={(value) => setValue('name', value)}
        label="Name"
        placeholder="e.g. Datadog production"
        required
        maxLength={64}
        data-autofocus
      />

      <div className="flex items-end gap-3">
        <div className="flex-1 min-w-0">
          <ProviderCredentialPicker
            credential={values.credential}
            setCredential={(credential) => setValue('credential', credential)}
            orgId={organisation!.id}
            providerFilter={provider.credentialsProvider?.id}
            setDefault={!initialValues.credential}
          />
        </div>
        <div className="shrink-0 pb-px">
          <Button
            type="button"
            variant="secondary"
            onClick={handleTestConnection}
            isLoading={testing}
            disabled={!values.credential}
            title="Validate the selected credentials against the provider — nothing is written, no save required"
          >
            <FaVial /> Test connection
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="block text-neutral-500 text-2xs">Event sources</div>
        <div className="space-y-2">
          {allSources.map((source) => (
            <div
              key={source.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-neutral-500/40 bg-zinc-100 dark:bg-zinc-800 px-4 py-2"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <SourceIcon sourceId={source.id} className="shrink-0 text-neutral-500" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-black dark:text-white">
                      {source.name}
                    </div>
                    {values.sources.includes(source.id) &&
                      lagBySource[source.id] !== undefined && (
                        <div
                          className={clsx(
                            'flex items-center gap-1 text-2xs shrink-0',
                            lagIsCritical(lagBySource[source.id], provider.maxEventAgeHours)
                              ? 'text-red-500'
                              : lagBySource[source.id] >= 60
                                ? 'text-amber-500'
                                : 'text-emerald-500'
                          )}
                          title="Shipping status for this source"
                        >
                          <FaCheckCircle />
                          {humanizeLag(lagBySource[source.id])}
                        </div>
                      )}
                  </div>
                  <div className="text-xs text-neutral-500 truncate">{source.description}</div>
                </div>
              </div>
              <div className="shrink-0">
                <ToggleSwitch
                  value={values.sources.includes(source.id)}
                  onToggle={() => toggleSource(source.id)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative flex items-center justify-center">
        <div className="absolute inset-x-0 border-t border-neutral-500/20" />
        <div className="relative bg-zinc-100 dark:bg-zinc-900 px-3 text-neutral-500">
          <FaAngleDoubleDown className="text-xs" />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <ProviderIcon providerId={provider.id} />
          <span className="font-medium text-black dark:text-white">
            {provider.name} destination
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={values.service}
            setValue={(value) => setValue('service', value)}
            label="Service name"
            placeholder="phase-console"
          />
          <Input
            value={values.tags}
            setValue={(value) => setValue('tags', value)}
            label="Tags (comma-separated key:value)"
            placeholder="env:prod,team:platform"
          />
        </div>

        <div className="w-40">
          <Input
            value={String(values.maxAttempts)}
            setValue={(value) =>
              setValue('maxAttempts', Math.max(1, Math.min(10, Number(value) || 1)))
            }
            label="Retry attempts"
            type="number"
            min={1}
            max={10}
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-neutral-500/20">
        <div>{footerActions}</div>
        <Button
          type="submit"
          variant="primary"
          isLoading={submitting}
          disabled={!formValid || !dirty}
          title={dirty ? undefined : 'No changes to save'}
        >
          <FaCheck /> {submitLabel}
        </Button>
      </div>
    </form>
  )
}
