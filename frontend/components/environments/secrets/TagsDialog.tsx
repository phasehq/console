import { SecretTagType } from '@/apollo/graphql'
import { useLazyQuery, useMutation } from '@apollo/client'
import clsx from 'clsx'
import { Dialog, Transition } from '@headlessui/react'
import { useState, useEffect, Fragment, useRef } from 'react'
import { FaCheckSquare, FaSquare, FaTags, FaTimes, FaPlus, FaPalette } from 'react-icons/fa'
import { Tag } from '../Tag'
import { GetSecretTags } from '@/graphql/queries/secrets/getSecretTags.gql'
import { CreateNewSecretTag } from '@/graphql/mutations/environments/createSecretTag.gql'
import { Button } from '../../common/Button'
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
    <div className="space-y-4">
      <div className="font-semibold text-black dark:text-white">Create a new tag</div>
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
            className="text-sm text-black dark:text-white custom rounded-full bg-zinc-200 dark:bg-zinc-800"
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
}) => {
  const { orgId, secretId, secretName, tags, handlePropertyChange } = props

  const [getOrgTags, { data: orgTags }] = useLazyQuery(GetSecretTags)

  const [secretTags, setSecretTags] = useState<Array<SecretTagType>>(tags)

  const [isOpen, setIsOpen] = useState<boolean>(false)

  useEffect(() => {
    if (isOpen)
      getOrgTags({
        variables: {
          orgId,
        },
      })
    setSecretTags(tags)
  }, [getOrgTags, isOpen, orgId, tags])

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleClose = () => {
    if (!areTagsAreSame(tags, secretTags)) {
      handlePropertyChange(secretId, 'tags', secretTags)
    }
    closeModal()
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
      {tags.length > 0 ? (
        <div className="flex items-center gap-1.5 cursor-pointer" role="button" onClick={openModal}>
          {tags.map((tag) => (
            <Tag key={tag.id} tag={tag} />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center">
          <Button variant="outline" onClick={openModal} title="Update tags" tabIndex={-1}>
            <FaTags /> Tags
          </Button>
        </div>
      )}

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={handleClose}>
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
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Update{' '}
                      <span className="text-zinc-700 dark:text-zinc-200 font-mono ph-no-capture">
                        {secretName}
                      </span>{' '}
                      tags
                    </h3>

                    <Button variant="text" onClick={handleClose}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6 p-4">
                    <div className="grid grid-cols-2">
                      {orgTags?.secretTags.map((tag: SecretTagType) => (
                        <TagSelector key={tag.id} tag={tag} />
                      ))}
                    </div>
                    <div className="flex justify-end">
                      <Button variant="primary" onClick={handleClose}>
                        Done
                      </Button>
                    </div>
                    <div className="border-t border-neutral-500/40 pt-4">
                      <TagCreator orgId={orgId} />
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
