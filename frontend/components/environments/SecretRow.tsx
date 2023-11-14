import {
  ApiSecretEventEventTypeChoices,
  EnvironmentType,
  Maybe,
  PersonalSecretType,
  SecretTagType,
  SecretType,
} from '@/apollo/graphql'
import { Fragment, useEffect, useState } from 'react'
import {
  FaEyeSlash,
  FaEye,
  FaTimes,
  FaRegCommentDots,
  FaTrashAlt,
  FaHistory,
  FaPlus,
  FaTags,
  FaCheckSquare,
  FaSquare,
  FaKey,
  FaUserEdit,
} from 'react-icons/fa'
import { Button } from '../common/Button'
import { Dialog, Transition } from '@headlessui/react'
import { GetSecretTags } from '@/graphql/queries/secrets/getSecretTags.gql'
import { CreateNewSecretTag } from '@/graphql/mutations/environments/createSecretTag.gql'
import { LogSecretRead } from '@/graphql/mutations/environments/readSecret.gql'
import { CreateNewPersonalSecret } from '@/graphql/mutations/environments/createPersonalSecret.gql'
import { RemovePersonalSecret } from '@/graphql/mutations/environments/removePersonalSecret.gql'
import clsx from 'clsx'
import { relativeTimeFromDates } from '@/utils/time'
import { useLazyQuery, useMutation } from '@apollo/client'
import { areTagsAreSame } from '@/utils/tags'
import { Avatar } from '../common/Avatar'
import { SecretPropertyDiffs } from './SecretPropertyDiffs'
import { encryptAsymmetric } from '@/utils/crypto'
import { toast } from 'react-toastify'

export const Tag = (props: { tag: SecretTagType }) => {
  const { name, color } = props.tag

  return (
    <div className="flex items-center px-2 rounded-full gap-1 border border-zinc-300 dark:border-zinc-700 text-neutral-500 text-base">
      <div className={`h-2 w-2 rounded-full`} style={{ backgroundColor: color }}></div>
      <span>{name}</span>
    </div>
  )
}

const TagsDialog = (props: {
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
          <Button variant="outline" onClick={openModal} title="Update tags">
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

const HistoryDialog = (props: { secret: SecretType }) => {
  const { secret } = props

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const getEventTypeColor = (eventType: ApiSecretEventEventTypeChoices) => {
    if (eventType === ApiSecretEventEventTypeChoices.C) return 'bg-emerald-500'
    if (eventType === ApiSecretEventEventTypeChoices.U) return 'bg-yellow-500'
    if (eventType === ApiSecretEventEventTypeChoices.R) return 'bg-blue-500'
    if (eventType === ApiSecretEventEventTypeChoices.D) return 'bg-red-500'
  }

  const getEventTypeText = (eventType: ApiSecretEventEventTypeChoices) => {
    if (eventType === ApiSecretEventEventTypeChoices.C) return 'Created'
    if (eventType === ApiSecretEventEventTypeChoices.U) return 'Updated'
    if (eventType === ApiSecretEventEventTypeChoices.R) return 'Read'
    if (eventType === ApiSecretEventEventTypeChoices.D) return 'Deleted'
  }

  const secretHistory = secret.history

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="outline" onClick={openModal} title="View secret history">
          <FaHistory /> <span className="hidden 2xl:block text-xs">History</span>
        </Button>
      </div>

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
                  <Dialog.Title as="div" className="flex w-full justify-between items-start">
                    <div>
                      <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                        <span className="text-zinc-700 dark:text-zinc-200 font-mono ph-no-capture">
                          {secret.key}
                        </span>{' '}
                        history
                      </h3>
                      <div className="text-neutral-500 text-sm">
                        View the chronological history of changes made to this secret.
                      </div>
                    </div>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-8 py-4">
                    <div className="max-h-[800px] overflow-y-auto px-2">
                      <div className="space-y-4 pb-4 border-l border-zinc-300 dark:border-zinc-700">
                        {secretHistory?.map((historyItem, index) => (
                          <div key={historyItem!.timestamp} className="pb-8 space-y-2">
                            <div className="flex flex-row items-center gap-2 -ml-1">
                              <span
                                className={clsx(
                                  'h-2 w-2 rounded-full',
                                  getEventTypeColor(historyItem!.eventType)
                                )}
                              ></span>
                              <div className="text-zinc-800 dark:text-zinc-200 font-semibold">
                                {getEventTypeText(historyItem!.eventType)}
                              </div>
                              <div className="text-neutral-500 text-sm">
                                {relativeTimeFromDates(new Date(historyItem!.timestamp))}
                              </div>{' '}
                              <span className="text-sm text-neutral-500">by</span>
                              <div className="text-sm flex items-center gap-2 text-neutral-500">
                                {historyItem!.user ? (
                                  <div className="flex items-center gap-1 text-sm">
                                    <Avatar imagePath={historyItem!.user.avatarUrl!} size="sm" />
                                    {historyItem?.user.fullName || historyItem?.user.email}
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 text-sm">
                                    <FaKey /> Service token
                                  </div>
                                )}
                              </div>
                            </div>
                            {index > 0 && (
                              <SecretPropertyDiffs
                                secret={secret}
                                historyItem={historyItem!}
                                index={index}
                              />
                            )}
                          </div>
                        ))}
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

const CommentDialog = (props: {
  secretId: string
  secretName: string
  comment: string
  handlePropertyChange: Function
}) => {
  const { secretId, secretName, comment, handlePropertyChange } = props

  const [commentValue, setCommentValue] = useState<string>(comment)

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleClose = () => {
    handlePropertyChange(secretId, 'comment', commentValue)
    closeModal()
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="outline" onClick={openModal} title="Update comment">
          <FaRegCommentDots className={clsx(comment && 'text-emerald-500')} />{' '}
          <span className="hidden 2xl:block text-xs">Comment</span>
        </Button>
      </div>

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
                  <Dialog.Title as="div" className="flex w-full justify-between items-start">
                    <div>
                      <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                        Update{' '}
                        <span className="text-zinc-700 dark:text-zinc-200 font-mono ph-no-capture">
                          {secretName}
                        </span>{' '}
                        comment
                      </h3>
                      <div className="text-neutral-500 text-sm">
                        Add a comment to this secret to provide additional information, context or
                        instructions.
                      </div>
                    </div>

                    <Button variant="text" onClick={handleClose}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6 p-4 ph-no-capture">
                    <textarea
                      rows={5}
                      value={commentValue}
                      className="w-full"
                      onChange={(e) => setCommentValue(e.target.value)}
                    ></textarea>
                  </div>

                  <div className="flex justify-end">
                    <Button variant="secondary" onClick={handleClose}>
                      Done
                    </Button>
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

const OverrideDialog = (props: {
  secretId: string
  secretName: string
  environment: EnvironmentType
  override: Maybe<PersonalSecretType>
}) => {
  const { secretId, secretName, environment, override } = props

  const [createOverride] = useMutation(CreateNewPersonalSecret)
  const [removeOverride] = useMutation(DeletePersonalSecret)

  const [value, setValue] = useState<string>(override?.value || '')

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleDeleteOverride = async () => {
    await removeOverride({
      variables: {
        secretId,
      },
    })
    setValue('')
    toast.success('Removed personal secret')
  }

  const handleUpdateOverride = async () => {
    if (value.length > 0) {
      const encryptedValue = await encryptAsymmetric(value, environment.identityKey)

      await createOverride({
        variables: {
          newPersonalSecret: {
            secretId,
            value: encryptedValue,
          },
        },
      })
      toast.success('Saved personal secret')
    }
  }

  const handleClose = () => {
    closeModal()
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="outline" onClick={openModal} title="Override this value">
          <FaUserEdit
            className={clsx(override?.value && override.value.length > 0 && 'text-amber-500')}
          />{' '}
          <span className="hidden 2xl:block text-xs">Override</span>
        </Button>
      </div>

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
                  <Dialog.Title as="div" className="flex w-full justify-between items-start">
                    <div>
                      <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                        Override{' '}
                        <span className="text-zinc-700 dark:text-zinc-200 font-mono ph-no-capture">
                          {secretName}
                        </span>{' '}
                      </h3>
                      <div className="text-neutral-500 text-sm">
                        Override this value with a Personal Secret. This value will only be visible
                        to you, and will not affect the value of this secret in the environment or
                        other users.
                      </div>
                    </div>

                    <Button variant="text" onClick={handleClose}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6 p-4 ph-no-capture">
                    <textarea
                      rows={5}
                      value={value}
                      className="w-full"
                      onChange={(e) => setValue(e.target.value)}
                    ></textarea>
                  </div>

                  <div className="flex justify-end gap-2 items-center">
                    {override && (
                      <Button variant="danger" onClick={handleDeleteOverride}>
                        Delete
                      </Button>
                    )}
                    <Button variant="primary" onClick={handleUpdateOverride}>
                      Save
                    </Button>
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

const DeleteConfirmDialog = (props: {
  secretId: string
  secretName: string
  onDelete: Function
}) => {
  const { secretName, secretId, onDelete } = props

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="danger" onClick={openModal} title="Delete secret">
          <div className="text-white dark:text-red-500 flex items-center gap-1 p-1">
            <FaTrashAlt />
          </div>
        </Button>
      </div>

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
                      Delete{' '}
                      <span className="text-zinc-700 dark:text-zinc-200 font-mono ph-no-capture">
                        {secretName}
                      </span>
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6 p-4">
                    <p className="text-neutral-500">Are you sure you want to delete this secret?</p>
                    <div className="flex items-center gap-4">
                      <Button variant="secondary" type="button" onClick={closeModal}>
                        Cancel
                      </Button>
                      <Button variant="danger" onClick={() => onDelete(secretId)}>
                        Delete
                      </Button>
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

export default function SecretRow(props: {
  orgId: string
  secret: SecretType
  environment: EnvironmentType
  cannonicalSecret: SecretType | undefined
  secretNames: Array<Partial<SecretType>>
  handlePropertyChange: Function
  handleDelete: Function
}) {
  const { orgId, secret, cannonicalSecret, secretNames, handlePropertyChange, handleDelete } = props

  const [isRevealed, setIsRevealed] = useState<boolean>(false)

  const [readSecret] = useMutation(LogSecretRead)

  const handleRevealSecret = async () => {
    setIsRevealed(true)
    await readSecret({ variables: { id: secret.id } })
  }

  const handleHideSecret = () => setIsRevealed(false)

  const toggleReveal = () => {
    isRevealed ? handleHideSecret() : handleRevealSecret()
  }

  const INPUT_BASE_STYLE =
    'w-full text-zinc-800 font-mono custom bg-zinc-100 dark:bg-zinc-800 dark:text-white transition ease ph-no-capture'

  const keyIsBlank = secret.key.length === 0

  const keyIsDuplicate =
    secretNames.findIndex((s) => s.key === secret.key && s.id !== secret.id) > -1

  const secretHasBeenModified = () => {
    if (cannonicalSecret === undefined) return true
    return (
      secret.key !== cannonicalSecret.key ||
      secret.value !== cannonicalSecret.value ||
      secret.comment !== cannonicalSecret.comment ||
      !areTagsAreSame(secret.tags, cannonicalSecret.tags)
    )
  }

  return (
    <div className="flex flex-row w-full gap-2 group">
      <div className="w-1/3 relative">
        <input
          className={clsx(
            INPUT_BASE_STYLE,
            'rounded-sm',
            keyIsBlank
              ? 'ring-1 ring-inset ring-red-500'
              : keyIsDuplicate
              ? 'ring-1 ring-inset ring-amber-500'
              : 'focus:ring-1 focus:ring-inset focus:ring-zinc-500',
            secretHasBeenModified() && '!text-amber-500'
          )}
          value={secret.key}
          onChange={(e) => handlePropertyChange(secret.id, 'key', e.target.value.toUpperCase())}
        />
        <div className="absolute inset-y-0 right-2 flex gap-1 items-center">
          <div
            className={clsx(
              secret.tags.length === 0 &&
                'opacity-0 group-hover:opacity-100 transition-opacity ease'
            )}
          >
            <TagsDialog
              orgId={orgId}
              secretName={secret.key}
              secretId={secret.id}
              tags={secret.tags}
              handlePropertyChange={handlePropertyChange}
            />
          </div>
        </div>
      </div>
      <div className="w-2/3 relative flex justify-between gap-2 focus-within:ring-1 focus-within:ring-inset focus-within:ring-zinc-500 rounded-sm bg-zinc-100 dark:bg-zinc-800 p-px">
        <input
          className={clsx(INPUT_BASE_STYLE, 'w-full focus:outline-none p-2')}
          value={secret.value}
          type={isRevealed ? 'text' : 'password'}
          onChange={(e) => handlePropertyChange(secret.id, 'value', e.target.value)}
        />

        <div className="flex gap-1 items-center group-hover:bg-zinc-100/30 group-hover:dark:bg-zinc-800/30 z-10">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity ease">
            <Button
              variant="outline"
              onClick={toggleReveal}
              title={isRevealed ? 'Mask value' : 'Reveal value'}
            >
              <span className="2xl:py-1">{isRevealed ? <FaEyeSlash /> : <FaEye />}</span>{' '}
              <span className="hidden 2xl:block text-xs">{isRevealed ? 'Mask' : 'Reveal'}</span>
            </Button>
          </div>

          <div className="opacity-0 group-hover:opacity-100 transition-opacity ease">
            <HistoryDialog secret={secret} />
          </div>

          <div
            className={clsx(
              secret.comment.length === 0 &&
                'opacity-0 group-hover:opacity-100 transition-opacity ease'
            )}
          >
            <CommentDialog
              secretName={secret.key}
              secretId={secret.id}
              comment={secret.comment}
              handlePropertyChange={handlePropertyChange}
            />
          </div>
          <div
            className={clsx(
              (!secret.override || secret.override.value.length === 0) &&
                'opacity-0 group-hover:opacity-100 transition-opacity ease'
            )}
          >
            <OverrideDialog
              secretName={secret.key}
              secretId={secret.id}
              environment={props.environment}
              override={secret.override!}
            />
          </div>
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity ease flex items-center">
        <DeleteConfirmDialog secretName={secret.key} secretId={secret.id} onDelete={handleDelete} />
      </div>
    </div>
  )
}
