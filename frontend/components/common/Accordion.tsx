import { Disclosure, Transition } from '@headlessui/react'
import clsx from 'clsx'

interface AccordionProps {
  title?: string
  description?: string
  children: React.ReactNode
  buttonContent?: (open: boolean) => React.ReactNode // Custom button content with open state
  defaultOpen?: boolean
  className?: string
}

const Accordion: React.FC<AccordionProps> = ({
  title,
  description,
  children,
  buttonContent,
  defaultOpen = false,
  className = '',
}) => {
  return (
    <Disclosure
      as="div"
      defaultOpen={defaultOpen}
      className={clsx('flex flex-col divide-y divide-neutral-500/30 w-full', className)}
    >
      {({ open }) => (
        <>
          <Disclosure.Button className="w-full">
            {buttonContent ? (
              buttonContent(open) // Render custom content with access to the `open` state
            ) : (
              <div
                className={clsx(
                  'p-2 flex justify-between items-center gap-8 transition ease w-full'
                )}
              >
                <div className="py-4 text-sm text-left">
                  <div className="text-zinc-900 dark:text-zinc-100 font-medium">{title}</div>
                  {description && <div className="text-neutral-500">{description}</div>}
                </div>
                <div
                  className={clsx(
                    'transform transition ease text-neutral-500',
                    open ? 'rotate-90' : 'rotate-0'
                  )}
                >
                  ▼
                </div>
              </div>
            )}
          </Disclosure.Button>

          <Transition
            enter="transition-all duration-300 ease-out"
            enterFrom="max-h-0 opacity-0"
            enterTo="max-h-screen opacity-100"
            leave="transition-all duration-200 ease-out"
            leaveFrom="max-h-screen opacity-100"
            leaveTo="max-h-0 opacity-0"
          >
            <Disclosure.Panel>{children}</Disclosure.Panel>
          </Transition>
        </>
      )}
    </Disclosure>
  )
}

export default Accordion
