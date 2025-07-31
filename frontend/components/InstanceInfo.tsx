'use client'

import { Menu, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { Button } from './common/Button'
import { getApiHost, getHostname, isCloudHosted } from '@/utils/appConfig'
import EU from 'country-flag-icons/react/3x2/EU'
import { FaServer } from 'react-icons/fa'
import { LogoWordMark } from './common/LogoWordMark'

export const InstanceInfo = () => {
  const CloudInfo = () => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <EU className="size-10" />
        <div className="">
          <div className="font-medium text-sm leading-tight text-zinc-900 dark:text-zinc-100">
            Frankfurt
          </div>
          <div className="text-neutral-500 leading-tight text-xs font-mono flex items-center gap-2">
            eu-central-1
          </div>
        </div>
      </div>
    </div>
  )

  const SelfHostedInfo = () => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <FaServer className="text-emerald-500 size-6" />
        <div className="">
          <div className="font-medium text-sm leading-tight text-zinc-900 dark:text-zinc-100">
            {getHostname()}
          </div>
          <div className="text-neutral-500 text-xs leading-tight font-mono ">{getApiHost()}</div>
        </div>
      </div>
    </div>
  )
  return (
    <>
      <Menu as="div" className="relative inline-block text-left">
        <Menu.Button as="div">
          <Button variant="ghost">
            {isCloudHosted() ? <EU className="size-6" /> : <FaServer />}
          </Button>
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
          <Menu.Items className="absolute z-20 left-2 top-8 mt-2 w-80 origin-bottom-left divide-y divide-neutral-500/20 rounded-md  shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
            <Menu.Item>
              <div className="p-px">
                <div className="font-semibold text-base flex items-center gap-2 p-2">
                  <LogoWordMark className="fill-zinc-900 dark:fill-zinc-500 w-16" />{' '}
                  <span className="font-mono uppercase text-xs text-emerald-500">
                    {isCloudHosted() ? 'Cloud' : 'Self-hosted'}
                  </span>
                </div>
                <div className="bg-neutral-200 dark:bg-neutral-800 p-2">
                  {isCloudHosted() ? <CloudInfo /> : <SelfHostedInfo />}
                </div>
              </div>
            </Menu.Item>
          </Menu.Items>
        </Transition>
      </Menu>
    </>
  )
}
