import { colors, getContrastingTextColor } from '@/utils/copy'
import { Menu, Transition } from '@headlessui/react'
import { Fragment, useRef } from 'react'
import { FaCheck } from 'react-icons/fa'

export const ColorPicker = ({
  color,
  setColor,
  allowCustomColors,
  disabled,
}: {
  color: string
  setColor: (value: string) => void
  allowCustomColors?: boolean
  disabled?: boolean
}) => {
  const colorInputRef = useRef<HTMLInputElement>(null)

  const handleTriggerClick = () => {
    colorInputRef.current?.click()
  }

  return (
    <div>
      {allowCustomColors ? (
        <div className="flex items-center gap-2">
          <button
            id="colorpicker"
            className="size-7 rounded-full flex items-center justify-center ring-1 ring-inset ring-neutral-500"
            style={{ backgroundColor: `${color}` }}
            onClick={handleTriggerClick}
            type="button"
            title="Role label color"
          ></button>

          <input
            type="color"
            ref={colorInputRef}
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="hidden"
          />
        </div>
      ) : (
        <Menu as="div" className="relative inline-block text-left w-full">
          {({ open }) => (
            <>
              <Menu.Button disabled={disabled}>
                <div
                  className="size-7 rounded-full ring-1 ring-inset ring-neutral-500/40"
                  style={{ backgroundColor: `${color}` }}
                ></div>
              </Menu.Button>
              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <Menu.Items className="absolute z-10 left-0 shadow-2xl top-8 mt-2 w-60 origin-bottom-left divide-y divide-neutral-500/40 rounded-md bg-neutral-200 dark:bg-neutral-800 ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
                  <div className="p-2 flex flex-wrap justify-around gap-2">
                    {colors.map((colorOption) => (
                      <Menu.Item key={colorOption}>
                        <button
                          type="button"
                          className="size-7 rounded-full relative flex items-center justify-center"
                          style={{ backgroundColor: `${colorOption}` }}
                          onClick={() => setColor(colorOption)}
                        >
                          {color === colorOption && (
                            <FaCheck
                              className="text-xs"
                              style={{ color: getContrastingTextColor(color) }}
                            />
                          )}
                        </button>
                      </Menu.Item>
                    ))}
                  </div>
                </Menu.Items>
              </Transition>
            </>
          )}
        </Menu>
      )}
    </div>
  )
}
