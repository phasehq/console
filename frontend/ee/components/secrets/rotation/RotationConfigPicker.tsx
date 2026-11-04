'use client'

import { RotationProviderResourceType } from '@/apollo/graphql'
import { Input } from '@/components/common/Input'
import { GetRotationProviderResources } from '@/graphql/queries/secrets/rotation/getRotationProviderResources.gql'
import { RotationConfigField } from '@/utils/rotation'
import { useQuery } from '@apollo/client'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { FaCheck, FaChevronDown } from 'react-icons/fa'

type PickerOption = { id: string; name: string; description?: string }

const asList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string' && value.trim()
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []

const FieldLabel = ({ field, helpLink }: { field: RotationConfigField; helpLink?: ReactNode }) => (
  <>
    <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
      {field.label}
      {field.required && <span className="text-red-500">*</span>}
      {helpLink}
    </div>
    {field.help_text && <div className="text-2xs text-neutral-500">{field.help_text}</div>}
  </>
)

const OptionsListbox = ({
  field,
  options,
  value,
  onChange,
  placeholder,
}: {
  field: RotationConfigField
  options: PickerOption[]
  value: unknown
  onChange: (value: unknown) => void
  placeholder: string
}) => {
  const multiple = field.field_type === 'list'
  const selectedIds = multiple ? asList(value) : []
  const selectedId = multiple ? '' : typeof value === 'string' ? value : ''

  const nameFor = (id: string) => options.find((o) => o.id === id)?.name ?? id
  const summary = multiple
    ? selectedIds.map(nameFor).join(', ')
    : selectedId
      ? (() => {
          const option = options.find((o) => o.id === selectedId)
          return option && option.name !== option.id ? `${option.name} (${option.id})` : selectedId
        })()
      : ''

  return (
    <Listbox
      value={multiple ? selectedIds : selectedId}
      onChange={(next: string | string[]) => onChange(next)}
      multiple={multiple}
    >
      {({ open }) => (
        <div className="relative">
          <Listbox.Button
            as="div"
            className={clsx(
              'px-2 py-1.5 flex items-center justify-between gap-2 bg-zinc-100 dark:bg-zinc-800/60 text-zinc-800 dark:text-white text-sm border border-neutral-500/20 cursor-pointer',
              open ? 'rounded-t-md' : 'rounded-md'
            )}
          >
            <span className={clsx('truncate', !summary && 'text-neutral-500')}>
              {summary || placeholder}
            </span>
            <FaChevronDown
              className={clsx(
                'shrink-0 transition-transform ease duration-300 text-neutral-500 text-xs',
                open ? 'rotate-180' : 'rotate-0'
              )}
            />
          </Listbox.Button>
          {options.length > 0 && (
            <Listbox.Options className="bg-zinc-100 w-full dark:bg-zinc-800/60 p-1.5 rounded-b-md shadow-2xl backdrop-blur-md absolute z-10 space-y-1 border border-t-0 border-neutral-500/20 max-h-60 overflow-auto">
              {options.map((option) => (
                <Listbox.Option key={option.id} value={option.id} as={Fragment}>
                  {({ active, selected }) => (
                    <div
                      className={clsx(
                        'flex items-center justify-between gap-2 px-2 py-1.5 cursor-pointer rounded-md text-sm text-black dark:text-white',
                        active && 'bg-zinc-200 dark:bg-zinc-700'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {multiple && (
                          <FaCheck
                            className={clsx(
                              'shrink-0 text-2xs text-emerald-500',
                              !selected && 'invisible'
                            )}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{option.name}</div>
                          {option.description && (
                            <div className="text-2xs text-neutral-500 truncate">
                              {option.description}
                            </div>
                          )}
                        </div>
                      </div>
                      {option.name !== option.id && (
                        <span className="font-mono text-2xs text-neutral-500 truncate">
                          {option.id}
                        </span>
                      )}
                    </div>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          )}
        </div>
      )}
    </Listbox>
  )
}

export const RotationChoicePicker = ({
  field,
  value,
  onChange,
  helpLink,
}: {
  field: RotationConfigField
  value: unknown
  onChange: (value: unknown) => void
  helpLink?: ReactNode
}) => (
  <div className="space-y-1">
    <FieldLabel field={field} helpLink={helpLink} />
    <OptionsListbox
      field={field}
      options={(field.choices ?? []).map((choice) => ({ id: choice, name: choice }))}
      value={value}
      onChange={onChange}
      placeholder={`Select ${field.label}`}
    />
  </div>
)

export const RotationResourcePicker = ({
  providerId,
  credentialId,
  field,
  value,
  onChange,
  config,
  helpLink,
}: {
  providerId: string
  credentialId?: string | null
  field: RotationConfigField
  value: unknown
  onChange: (value: unknown) => void
  config: Record<string, unknown>
  helpLink?: ReactNode
}) => {
  const dependencyKey = JSON.stringify(
    Object.fromEntries((field.depends_on ?? []).map((id) => [id, config[id] ?? null]))
  )
  // Debounced so typing into a dependency field doesn't fire a request per keystroke.
  const [scopedConfigKey, setScopedConfigKey] = useState(dependencyKey)
  useEffect(() => {
    const timer = setTimeout(() => setScopedConfigKey(dependencyKey), 400)
    return () => clearTimeout(timer)
  }, [dependencyKey])
  const scopedConfig = useMemo(() => JSON.parse(scopedConfigKey), [scopedConfigKey])

  // A value picked under the old dependencies may not exist under the new ones.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastKey = useRef(scopedConfigKey)
  useEffect(() => {
    if (lastKey.current === scopedConfigKey) return
    lastKey.current = scopedConfigKey
    onChangeRef.current(field.field_type === 'list' ? [] : '')
  }, [scopedConfigKey, field.field_type])

  const { data, loading, error } = useQuery(GetRotationProviderResources, {
    variables: {
      providerId,
      authenticationId: credentialId ?? '',
      resourceType: field.resource_type ?? '',
      config: scopedConfig,
    },
    skip: !credentialId || !field.resource_type,
    fetchPolicy: 'network-only',
  })

  const options: PickerOption[] = (
    (data?.rotationProviderResources ?? []) as Array<RotationProviderResourceType | null>
  )
    .filter((r): r is RotationProviderResourceType => Boolean(r))
    .map((r) => ({ id: r.id, name: r.name, description: r.description }))

  const multiple = field.field_type === 'list'

  return (
    <div className="space-y-1">
      <FieldLabel field={field} helpLink={helpLink} />
      {!credentialId ? (
        <div className="text-2xs text-neutral-500">
          Pick root credentials in the previous step to load options.
        </div>
      ) : error ? (
        <div className="space-y-1">
          <div className="text-2xs text-red-500">
            Couldn&apos;t load options: {error.message}. Enter{' '}
            {multiple ? 'comma-separated IDs' : 'the ID'} manually.
          </div>
          <Input
            className="font-mono ph-no-capture"
            value={multiple ? asList(value).join(', ') : typeof value === 'string' ? value : ''}
            setValue={(v) => onChange(v)}
          />
        </div>
      ) : (
        <OptionsListbox
          field={field}
          options={options}
          value={value}
          onChange={onChange}
          placeholder={
            loading ? 'Loading…' : options.length ? `Select ${field.label}` : 'No options found'
          }
        />
      )}
    </div>
  )
}
