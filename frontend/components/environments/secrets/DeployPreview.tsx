import { SecretTagType, SecretType } from '@/apollo/graphql'
import { arraysEqual } from '@/utils/crypto'
import { Tag } from '../Tag'
import { Alert } from '@/components/common/Alert'
import GenericDialog from '@/components/common/GenericDialog'
import { GoDotFill } from 'react-icons/go'
import clsx from 'clsx'
type ChangeDetail = {
  old: string | SecretTagType[]
  new: string | SecretTagType[]
}

type SecretChange = {
  type: 'Added' | 'Modified'
  secretName: string
  key?: ChangeDetail
  value?: ChangeDetail
  comment?: ChangeDetail
  tags?: ChangeDetail
}

type DeployPreviewProps = {
  clientSecrets: SecretType[]
  serverSecrets: SecretType[]
  secretsToDelete: string[]
}

export const DeployPreview: React.FC<DeployPreviewProps> = ({
  clientSecrets,
  serverSecrets,
  secretsToDelete,
}) => {
  const getChanges = (): Record<string, SecretChange> => {
    const changes: Record<string, SecretChange> = {}

    clientSecrets.forEach((updatedSecret) => {
      const originalSecret = serverSecrets.find(
        (serverSecrets) => serverSecrets.id === updatedSecret.id
      )

      if (!originalSecret) {
        changes[updatedSecret.key] = {
          type: 'Added',
          secretName: updatedSecret.key,
          key: {
            old: '',
            new: updatedSecret.key,
          },
          value: {
            old: '',
            new: updatedSecret.value,
          },
          comment: {
            old: '',
            new: updatedSecret.comment,
          },
          tags: {
            old: [],
            new: updatedSecret.tags,
          },
        }
        return
      }

      const secretChanges: Partial<SecretChange> = {
        type: 'Modified',
        secretName: originalSecret.key,
      }

      if (originalSecret.key !== updatedSecret.key) {
        secretChanges.key = {
          old: originalSecret.key,
          new: updatedSecret.key,
        }
      }

      if (originalSecret.value !== updatedSecret.value) {
        secretChanges.value = {
          old: originalSecret.value,
          new: updatedSecret.value,
        }
      }

      if (originalSecret.comment !== updatedSecret.comment) {
        secretChanges.comment = {
          old: originalSecret.comment || '',
          new: updatedSecret.comment,
        }
      }

      if (!arraysEqual(originalSecret.tags, updatedSecret.tags)) {
        secretChanges.tags = {
          old: originalSecret.tags,
          new: updatedSecret.tags,
        }
      }

      if (secretChanges.key || secretChanges.value || secretChanges.comment || secretChanges.tags) {
        changes[updatedSecret.key] = secretChanges as SecretChange
      }
    })

    return changes
  }

  const DisplayChanges = ({ change }: any) => {
    const removedTags =
      change.tags?.old?.filter(
        (tag: SecretTagType) =>
          !change.tags?.new?.some((newTag: SecretTagType) => newTag.id === tag.id)
      ) || []
    const addedTags =
      change.tags?.new?.filter(
        (tag: SecretTagType) =>
          !change.tags?.old?.some((oldTag: SecretTagType) => oldTag.id === tag.id)
      ) || []

    return (
      <div className="flex flex-col ml-6 text-md space-y-[0.15rem]">
        {change.key?.new && change.type == 'Modified' && (
          <div className="flex flex-row space-x-2 flex-wrap items-center text-sm">
            <p className="text-zinc-500 mr-1 font-mono">KEY:</p>
            {change.key?.old && (
              <p className="bg-red-200 dark:bg-red-950 text-red-500 ph-no-capture line-through font-mono">
                {change.key.old}
              </p>
            )}
            <p
              className={
                change.type == 'Added'
                  ? 'text-zinc-900 dark:text-zinc-100 font-mono'
                  : 'dark:bg-emerald-400/10 bg-emerald-400/20 text-emerald-500 ph-no-capture ml-1 font-mono'
              }
            >
              {change.key.new}
            </p>
          </div>
        )}
        {change.value?.new && (
          <div className="flex flex-row space-x-1 flex-wrap items-center text-sm">
            <p className="text-zinc-500 mr-1 font-mono">VALUE:</p>
            {change.value?.old && (
              <p className="bg-red-200 dark:bg-red-950 text-red-500 ph-no-capture line-through font-mono break-all">
                {change.value.old}
              </p>
            )}
            <p
              className={clsx(
                'break-all',
                change.type == 'Added'
                  ? 'text-zinc-900 dark:text-zinc-100 font-mono'
                  : 'dark:bg-emerald-400/10 bg-emerald-400/20 text-emerald-500 ph-no-capture font-mono '
              )}
            >
              {change.value.new}
            </p>
          </div>
        )}
        {change.comment?.new && (
          <div className="flex flex-row space-x-1 flex-wrap items-center text-sm">
            <p className="text-zinc-500 mr-1 font-mono">COMMENT:</p>
            {change.comment?.old && (
              <p className="bg-red-200 dark:bg-red-950 text-red-500 ph-no-capture line-through font-mono">
                {change.comment.old}
              </p>
            )}
            <p
              className={
                change.type == 'Added'
                  ? 'text-zinc-900 dark:text-zinc-100 font-mono'
                  : 'dark:bg-emerald-400/10 bg-emerald-400/20 text-emerald-500 ph-no-capture font-mono'
              }
            >
              {change.comment.new}
            </p>
          </div>
        )}
        {(removedTags?.length > 0 || addedTags?.length > 0) && (
          <div className="flex flex-row space-x-1 items-center text-sm">
            <p className="text-zinc-500 mr-1 font-mono">TAGS:</p>
            <div className="inline-flex gap-2">
              {removedTags?.map((tag: SecretTagType) => (
                <div
                  key={tag.id}
                  className="bg-red-200 dark:bg-red-950 text-red-500 ph-no-capture line-through rounded-full"
                >
                  <Tag tag={tag} buttonVariant="deleted" />
                </div>
              ))}
              {addedTags?.map((tag: SecretTagType) => (
                <div
                  key={tag.id}
                  className="bg-emerald-100 dark:bg-emerald-950 text-emerald-500 ph-no-capture rounded-full"
                >
                  <Tag tag={tag} buttonVariant="added" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const changeCount = () => Object.entries(getChanges()).length + secretsToDelete.length

  return (
    <div>
      <GenericDialog
        buttonVariant="ghost"
        title="Preview undeployed changes"
        buttonContent={
          <Alert variant="info" size="sm" icon={true}>
            <span>{changeCount()} undeployed changes. Click to preview</span>
          </Alert>
        }
      >
        <div className="flex flex-col space-y-2 max-h-[85vh] overflow-auto ph-no-capture">
          <h1 className="text-zinc-500 mb-5">The following changes are pending deployment</h1>
          {Object.entries(getChanges()).map(([id, change]) => (
            <div key={id} className="flex flex-row items-center">
              {change.type === 'Added' && (
                <div className="flex flex-col mb-6">
                  <div className="flex flex-row items-center space-x-2">
                    <GoDotFill className="text-emerald-400" />
                    <p className="text-emerald-400">Created</p>
                    <p className="text-zinc-900 dark:text-zinc-100 font-mono break-all">
                      {change.secretName}
                    </p>
                  </div>
                  <DisplayChanges change={change} />
                </div>
              )}
              {change.type === 'Modified' && (
                <div className="flex flex-col mb-6">
                  <div className="flex items-center space-x-2">
                    <div className="flex flex-row space-x-2 items-center">
                      <GoDotFill className="text-yellow-500" />
                      <p className="text-amber-400 ">Updated</p>
                      <p className="text-zinc-900 dark:text-zinc-100 font-mono">
                        {change.secretName}
                      </p>
                    </div>
                  </div>
                  <DisplayChanges change={change} />
                </div>
              )}
            </div>
          ))}
          {secretsToDelete?.map((secretId) => {
            const deletedSecret = serverSecrets.find((secret) => secret.id === secretId)
            return (
              <div key={secretId} className="flex items-center space-x-2 mb-6">
                <GoDotFill className="text-red-400" />
                <p key={secretId} className="text-red-400">
                  Deleted
                </p>
                <p className="text-zinc-900 dark:text-zinc-100 font-mono">{deletedSecret?.key}</p>
              </div>
            )
          })}
        </div>
      </GenericDialog>
    </div>
  )
}
