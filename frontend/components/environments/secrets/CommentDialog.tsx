import { Dialog, Transition } from '@headlessui/react'
import { Button } from '../../common/Button'
import clsx from 'clsx'
import { useState, Fragment, useContext } from 'react'
import { FaRegCommentDots, FaTimes } from 'react-icons/fa'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'

export const CommentDialog = (props: {
  secretId: string
  secretName: string
  comment: string
  handlePropertyChange: Function
}) => {
  const { secretId, secretName, comment, handlePropertyChange } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanUpdateSecrets = userHasPermission(
    organisation?.role?.permissions,
    'Secrets',
    'update',
    true
  )

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
        <Button variant="outline" onClick={openModal} title="Update comment" tabIndex={-1}>
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
                      disabled={!userCanUpdateSecrets}
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
