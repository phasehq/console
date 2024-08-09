import { useState, useImperativeHandle, forwardRef, ReactNode, Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { FaTimes } from 'react-icons/fa'
import { Button } from './Button'
import clsx from 'clsx'

interface GenericDialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  buttonVariant: 'primary' | 'secondary' | 'danger' | 'outline' | ''
  buttonContent: ReactNode
  size?: 'lg' | 'md' | 'sm'
}

const GenericDialog = forwardRef(
  ({ title, onClose, children, buttonVariant, buttonContent, size }: GenericDialogProps, ref) => {
    const [isOpen, setIsOpen] = useState<boolean>(false)

    const closeModal = () => {
      onClose()
      setIsOpen(false)
    }

    const openModal = () => {
      setIsOpen(true)
    }

    useImperativeHandle(ref, () => ({
      closeModal,
    }))

    const sizeVariants = {
      lg: 'max-w-4xl',
      md: 'max-w-2xl',
      sm: 'max-w-lg',
    }

    const sizeClass = size ? sizeVariants[size] : sizeVariants['md']

    return (
      <>
        <div className="flex items-center justify-center">
          <Button variant={buttonVariant} onClick={openModal} title={title}>
            {buttonContent}
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
                  <Dialog.Panel
                    className={clsx(
                      'w-full transform rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all',
                      sizeClass
                    )}
                  >
                    <Dialog.Title as="div" className="flex w-full justify-between">
                      <h3 className="text-lg font-medium leading-6 text-zinc-800 dark:text-zinc-200">
                        {title}
                      </h3>
                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>
                    <div>{children}</div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>
      </>
    )
  }
)

GenericDialog.displayName = 'GenericDialog'

export default GenericDialog
