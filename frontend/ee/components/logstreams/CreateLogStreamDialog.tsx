import { forwardRef, useContext, useImperativeHandle, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaArrowLeft, FaPlus } from 'react-icons/fa'
import { LogStreamProviderType } from '@/apollo/graphql'
import { CreateNewLogStream } from '@/graphql/mutations/logstreams/createLogStream.gql'
import { GetLogStreams } from '@/graphql/queries/logstreams/getLogStreams.gql'
import { GetLogStreamProviders } from '@/graphql/queries/logstreams/getLogStreamProviders.gql'
import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { organisationContext } from '@/contexts/organisationContext'
import { LogStreamForm, LogStreamFormValues, defaultLogStreamFormValues } from './LogStreamForm'

export const CreateLogStreamDialog = forwardRef((_props, ref) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  const [provider, setProvider] = useState<LogStreamProviderType | null>(null)

  useImperativeHandle(ref, () => ({
    openModal: () => dialogRef.current?.openModal(),
  }))

  const { data: providersData } = useQuery(GetLogStreamProviders)
  const providers: LogStreamProviderType[] = providersData?.logStreamProviders ?? []

  const [createLogStream, { loading }] = useMutation(CreateNewLogStream)

  const handleSubmit = async (
    values: LogStreamFormValues,
    selectedProvider: LogStreamProviderType
  ) => {
    try {
      await createLogStream({
        variables: {
          organisationId: organisation!.id,
          name: values.name,
          provider: selectedProvider.id,
          credentialId: values.credential!.id,
          sources: values.sources,
          service: values.service,
          tags: values.tags,
          gzip: values.gzip,
          maxAttempts: values.maxAttempts,
        },
        refetchQueries: [
          { query: GetLogStreams, variables: { organisationId: organisation!.id } },
        ],
      })
      toast.success('Log Stream created')
      setProvider(null)
      dialogRef.current?.closeModal()
    } catch (error: any) {
      toast.error(error.message || 'Could not create the Log Stream')
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Create a Log Stream"
      buttonContent={
        <>
          <FaPlus /> Create a Log Stream
        </>
      }
      buttonVariant="primary"
      size="lg"
      onClose={() => setProvider(null)}
    >
      {provider === null ? (
        <div className="space-y-4 py-4">
          <div className="text-neutral-500 text-sm">
            Select a provider to continuously ship organisation audit logs and app secret logs
            to.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {providers.map((providerOption) => (
              <button
                key={providerOption.id}
                type="button"
                onClick={() => setProvider(providerOption)}
                className="flex items-center gap-3 rounded-lg border border-neutral-500/40 bg-zinc-100 dark:bg-zinc-800 px-4 py-3 text-left hover:border-emerald-500/60 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition ease"
              >
                <div className="text-2xl">
                  <ProviderIcon providerId={providerOption.id} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-black dark:text-white">
                    {providerOption.name}
                  </div>
                  <div className="text-2xs text-neutral-500">
                    Ship logs to {providerOption.name}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <ProviderIcon providerId={provider.id} />
              <span>
                Stream logs to{' '}
                <span className="font-semibold text-black dark:text-white">{provider.name}</span>
              </span>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setProvider(null)}
              title="Choose a different provider"
            >
              <FaArrowLeft /> Back
            </Button>
          </div>
          <LogStreamForm
            provider={provider}
            initialValues={defaultLogStreamFormValues()}
            submitLabel="Create"
            submitting={loading}
            onSubmit={handleSubmit}
          />
        </div>
      )}
    </GenericDialog>
  )
})

CreateLogStreamDialog.displayName = 'CreateLogStreamDialog'
