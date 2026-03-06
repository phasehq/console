'use client'

import { EnvironmentType, DynamicSecretType } from '@/apollo/graphql'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { FaChevronRight, FaExternalLinkAlt } from 'react-icons/fa'
import {
  MissingIndicator,
  PresentIndicator,
} from '@/app/[team]/apps/[app]/_components/SecretInfoLegend'
import { Disclosure, Transition } from '@headlessui/react'
import { FaBolt } from 'react-icons/fa6'

type AppDynamicSecret = {
  id: string
  name: string
  envs: {
    env: EnvironmentType
    dynamicSecret: DynamicSecretType | null
  }[]
}

export const AppDynamicSecretRow = ({
  appDynamicSecret,
  isExpanded,
  expand,
  collapse,
}: {
  appDynamicSecret: AppDynamicSecret
  isExpanded: boolean
  expand: (id: string) => void
  collapse: (id: string) => void
}) => {
  const pathname = usePathname()

  const tooltipText = (env: { env: EnvironmentType; dynamicSecret: DynamicSecretType | null }) => {
    if (env.dynamicSecret === null) return `This dynamic secret is missing in ${env.env.name}`
    else return 'This dynamic secret is present'
  }

  const EnvDynamicSecret = ({
    envDynamicSecret,
  }: {
    envDynamicSecret: {
      env: EnvironmentType
      dynamicSecret: DynamicSecretType | null
    }
  }) => {
    const { envDynamicSecret: envDS } = { envDynamicSecret }

    const EnvLabel = () => (
      <div
        className={`flex items-center gap-2 w-min group font-medium text-xs text-zinc-900 dark:text-zinc-100 opacity-60`}
      >
        <div>{envDS.env.name}</div>

        <FaExternalLinkAlt className="opacity-0 group-hover:opacity-100 transition ease" />
      </div>
    )

    return (
      <div className="py-2 px-4">
        {envDS.dynamicSecret === null ? (
          <span className="text-red-500 font-mono uppercase">missing</span>
        ) : (
          <Link
            className="flex items-center gap-2 group"
            href={`${pathname}/environments/${envDS.env.id}/?secret=${envDS.dynamicSecret.id}`}
            title={`View this dynamic secret in ${envDS.env.name}`}
          >
            <div className="w-full">
              <EnvLabel />

              {/* Show key names from keyMap */}
              {envDS.dynamicSecret.keyMap && envDS.dynamicSecret.keyMap.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {envDS.dynamicSecret.keyMap.map((keyEntry, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2 py-1 rounded-md font-mono ph-no-capture text-2xs 2xl:text-sm"
                    >
                      {keyEntry?.keyName}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Link>
        )}
      </div>
    )
  }

  return (
    <>
      <tr
        className={clsx(
          'group divide-x divide-neutral-500/40 border-x bg-zinc-100 dark:bg-zinc-800 cursor-pointer',
          isExpanded ? '!border-r-neutral-500/20' : 'border-neutral-500/20 '
        )}
        onClick={() => (isExpanded ? collapse(appDynamicSecret.id) : expand(appDynamicSecret.id))}
      >
        <td
          className={clsx(
            'px-6 py-3 whitespace-nowrap font-mono text-zinc-800 dark:text-zinc-300 flex items-center gap-2 text-2xs 2xl:text-sm',
            isExpanded ? 'font-bold' : 'font-medium'
          )}
        >
          <FaBolt className="text-emerald-500" />
          {appDynamicSecret.name}
          <FaChevronRight
            className={clsx(
              'transform transition ease font-light',
              isExpanded ? 'opacity-100 rotate-90' : 'opacity-0 group-hover:opacity-100 rotate-0'
            )}
          />
        </td>
        {appDynamicSecret.envs.map((env) => (
          <td key={env.env.id} className="px-6 py-3 whitespace-nowrap">
            <div className="flex items-center justify-center" title={tooltipText(env)}>
              {env.dynamicSecret !== null ? (
                <PresentIndicator />
              ) : (
                <MissingIndicator />
              )}
            </div>
          </td>
        ))}
      </tr>
      <Transition
        as="tr"
        show={isExpanded}
        enter="transition duration-100 ease-out"
        enterFrom="transform scale-95 opacity-0"
        enterTo="transform scale-100 opacity-100"
        leave="transition duration-75 ease-out"
        leaveFrom="transform scale-100 opacity-100"
        leaveTo="transform scale-95 opacity-0"
        className={clsx('border-x', isExpanded ? 'shadow-xl' : '')}
      >
        {isExpanded && (
          <td
            colSpan={appDynamicSecret.envs.length + 1}
            className="p-2 space-y-6 bg-zinc-100 dark:bg-zinc-800"
          >
            <div className="grid gap-2 divide-y divide-neutral-500/20">
              {appDynamicSecret.envs.map((envDynamicSecret) => (
                <EnvDynamicSecret
                  key={envDynamicSecret.env.id}
                  envDynamicSecret={envDynamicSecret}
                />
              ))}
            </div>
          </td>
        )}
      </Transition>
    </>
  )
}
