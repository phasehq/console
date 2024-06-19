import { SecretEventType, SecretTagType, SecretType } from '@/apollo/graphql'
import { areTagsAreSame } from '@/utils/tags'
import { FaRedoAlt, FaUndoAlt } from 'react-icons/fa'
import { Button } from '../../common/Button'
import { Tag } from '../Tag'

export const SecretPropertyDiffs = (props: {
  secret: SecretType
  historyItem: SecretEventType
  index: number
  handlePropertyChange: Function
}) => {
  const { secret, historyItem, index, handlePropertyChange } = props

  const previousItem = secret.history![index - 1]!

  const getAddedTags = () => {
    const addedTags = historyItem!.tags.filter((currentTag: SecretTagType) =>
      previousItem.tags.every((previousTag: SecretTagType) => previousTag.id !== currentTag.id)
    )
    return addedTags
  }

  const getRemovedTags = () => {
    const removedTags = previousItem.tags.filter((previousTag: SecretTagType) =>
      historyItem.tags.every((currentTag) => currentTag.id !== previousTag.id)
    )
    return removedTags
  }

  const handleRestoreValue = (value: string) => {
    handlePropertyChange(secret.id, 'value', value)
  }

  return (
    <>
      {historyItem!.key !== previousItem.key && (
        <div className="pl-3 font-mono break-all ">
          <span className="text-neutral-500 mr-2">KEY:</span>
          <s className="bg-red-200 dark:bg-red-950 text-red-500 ph-no-capture">
            {previousItem.key}
          </s>
          <span className="bg-emerald-100 dark:bg-emerald-950 text-emerald-500 ph-no-capture">
            {historyItem!.key}
          </span>
        </div>
      )}

      {historyItem!.value !== previousItem.value && (
        <div className="pl-3 font-mono space-y-1 break-all">
          <div className="flex items-center gap-2">
            <span className="text-neutral-500 mr-2">VALUE:</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center justify-between bg-red-200 dark:bg-red-950">
              <s className=" text-red-500 ph-no-capture">{previousItem.value}</s>
              <Button
                variant="outline"
                onClick={() => handleRestoreValue(previousItem.value)}
                title="Restore this value"
              >
                <FaRedoAlt />
                <span className="font-sans text-xs">Restore</span>
              </Button>
            </div>
            <span className="bg-emerald-100 dark:bg-emerald-950 text-emerald-500 ph-no-capture">
              {historyItem!.value}
            </span>
          </div>
        </div>
      )}

      {historyItem!.comment !== previousItem.comment && (
        <div className="pl-3 font-mono break-all">
          <span className="text-neutral-500 mr-2">COMMENT:</span>
          <s className="bg-red-200 dark:bg-red-950 text-red-500 ph-no-capture">
            {previousItem.comment}
          </s>
          <span className="bg-emerald-100 dark:bg-emerald-950 text-emerald-500 ph-no-capture">
            {historyItem!.comment}
          </span>
        </div>
      )}

      {!areTagsAreSame(historyItem!.tags, previousItem.tags) && (
        <div className="pl-3 font-mono break-all">
          <span className="text-neutral-500 mr-2">TAGS:</span>
          <div className="bg-red-200 dark:bg-red-950 text-red-500 flex-1 w-max gap-2 rounded-full">
            {getRemovedTags().map((tag) => (
              <Tag key={tag.id} tag={tag} />
            ))}
          </div>
          <div className="bg-emerald-100 dark:bg-emerald-950 text-emerald-500 flex-1 w-max gap-2 rounded-full">
            {getAddedTags().map((tag) => (
              <Tag key={tag.id} tag={tag} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
