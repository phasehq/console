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
import { Card } from '@/components/common/Card'
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
      buttonContent="Create a Log Stream"
      buttonProps={{ icon: FaPlus }}
      buttonVariant="primary"
      size="lg"
      onClose={() => setProvider(null)}
    >
      {provider === null ? (
        <div className="space-y-4 pt-1">
          <div className="text-neutral-500 text-sm">
            Select a provider to continuously ship organisation audit logs and app secret logs
            to.
          </div>
          <div className="grid gap-2">
            {providers.map((providerOption) => (
              <div
                key={providerOption.id}
                className="cursor-pointer"
                onClick={() => setProvider(providerOption)}
              >
                <Card>
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">
                      <ProviderIcon providerId={providerOption.id} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {providerOption.name}
                      </div>
                      <div className="text-2xs text-neutral-500">
                        Ship logs to {providerOption.name}
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="pt-1 space-y-4">
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <ProviderIcon providerId={provider.id} />
            <span>
              Stream logs to{' '}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {provider.name}
              </span>
            </span>
          </div>
          <LogStreamForm
            provider={provider}
            initialValues={defaultLogStreamFormValues()}
            submitLabel="Create"
            submitting={loading}
            onSubmit={handleSubmit}
            footerActions={
              <Button
                type="button"
                variant="secondary"
                icon={FaArrowLeft}
                onClick={() => setProvider(null)}
                title="Choose a different provider"
              >
                Back
              </Button>
            }
          />
        </div>
      )}
    </GenericDialog>
  )
})

CreateLogStreamDialog.displayName = 'CreateLogStreamDialog'
