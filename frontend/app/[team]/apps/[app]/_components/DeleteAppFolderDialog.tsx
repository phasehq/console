'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { FaTimes, FaTrashAlt } from 'react-icons/fa'
import { FaCircle } from 'react-icons/fa6'
import { EnvironmentType } from '@/apollo/graphql'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Checkbox } from '@/components/common/Checkbox'
import { envColor } from '@/utils/environment'

/** The folder in one env: what deleting it there removes */
export type FolderInEnv = {
  env: EnvironmentType
  folderId: string
  secretCount: number
  folderCount: number
}

export type FolderDeleteTarget = {
  name: string
  fullPath: string
  /** Every env that has the folder, in column order */
  envs: FolderInEnv[]
  /** Undeployed edits inside the folder — they'd be orphaned by the delete */
  hasUnsavedChanges: boolean
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * Confirms deleting a folder, with everything in it, from the envs ticked
 * (all of them by default).
 */
export const DeleteAppFolderDialog = ({
  target,
  onClose,
  onDelete,
}: {
  target: FolderDeleteTarget | null
  onClose: () => void
  onDelete: (folders: FolderInEnv[]) => Promise<void>
}) => {
  // Keeps the content in place while the dialog animates out
  const lastTargetRef = useRef<FolderDeleteTarget | null>(null)
  if (target) lastTargetRef.current = target
  const shown = target ?? lastTargetRef.current

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (target) setSelected(new Set(target.envs.map((entry) => entry.env.id)))
  }, [target])

  const toggle = (envId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(envId)) next.add(envId)
      return next
    })

  const chosen = shown?.envs.filter((entry) => selected.has(entry.env.id)) ?? []

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await onDelete(chosen)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Transition appear show={target !== null} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => !deleting && onClose()}>
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
              <Dialog.Panel className="w-full max-w-lg transform rounded-2xl bg-neutral-100 p-4 text-left align-middle shadow-xl transition-all dark:bg-neutral-900">
                {shown && (
                  <>
                    <Dialog.Title as="div" className="flex w-full items-start justify-between gap-2">
                      <h3 className="text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
                        Delete folder{' '}
                        <span className="break-all font-mono ph-no-capture">{shown.fullPath}</span>
                      </h3>
                      <Button variant="text" onClick={onClose} disabled={deleting}>
                        <FaTimes className="text-zinc-900 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <div className="space-y-4 pt-2">
                      <p className="text-xs text-neutral-500">
                        Deletes the folder and everything in it — its secrets and subfolders — from
                        the environments selected below. This can&apos;t be undone.
                      </p>

                      <ul className="divide-y divide-neutral-500/10 overflow-hidden rounded-lg ring-1 ring-inset ring-neutral-500/20">
                        {shown.envs.map((entry) => (
                          <li key={entry.env.id} className="flex items-center gap-2 px-3 py-2">
                            <Checkbox
                              size="sm"
                              checked={selected.has(entry.env.id)}
                              onChange={() => toggle(entry.env.id)}
                              disabled={deleting}
                            />
                            <FaCircle
                              className="shrink-0 text-[7px]"
                              style={{ color: envColor(entry.env) }}
                            />
                            <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                              {entry.env.name}
                            </span>
                            <span className="ml-auto text-2xs text-neutral-500">
                              {plural(entry.secretCount, 'secret')} ·{' '}
                              {plural(entry.folderCount, 'folder')}
                            </span>
                          </li>
                        ))}
                      </ul>

                      {shown.hasUnsavedChanges && (
                        <Alert variant="warning" icon={true} size="sm">
                          This folder has undeployed changes. Deploy or discard them before deleting
                          it.
                        </Alert>
                      )}

                      <div className="flex items-center justify-end gap-2">
                        <Button variant="secondary" onClick={onClose} disabled={deleting}>
                          Cancel
                        </Button>
                        <Button
                          variant="danger"
                          onClick={handleDelete}
                          isLoading={deleting}
                          disabled={chosen.length === 0 || shown.hasUnsavedChanges}
                        >
                          <span className="flex items-center gap-2">
                            <FaTrashAlt />
                            Delete from {plural(chosen.length, 'environment')}
                          </span>
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
