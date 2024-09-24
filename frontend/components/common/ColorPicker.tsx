import { Menu, Transition } from '@headlessui/react'
import { Fragment, useRef } from 'react'

export const ColorPicker = ({
  color,
  setColor,
  allowCustomColors,
}: {
  color: string
  setColor: (value: string) => void
  allowCustomColors?: boolean
}) => {
  const colorInputRef = useRef<HTMLInputElement>(null)

  const handleTriggerClick = () => {
    colorInputRef.current?.click()
  }

  const colors = [
    '#f4f4f5', //white
    '#71717a', //gray
    '#18181b', //black
    '#ef4444', //red
    '#f97316', //orange
    '#f59e0b', //amber
    '#eab308', //yellow
    '#84cc16', //lime
    '#22c55e', //green
    '#14b8a6', //teal
    '#06b6d4', //cyan
    '#0ea5e9', //sky
    '#3b82f6', //blue
    '#6366f1', //indigo
    '#8b5cf6', //violet
    '#a855f7', //purple
    '#d946ef', //fuchsia
    '#ec4899', //pink
  ]

  return (
    <div className="space-y-2">
      <label className="block text-neutral-500 text-sm mb-2" htmlFor="colorpicker">
        Label color
      </label>
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
              <Menu.Button>
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
                          className="size-7 rounded-full"
                          style={{ backgroundColor: `${colorOption}` }}
                          onClick={() => setColor(colorOption)}
                        ></button>
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
