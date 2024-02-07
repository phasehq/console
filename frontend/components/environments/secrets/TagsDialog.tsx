import { SecretTagType } from '@/apollo/graphql'
import { useLazyQuery, useMutation } from '@apollo/client'
import clsx from 'clsx'
import { Dialog, Transition } from '@headlessui/react'
import { useState, useEffect, Fragment } from 'react'
import { FaCheckSquare, FaSquare, FaTags, FaTimes, FaPlus } from 'react-icons/fa'
import { Tag } from '../Tag'
import { GetSecretTags } from '@/graphql/queries/secrets/getSecretTags.gql'
import { CreateNewSecretTag } from '@/graphql/mutations/environments/createSecretTag.gql'
import { Button } from '../../common/Button'

export const TagsDialog = (props: {
  orgId: string
  secretId: string
  secretName: string
  tags: Array<SecretTagType>
  handlePropertyChange: Function
}) => {
  const { orgId, secretId, secretName, tags, handlePropertyChange } = props

  const [getOrgTags, { data: orgTags }] = useLazyQuery(GetSecretTags)
  const [createSecretTag] = useMutation(CreateNewSecretTag)

  const [secretTags, setSecretTags] = useState<Array<SecretTagType>>(tags)

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const [newTag, setNewTag] = useState<Partial<SecretTagType>>({ name: '', color: '' })

  useEffect(() => {
    if (isOpen)
      getOrgTags({
        variables: {
          orgId,
        },
      })
  }, [getOrgTags, isOpen, orgId])

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleClose = () => {
    handlePropertyChange(secretId, 'tags', secretTags)
    closeModal()
  }

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
    setNewTag({ name: '', color: '' })
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
        <Dialog as="div" className="relative z-10" onClose={closeModal}>
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
                    <div className="space-y-1">
                      {orgTags?.secretTags.map((tag: SecretTagType) => (
                        <TagSelector key={tag.id} tag={tag} />
                      ))}
                      <div className="flex items-center w-full justify-between border-t border-zinc-700 py-4">
                        <div className="flex items-center gap-2">
                          <input
                            className="text-sm"
                            value={newTag.name}
                            onChange={(e) => handleNewTagNameChange(e.target.value)}
                          />
                          <input
                            type="color"
                            value={newTag.color}
                            onChange={(e) => handleNewTagColorChange(e.target.value)}
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
