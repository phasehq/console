import { SecretTagType } from '@/apollo/graphql'
import { useLazyQuery, useMutation } from '@apollo/client'
import clsx from 'clsx'
import { useState, useEffect, useRef } from 'react'
import { FaCheckSquare, FaSquare, FaTags, FaPlus, FaPalette } from 'react-icons/fa'
import { Tag } from '../Tag'
import { GetSecretTags } from '@/graphql/queries/secrets/getSecretTags.gql'
import { CreateNewSecretTag } from '@/graphql/mutations/environments/createSecretTag.gql'
import { Button } from '../../common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { areTagsAreSame } from '@/utils/tags'
import { generateRandomHexColor } from '@/utils/copy'

const TagCreator = (props: { orgId: string }) => {
  const { orgId } = props

  const colorInputRef = useRef<HTMLInputElement>(null)

  const handleTriggerClick = () => {
    colorInputRef.current?.click()
  }

  const [createSecretTag] = useMutation(CreateNewSecretTag)

  const [newTag, setNewTag] = useState<Partial<SecretTagType>>({
    name: '',
    color: generateRandomHexColor(),
  })

  const handleNewTagNameChange = (name: string) => setNewTag({ ...newTag, ...{ name } })

  const handleNewTagColorChange = (color: string) => setNewTag({ ...newTag, ...{ color } })

  const handleCreateTag = async () => {
    const { name, color } = newTag

    if (!name) return false

    await createSecretTag({
      variables: {
        orgId,
        name,
        color,
      },
      refetchQueries: [
        {
          query: GetSecretTags,
          variables: {
            orgId,
          },
        },
      ],
    })
    setNewTag({ name: '', color: generateRandomHexColor() })
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-black dark:text-white">Create a new tag</div>
      <div className="flex items-center w-full justify-between ">
        <div className="flex items-center gap-2 bg-zinc-200 dark:bg-zinc-800 rounded-full px-2">
          <button
            className="h-6 w-6 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${newTag.color}` }}
            onClick={handleTriggerClick}
          >
            <FaPalette className="text-sm" />
          </button>
          <input
            className="text-xs text-black dark:text-white custom rounded-full bg-zinc-200 dark:bg-zinc-800"
            placeholder="Tag name"
            value={newTag.name}
            onChange={(e) => handleNewTagNameChange(e.target.value)}
          />
          <input
            type="color"
            ref={colorInputRef}
            value={newTag.color}
            onChange={(e) => handleNewTagColorChange(e.target.value)}
            className="hidden"
          />
        </div>
        <Button
          variant={newTag.name!.length === 0 ? 'secondary' : 'primary'}
          disabled={newTag.name!.length === 0}
          onClick={handleCreateTag}
        >
          <FaPlus />
          Create new tag
        </Button>
      </div>
    </div>
  )
}

export const TagsDialog = (props: {
  orgId: string
  secretId: string
  secretName: string
  tags: Array<SecretTagType>
  handlePropertyChange: Function
  disabled?: boolean
}) => {
  const { orgId, secretId, secretName, tags, handlePropertyChange, disabled } = props

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  const [getOrgTags, { data: orgTags }] = useLazyQuery(GetSecretTags)

  const [secretTags, setSecretTags] = useState<Array<SecretTagType>>(tags)

  useEffect(() => {
    setSecretTags(tags)
  }, [tags])

  const handleClose = () => {
    if (!areTagsAreSame(tags, secretTags)) {
      handlePropertyChange(secretId, 'tags', secretTags)
    }
  }

  const TagSelector = (props: { tag: SecretTagType }) => {
    const { id, name, color } = props.tag

    const isSelected = secretTags.map((secretTag) => secretTag.name).includes(name)

    const handleTagClick = () => {
      if (isSelected) {
        setSecretTags(secretTags.filter((tag) => tag.name !== name))
      } else setSecretTags([...secretTags, ...[{ id, name, color }]])
    }

    return (
      <div
        className="flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors ease"
        onClick={handleTagClick}
      >
        {isSelected ? (
          <FaCheckSquare className="text-emerald-500" />
        ) : (
          <FaSquare className="text-zinc-300 dark:text-zinc-700" />
        )}
        <div className={clsx(isSelected ? 'opacity-100' : 'opacity-70', 'transition-opacity ease')}>
          <Tag tag={props.tag} />
        </div>
      </div>
    )
  }

  return (
    <>
      {tags.length > 0 && (
        <div
          className={clsx(
            'flex items-center gap-1.5',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer'
          )}
          role="button"
          onClick={disabled ? undefined : () => dialogRef.current?.openModal()}
        >
          {tags.map((tag) => (
            <Tag key={tag.id} tag={tag} />
          ))}
        </div>
      )}

      <GenericDialog
        ref={dialogRef}
        title={`Update ${secretName} tags`}
        dialogTitle={
          <h3 className="text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
            Update <span className="font-mono ph-no-capture break-all">{secretName}</span> tags
          </h3>
        }
        buttonVariant="outline"
        buttonContent={
          tags.length === 0 ? (
            <>
              <FaTags /> Tags
            </>
          ) : undefined
        }
        buttonProps={tags.length === 0 ? { tabIndex: -1, disabled } : undefined}
        onOpen={() => {
          getOrgTags({ variables: { orgId } })
          setSecretTags(tags)
        }}
        onClose={handleClose}
      >
        <div className="space-y-4 pt-4">
          <div className="grid grid-cols-4">
            {orgTags?.secretTags.map((tag: SecretTagType) => (
              <TagSelector key={tag.id} tag={tag} />
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => dialogRef.current?.closeModal()}>
              Done
            </Button>
          </div>
          <div className="border-t border-neutral-500/40 pt-4">
            <TagCreator orgId={orgId} />
          </div>
        </div>
      </GenericDialog>
    </>
  )
}
