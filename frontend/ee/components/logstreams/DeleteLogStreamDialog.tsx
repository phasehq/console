import { useContext, useRef } from 'react'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaTrashCan } from 'react-icons/fa6'
import { LogStreamType } from '@/apollo/graphql'
import { DeleteLogStreamOp } from '@/graphql/mutations/logstreams/deleteLogStream.gql'
import { GetLogStreams } from '@/graphql/queries/logstreams/getLogStreams.gql'
import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'

export const DeleteLogStreamDialog = (props: {
  stream: LogStreamType
  onDeleted?: () => void
}) => {
  const { stream, onDeleted } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const [deleteLogStream, { loading }] = useMutation(DeleteLogStreamOp)

  const handleDelete = async () => {
    try {
      await deleteLogStream({
        variables: { streamId: stream.id },
        refetchQueries: [
          { query: GetLogStreams, variables: { organisationId: organisation?.id } },
        ],
      })
      toast.success('Log Stream deleted')
      dialogRef.current?.closeModal()
      onDeleted?.()
    } catch (error: any) {
      toast.error(error.message || 'Could not delete the Log Stream')
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Delete Log Stream"
      buttonVariant="danger"
      buttonContent="Delete"
      buttonProps={{ icon: FaTrashCan, type: 'button' }}
      size="sm"
    >
      <div className="space-y-4">
        <div className="py-4 text-sm text-neutral-500 space-y-2">
          <p>
            Are you sure you want to delete the{' '}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{stream.name}</span> Log
            Stream?
          </p>
          <p>
            Shipping will stop immediately and its delivery history will no longer be available.
            Events already stored in Phase are not affected.
          </p>
        </div>

        <div className="flex justify-between gap-2 pt-4">
          <Button variant="secondary" type="button" onClick={() => dialogRef.current?.closeModal()}>
            Cancel
          </Button>
          <Button
            variant="danger"
            type="button"
            onClick={handleDelete}
            isLoading={loading}
            icon={FaTrashCan}
          >
            Delete
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
