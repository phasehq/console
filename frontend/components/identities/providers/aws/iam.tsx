'use client'

import { useState, Fragment, useEffect, useMemo } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import GetAwsStsEndpoints from '@/graphql/queries/identities/getAwsStsEndpoints.gql'
import CreateIdentity from '@/graphql/mutations/identities/createIdentity.gql'
import UpdateIdentity from '@/graphql/mutations/identities/updateIdentity.gql'
import { Dialog, Transition, Combobox } from '@headlessui/react'
import { Input } from '@/components/common/Input'
import { Button } from '@/components/common/Button'
import { FaTimes, FaChevronDown, FaCheckCircle } from 'react-icons/fa'
import { LiaAws } from 'react-icons/lia'
import { toast } from 'react-toastify'
import clsx from 'clsx'
import { parseTTL, formatTTL, isValidTTL, getTTLExamples } from '@/utils/ttl'

type AwsIamConfig = {
  trustedPrincipals: string[]
  signatureTtlSeconds: number
  stsEndpoint: string
}

type Identity = {
  id: string
  provider: string
  name: string
  description?: string | null
  config: AwsIamConfig
  tokenNamePattern?: string | null
  defaultTtlSeconds: number
  maxTtlSeconds: number
}

type AwsStsEndpoint = {
  regionCode: string | null
  regionName: string
  endpoint: string
}

interface AwsIamIdentityDialogProps {
  isOpen: boolean
  onClose: () => void
  organisationId: string
  identity?: Identity | null
  onSuccess: () => void
}

export const AwsIamIdentityDialog = ({
  isOpen,
  onClose,
  organisationId,
  identity,
  onSuccess,
}: AwsIamIdentityDialogProps) => {
  const { data: stsData } = useQuery(GetAwsStsEndpoints)
  const [createIdentity, { loading: creating }] = useMutation(CreateIdentity)
  const [updateIdentity, { loading: updating }] = useMutation(UpdateIdentity)

  const [initialState, setInitialState] = useState<{
    name: string
    description: string
    trustedPrincipals: string
    signatureTtlInput: string
    signatureTtlSeconds: number
    stsEndpoint: string
    tokenNamePattern: string
    defaultTtlInput: string
    maxTtlInput: string
    defaultTtlSeconds: number
    maxTtlSeconds: number
  } | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [trustedPrincipals, setTrustedPrincipals] = useState('')
  const [signatureTtlInput, setSignatureTtlInput] = useState<string>('60s')
  const [signatureTtlSeconds, setSignatureTtlSeconds] = useState<number>(60)
  const [useCustomEndpoint, setUseCustomEndpoint] = useState<boolean>(false)
  const [stsEndpoint, setStsEndpoint] = useState<string>('https://sts.amazonaws.com')
  const [selectedStsEndpoint, setSelectedStsEndpoint] = useState<AwsStsEndpoint | null>(null)
  const [stsQuery, setStsQuery] = useState('')
  const [tokenNamePattern, setTokenNamePattern] = useState('')
  const [defaultTtlInput, setDefaultTtlInput] = useState<string>('1h')
  const [maxTtlInput, setMaxTtlInput] = useState<string>('24h')
  const [defaultTtlSeconds, setDefaultTtlSeconds] = useState<number>(3600)
  const [maxTtlSeconds, setMaxTtlSeconds] = useState<number>(86400)

  const awsStsEndpoints: AwsStsEndpoint[] = useMemo(() => {
    try {
      return (stsData?.awsStsEndpoints || []).map((raw: string) => JSON.parse(raw))
    } catch {
      return []
    }
  }, [stsData])

  const filteredStsEndpoints = awsStsEndpoints.filter((endpoint) => {
    if (stsQuery === '') {
      return true
    }
    const queryLower = stsQuery.toLowerCase()
    const regionNameMatches = endpoint.regionName?.toLowerCase().includes(queryLower) || false
    const regionCodeMatches = endpoint.regionCode?.toLowerCase().includes(queryLower) || false
    const endpointMatches = endpoint.endpoint?.toLowerCase().includes(queryLower) || false

    return regionNameMatches || regionCodeMatches || endpointMatches
  })

  const handleDefaultTtlChange = (value: string) => {
    setDefaultTtlInput(value)
    if (isValidTTL(value)) {
      setDefaultTtlSeconds(parseTTL(value))
    }
  }

  const handleMaxTtlChange = (value: string) => {
    setMaxTtlInput(value)
    if (isValidTTL(value)) {
      setMaxTtlSeconds(parseTTL(value))
    }
  }

  const handleSignatureTtlChange = (value: string) => {
    setSignatureTtlInput(value)
    if (isValidTTL(value)) {
      setSignatureTtlSeconds(parseTTL(value))
    }
  }

  const resetForm = () => {
    setName('')
    setDescription('')
    setTrustedPrincipals('')
    setSignatureTtlInput('60s')
    setSignatureTtlSeconds(60)
    setUseCustomEndpoint(false)
    setStsEndpoint('https://sts.amazonaws.com')
    setSelectedStsEndpoint(null)
    setStsQuery('')
    setTokenNamePattern('')
    setDefaultTtlInput('1h')
    setMaxTtlInput('24h')
    setDefaultTtlSeconds(3600)
    setMaxTtlSeconds(86400)
    setInitialState({
      name: '',
      description: '',
      trustedPrincipals: '',
      signatureTtlInput: '60s',
      signatureTtlSeconds: 60,
      stsEndpoint: 'https://sts.amazonaws.com',
      tokenNamePattern: '',
      defaultTtlInput: '1h',
      maxTtlInput: '24h',
      defaultTtlSeconds: 3600,
      maxTtlSeconds: 86400,
    })
  }

  useEffect(() => {
    if (isOpen) {
      if (identity) {
        // Populate form with identity data
        setName(identity.name)
        setDescription(identity.description || '')
        setTrustedPrincipals(identity.config.trustedPrincipals.join(', '))
        setSignatureTtlInput(formatTTL(identity.config.signatureTtlSeconds))
        setSignatureTtlSeconds(identity.config.signatureTtlSeconds)
        setStsEndpoint(identity.config.stsEndpoint)

        const existingEndpoint = awsStsEndpoints.find(
          (ep) => ep.endpoint === identity.config.stsEndpoint
        )
        setUseCustomEndpoint(!existingEndpoint)
        setSelectedStsEndpoint(existingEndpoint || null)
        setStsQuery('')

        setTokenNamePattern(identity.tokenNamePattern || '')
        setDefaultTtlInput(formatTTL(identity.defaultTtlSeconds))
        setMaxTtlInput(formatTTL(identity.maxTtlSeconds))
        setDefaultTtlSeconds(identity.defaultTtlSeconds)
        setMaxTtlSeconds(identity.maxTtlSeconds)
        setInitialState({
          name: identity.name,
          description: identity.description || '',
          trustedPrincipals: identity.config.trustedPrincipals.join(', '),
          signatureTtlInput: formatTTL(identity.config.signatureTtlSeconds),
          signatureTtlSeconds: identity.config.signatureTtlSeconds,
          stsEndpoint: identity.config.stsEndpoint,
          tokenNamePattern: identity.tokenNamePattern || '',
          defaultTtlInput: formatTTL(identity.defaultTtlSeconds),
          maxTtlInput: formatTTL(identity.maxTtlSeconds),
          defaultTtlSeconds: identity.defaultTtlSeconds,
          maxTtlSeconds: identity.maxTtlSeconds,
        })
      } else {
        resetForm()
        // Set default to Global (Legacy) endpoint if available
        if (awsStsEndpoints.length > 0) {
          const globalEndpoint = awsStsEndpoints.find(
            (ep) => ep.endpoint === 'https://sts.amazonaws.com'
          )
          if (globalEndpoint) {
            setSelectedStsEndpoint(globalEndpoint)
            setStsEndpoint(globalEndpoint.endpoint)
            setUseCustomEndpoint(false)
          }
        }
      }
    }
  }, [isOpen, identity, awsStsEndpoints])

  const handleSave = async () => {
    // Client-side guard to avoid firing mutation and duplicating toasts
    if (defaultTtlSeconds > maxTtlSeconds) {
      toast.error('Default token expiry must be less than or equal to Maximum token expiry')
      return
    }
    if (trustedPrincipals.trim() === '*') {
      toast.error("'*' is not allowed as a trusted principal pattern")
      return
    }
    if (!stsEndpoint || stsEndpoint.trim() === '') {
      toast.error('Please select an STS endpoint')
      return
    }

    try {
      if (identity) {
        await updateIdentity({
          variables: {
            id: identity.id,
            name,
            description: description || null,
            trustedPrincipals,
            signatureTtlSeconds,
            stsEndpoint,
            tokenNamePattern: tokenNamePattern || null,
            defaultTtlSeconds,
            maxTtlSeconds,
          },
        })
        toast.success('Identity updated')
      } else {
        await createIdentity({
          variables: {
            organisationId,
            provider: 'aws_iam',
            name,
            description: description || null,
            trustedPrincipals,
            signatureTtlSeconds,
            stsEndpoint,
            tokenNamePattern: tokenNamePattern || null,
            defaultTtlSeconds,
            maxTtlSeconds,
          },
        })
        toast.success('Identity created')
      }
      onSuccess()
      onClose()
    } catch (e: any) {
      const hasGraphQLErrors = Array.isArray(e?.graphQLErrors) && e.graphQLErrors.length > 0
      if (!hasGraphQLErrors) {
        toast.error('Failed to save identity')
      } else {
        toast.error(e.message)
      }
    }
  }

  const isSaving = creating || updating

  const hasChanges = useMemo(() => {
    if (!initialState) return true
    return (
      name !== initialState.name ||
      description !== initialState.description ||
      trustedPrincipals !== initialState.trustedPrincipals ||
      signatureTtlInput !== initialState.signatureTtlInput ||
      stsEndpoint !== initialState.stsEndpoint ||
      tokenNamePattern !== initialState.tokenNamePattern ||
      defaultTtlInput !== initialState.defaultTtlInput ||
      maxTtlInput !== initialState.maxTtlInput
    )
  }, [
    name,
    description,
    trustedPrincipals,
    signatureTtlInput,
    stsEndpoint,
    tokenNamePattern,
    defaultTtlInput,
    maxTtlInput,
    initialState,
  ])

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25 backdrop-blur-md" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <LiaAws className="text-3xl text-orange-500" />
                    <div>
                      <Dialog.Title
                        as="h3"
                        className="text-2xl font-semibold text-black dark:text-white"
                      >
                        AWS IAM Identity
                      </Dialog.Title>
                      <div className="text-neutral-500 text-sm">
                        Configure trusted entities and token settings
                      </div>
                    </div>
                  </div>
                  <Button variant="text" onClick={onClose} title="Close">
                    <FaTimes className="text-zinc-900 dark:text-zinc-400" />
                  </Button>
                </div>

                <div className="space-y-6 py-4">
                  <div className="space-y-2">
                    <Input
                      value={name}
                      setValue={setName}
                      label="Identity name"
                      placeholder="e.g. prod-ec2-identity"
                      required
                      maxLength={100}
                    />
                    <Input
                      value={description}
                      setValue={setDescription}
                      label="Description (optional)"
                      placeholder="e.g. production EC2 autoscaling group"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="font-medium text-black dark:text-white">Trusted entities</div>
                    <div className="space-y-2">
                      <label className="block text-neutral-500 text-sm font-bold mb-2">
                        Trusted principal ARNs <span className="text-red-500 ml-1">*</span>
                      </label>
                      <textarea
                        rows={2}
                        value={trustedPrincipals}
                        className="w-full"
                        onChange={(e) => setTrustedPrincipals(e.target.value)}
                        placeholder="arn:aws:iam::123456789012:user/MyUser, arn:aws:sts::123456789012:assumed-role/MyRole/*"
                        required
                      />
                    </div>
                    <Input
                      value={signatureTtlInput}
                      setValue={handleSignatureTtlChange}
                      label="Signatures expiry"
                      placeholder={getTTLExamples().join(', ')}
                      required
                    />
                    <div className="relative">
                      <Combobox
                        as="div"
                        value={useCustomEndpoint ? null : selectedStsEndpoint}
                        onChange={(endpoint: AwsStsEndpoint | null) => {
                          if (endpoint) {
                            setSelectedStsEndpoint(endpoint)
                            setStsEndpoint(endpoint.endpoint)
                            setUseCustomEndpoint(false)
                          }
                        }}
                      >
                        {({ open }) => (
                          <>
                            <div className="space-y-2">
                              <Combobox.Label as={Fragment}>
                                <label className="block text-neutral-500 text-sm">
                                  STS Endpoint <span className="text-red-500 ml-1">*</span>
                                </label>
                              </Combobox.Label>
                              <div className="w-full relative flex items-center">
                                <Combobox.Input
                                  className="w-full"
                                  onChange={(event) => setStsQuery(event.target.value)}
                                  required
                                  placeholder={
                                    stsQuery || selectedStsEndpoint ? '' : 'Select STS region'
                                  }
                                  displayValue={(endpoint: AwsStsEndpoint) => {
                                    if (useCustomEndpoint) {
                                      return 'Custom endpoint'
                                    }
                                    if (endpoint) {
                                      return `${endpoint.regionName} — ${endpoint.endpoint}`
                                    }
                                    return stsQuery || ''
                                  }}
                                />
                                <div className="absolute inset-y-0 right-2 flex items-center">
                                  <Combobox.Button>
                                    <FaChevronDown
                                      className={clsx(
                                        'text-neutral-500 transform transition ease cursor-pointer',
                                        open ? 'rotate-180' : 'rotate-0'
                                      )}
                                    />
                                  </Combobox.Button>
                                </div>
                              </div>
                            </div>
                            <Transition
                              enter="transition duration-100 ease-out"
                              enterFrom="transform scale-95 opacity-0"
                              enterTo="transform scale-100 opacity-100"
                              leave="transition duration-75 ease-out"
                              leaveFrom="transform scale-100 opacity-100"
                              leaveTo="transform scale-95 opacity-0"
                            >
                              <Combobox.Options as={Fragment}>
                                <div className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-b-md shadow-2xl z-20 absolute max-h-96 overflow-y-auto w-full border border-t-none border-neutral-500/20">
                                  {filteredStsEndpoints.map((endpoint: AwsStsEndpoint) => (
                                    <Combobox.Option
                                      as="div"
                                      key={`${endpoint.regionName}-${endpoint.regionCode || 'global'}`}
                                      value={endpoint}
                                    >
                                      {({ active, selected }) => (
                                        <div
                                          className={clsx(
                                            'flex items-center justify-between gap-2 p-2 cursor-pointer w-full border-b border-neutral-500/20',
                                            active && 'bg-zinc-300 dark:bg-zinc-700'
                                          )}
                                        >
                                          <div className="flex items-center gap-2">
                                            <LiaAws className="shrink-0 text-orange-500" />
                                            <div>
                                              <div className="font-semibold text-black dark:text-white">
                                                {endpoint.regionName}
                                              </div>
                                              <div className="text-neutral-500 text-2xs">
                                                {endpoint.endpoint}
                                              </div>
                                            </div>
                                          </div>
                                          {selected && (
                                            <FaCheckCircle className="shrink-0 text-emerald-500" />
                                          )}
                                        </div>
                                      )}
                                    </Combobox.Option>
                                  ))}
                                  <Combobox.Option
                                    as="div"
                                    value={null}
                                    onClick={() => {
                                      setUseCustomEndpoint(true)
                                      setSelectedStsEndpoint(null)
                                      setStsEndpoint('')
                                      setStsQuery('')
                                    }}
                                  >
                                    {({ active }) => (
                                      <div
                                        className={clsx(
                                          'flex items-center gap-2 p-2 cursor-pointer w-full',
                                          active && 'bg-zinc-300 dark:bg-zinc-700'
                                        )}
                                      >
                                        <LiaAws className="shrink-0 text-orange-500" />
                                        <div>
                                          <div className="font-semibold text-black dark:text-white">
                                            Custom endpoint
                                          </div>
                                          <div className="text-neutral-500 text-2xs">
                                            Specify your own STS endpoint
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </Combobox.Option>
                                </div>
                              </Combobox.Options>
                            </Transition>
                          </>
                        )}
                      </Combobox>
                    </div>
                    {useCustomEndpoint && (
                      <Input
                        value={stsEndpoint}
                        setValue={setStsEndpoint}
                        placeholder="https://sts.<region>.amazonaws.com"
                        required
                      />
                    )}
                  </div>

                  <div className="py-2">
                    <div className="border-b border-neutral-500/40 w-full"></div>
                  </div>

                  <div className="space-y-4">
                    <div className="font-medium text-black dark:text-white">
                      Token configuration
                    </div>
                    <Input
                      value={tokenNamePattern}
                      setValue={setTokenNamePattern}
                      label="Token name prefix or suffix"
                      placeholder="Optional identifier (e.g. prod, staging)"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Input
                        value={defaultTtlInput}
                        setValue={handleDefaultTtlChange}
                        label="Default TTL"
                        placeholder={getTTLExamples().join(', ')}
                        required
                      />
                      <Input
                        value={maxTtlInput}
                        setValue={handleMaxTtlChange}
                        label="Max TTL"
                        placeholder={getTTLExamples().join(', ')}
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end mt-4">
                    <Button
                      variant="primary"
                      onClick={handleSave}
                      isLoading={isSaving}
                      disabled={
                        !hasChanges ||
                        !name ||
                        !trustedPrincipals ||
                        !stsEndpoint ||
                        !isValidTTL(signatureTtlInput) ||
                        !isValidTTL(defaultTtlInput) ||
                        !isValidTTL(maxTtlInput)
                      }
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
