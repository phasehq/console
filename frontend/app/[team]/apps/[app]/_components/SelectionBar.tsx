'use client'

import { Fragment, ReactNode } from 'react'
import { useQuery } from '@apollo/client'
import { Menu, Popover, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaCheck,
  FaCheckSquare,
  FaDownload,
  FaFolderOpen,
  FaMinusSquare,
  FaRegSquare,
  FaTags,
  FaTimes,
  FaTrashAlt,
} from 'react-icons/fa'
import { FaCircle } from 'react-icons/fa6'
import { TbColumnInsertRight } from 'react-icons/tb'
import { ApiSecretTypeChoices, EnvironmentType, SecretTagType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { LogoComponent } from '@/components/common/logos/types'
import { SECRET_TYPES } from '@/components/environments/secrets/TypeSelector'
import { GetSecretTags } from '@/graphql/queries/secrets/getSecretTags.gql'
import { envColor } from '@/utils/environment'

const ITEM = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left'
const PANEL =
  'z-50 max-h-72 min-w-[11rem] overflow-y-auto rounded-md bg-zinc-100 p-1 text-xs text-zinc-900 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none dark:bg-zinc-800 dark:text-zinc-100'
const OPENING = {
  enter: 'transition ease-out duration-100',
  enterFrom: 'transform opacity-0 scale-95',
  enterTo: 'transform opacity-100 scale-100',
  leave: 'transition ease-in duration-75',
  leaveFrom: 'transform opacity-100 scale-100',
  leaveTo: 'transform opacity-0 scale-95',
}

// Labels give way to their icons when the toolbar (a size container) is tight
const LABEL = 'hidden [@container_(min-width:1160px)]:inline'

type BarListProps = {
  label: string
  icon: LogoComponent
  children: ReactNode
}

/** A bar action that opens a short list to pick from; anchored, so the bar's own scroll can't clip it */
const BarMenu = ({ label, icon, children }: BarListProps) => (
  <Menu as="div" className="relative">
    <Menu.Button as={Fragment}>
      <Button variant="ghost" icon={icon} title={label} aria-label={label}>
        <span className={LABEL}>{label}</span>
      </Button>
    </Menu.Button>
    <Transition as={Fragment} {...OPENING}>
      <Menu.Items anchor={{ to: 'bottom', gap: 8 }} className={PANEL}>
        {children}
      </Menu.Items>
    </Transition>
  </Menu>
)

/** The same, for a list that's ticked rather than picked from: it stays open */
const BarChecklist = ({ label, icon, children }: BarListProps) => (
  <Popover className="relative">
    <Popover.Button as={Fragment}>
      <Button variant="ghost" icon={icon} title={label} aria-label={label}>
        <span className={LABEL}>{label}</span>
      </Button>
    </Popover.Button>
    <Transition as={Fragment} {...OPENING}>
      <Popover.Panel anchor={{ to: 'bottom', gap: 8 }} className={PANEL}>
        <div role="group" aria-label={label}>
          {children}
        </div>
      </Popover.Panel>
    </Transition>
  </Popover>
)

type TagState = 'all' | 'some' | 'none'

/** The organisation's tags, each ticked when every selected value has it */
const TagItems = ({
  orgId,
  stateOf,
  onToggle,
}: {
  orgId: string
  stateOf: (tagId: string) => TagState
  onToggle: (tag: SecretTagType, add: boolean) => void
}) => {
  const { data, loading } = useQuery(GetSecretTags, { variables: { orgId } })
  const tags = (data?.secretTags ?? []) as SecretTagType[]
  if (tags.length === 0)
    return (
      <div className="px-2 py-1.5 text-neutral-500">
        {loading ? 'Loading tags…' : 'No tags yet. Create one from a secret’s Tags menu.'}
      </div>
    )
  return (
    <>
      {tags.map((tag) => {
        const state = stateOf(tag.id)
        return (
          <button
            key={tag.id}
            type="button"
            role="checkbox"
            aria-checked={state === 'some' ? 'mixed' : state === 'all'}
            onClick={() => onToggle(tag, state !== 'all')}
            className={clsx(
              ITEM,
              'hover:bg-zinc-200 focus-visible:bg-zinc-200 focus-visible:outline-none dark:hover:bg-zinc-700 dark:focus-visible:bg-zinc-700'
            )}
          >
            {state === 'all' ? (
              <FaCheckSquare className="shrink-0 text-emerald-500" />
            ) : state === 'some' ? (
              <FaMinusSquare className="shrink-0 text-emerald-500" />
            ) : (
              <FaRegSquare className="shrink-0 text-neutral-500" />
            )}
            <FaCircle className="shrink-0 text-[7px]" style={{ color: tag.color }} />
            <span className="truncate">{tag.name}</span>
          </button>
        )
      })}
    </>
  )
}

type SelectionBarProps = {
  count: number
  /** Each action is absent without the permission it needs */
  onMove?: () => void
  /** The type every selected value has, if they agree */
  type?: { current: ApiSecretTypeChoices | null; onSet: (type: ApiSecretTypeChoices) => void }
  tags?: {
    orgId: string
    stateOf: (tagId: string) => TagState
    onToggle: (tag: SecretTagType, add: boolean) => void
  }
  /** The envs a .env file of the selection can be made for */
  exportTo?: { environments: EnvironmentType[]; onExport: (envId: string) => void }
  onNewEnvironment?: () => void
  onDelete?: () => void
  onClear: () => void
}

/** What can be done with the selected secrets; sits in the grid's toolbar, beside the New menu */
export const SelectionBar = ({
  count,
  onMove,
  type,
  tags,
  exportTo,
  onNewEnvironment,
  onDelete,
  onClear,
}: SelectionBarProps) => (
  <div
    role="toolbar"
    aria-label="Selected secrets"
    // As tall as the buttons beside it, so nothing shifts when it appears
    className="flex h-8 max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-zinc-100 pl-4 pr-1 ring-1 ring-inset ring-neutral-500/40 dark:bg-zinc-800"
  >
    {/* The checkboxes' green */}
    <span className="whitespace-nowrap pr-2 text-xs font-medium text-emerald-500">
      {count} selected
    </span>
    {onMove && (
      <Button
        variant="ghost"
        icon={FaFolderOpen}
        title="Move to a folder"
        aria-label="Move"
        onClick={onMove}
      >
        <span className={LABEL}>Move</span>
      </Button>
    )}
    {type && (
      <BarMenu label="Type" icon={SECRET_TYPES[1].icon}>
        {SECRET_TYPES.map(({ value, label, icon: Icon }) => (
          <Menu.Item key={value}>
            {({ focus }) => (
              <button
                type="button"
                onClick={() => type.onSet(value)}
                className={clsx(ITEM, focus && 'bg-zinc-200 dark:bg-zinc-700')}
              >
                <Icon className="shrink-0 text-neutral-500" />
                <span className="flex-1">{label}</span>
                {type.current === value && <FaCheck className="shrink-0 text-emerald-500" />}
              </button>
            )}
          </Menu.Item>
        ))}
      </BarMenu>
    )}
    {tags && (
      <BarChecklist label="Tags" icon={FaTags}>
        <TagItems {...tags} />
      </BarChecklist>
    )}
    {exportTo &&
      (exportTo.environments.length === 1 ? (
        <Button
          variant="ghost"
          icon={FaDownload}
          title={`Download the selection as a .env file for ${exportTo.environments[0].name}`}
          aria-label="Export"
          onClick={() => exportTo.onExport(exportTo.environments[0].id)}
        >
          <span className={LABEL}>Export</span>
        </Button>
      ) : (
        <BarMenu label="Export" icon={FaDownload}>
          <div className="px-2 py-1 text-2xs text-neutral-500">As a .env file for</div>
          {exportTo.environments.map((env) => (
            <Menu.Item key={env.id}>
              {({ focus }) => (
                <button
                  type="button"
                  onClick={() => exportTo.onExport(env.id)}
                  className={clsx(ITEM, focus && 'bg-zinc-200 dark:bg-zinc-700')}
                >
                  <FaCircle className="shrink-0 text-[7px]" style={{ color: envColor(env) }} />
                  {env.name}
                </button>
              )}
            </Menu.Item>
          ))}
        </BarMenu>
      ))}
    {onNewEnvironment && (
      <Button
        variant="ghost"
        icon={TbColumnInsertRight}
        title="A new Environment with the selected secrets"
        aria-label="New Environment"
        onClick={onNewEnvironment}
      >
        <span className={LABEL}>New Environment</span>
      </Button>
    )}
    {onDelete && (
      <Button
        variant="ghost"
        icon={FaTrashAlt}
        title="Delete"
        aria-label="Delete"
        onClick={onDelete}
        classString="!text-red-600 dark:!text-red-400"
      >
        <span className={LABEL}>Delete</span>
      </Button>
    )}
    <Button
      variant="ghost"
      icon={FaTimes}
      title="Clear the selection"
      aria-label="Clear the selection"
      onClick={onClear}
      classString="!px-2"
    />
  </div>
)
