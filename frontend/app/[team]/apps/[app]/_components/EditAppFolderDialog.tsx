'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { FaTimes } from 'react-icons/fa'
import { FaCircle } from 'react-icons/fa6'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Checkbox } from '@/components/common/Checkbox'
import { Input } from '@/components/common/Input'
import { envColor } from '@/utils/environment'
import { FOLDER_NAME_REGEX, isReservedFolderName } from '@/utils/secrets'
import { FolderInEnv, FolderTarget } from './DeleteAppFolderDialog'
import { FolderPicker } from './FolderPicker'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
const parentOf = (fullPath: string) => fullPath.slice(0, fullPath.lastIndexOf('/')) || '/'
const childOf = (parent: string, name: string) => (parent === '/' ? `/${name}` : `${parent}/${name}`)

/**
 * Renames a folder, moves it into another, or both, in the envs ticked (all of
 * them by default). It happens straight away, like creating or deleting one.
 */
export const EditAppFolderDialog = ({
  target,
  folders,
  onClose,
  onSave,
}: {
  target: FolderTarget | null
  /** Every folder of the App, as full paths */
  folders: string[]
  onClose: () => void
  onSave: (folders: FolderInEnv[], name: string, parent: string) => Promise<void>
}) => {
  // Keeps the content in place while the dialog animates out
  const lastTargetRef = useRef<FolderTarget | null>(null)
  if (target) lastTargetRef.current = target
  const shown = target ?? lastTargetRef.current

  const [name, setName] = useState('')
  const [parent, setParent] = useState('/')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!target) return
    setName(target.name)
    setParent(parentOf(target.fullPath))
    setSelected(new Set(target.envs.map((entry) => entry.env.id)))
  }, [target])

  // A folder can't go inside itself
  const destinations = useMemo(
    () =>
      shown
        ? folders.filter(
            (path) => path !== shown.fullPath && !path.startsWith(`${shown.fullPath}/`)
          )
        : [],
    [folders, shown]
  )

  const toggle = (envId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(envId)) next.add(envId)
      return next
    })

  const chosen = shown?.envs.filter((entry) => selected.has(entry.env.id)) ?? []
  const destination = childOf(parent, name)
  const changed = Boolean(shown) && destination !== shown!.fullPath
  const problem =
    name === ''
      ? null
      : isReservedFolderName(name, parent)
        ? `"${name}" is a reserved name and cannot be used for root folders`
        : changed && folders.includes(destination)
          ? `A folder named ${name} is already there`
          : null

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(chosen, name, parent)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Transition appear show={target !== null} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => !saving && onClose()}>
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
                        Rename or move folder{' '}
                        <span className="break-all font-mono ph-no-capture">{shown.fullPath}</span>
                      </h3>
                      <Button variant="text" onClick={onClose} disabled={saving}>
                        <FaTimes className="text-zinc-900 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <div className="space-y-4 pt-2">
                      <p className="text-xs text-neutral-500">
                        Everything in the folder comes along, and syncs that send it follow.
                        References to its secrets by path aren&apos;t rewritten.
                      </p>

                      <Input
                        value={name}
                        setValue={(value) => FOLDER_NAME_REGEX.test(value) && setName(value)}
                        label="Folder name"
                        required
                        maxLength={32}
                        disabled={saving}
                      />

                      <div className="space-y-2">
                        <div className="text-xs text-neutral-500">Inside</div>
                        <FolderPicker folders={destinations} value={parent} onChange={setParent} />
                      </div>

                      <ul className="divide-y divide-neutral-500/10 overflow-hidden rounded-lg ring-1 ring-inset ring-neutral-500/20">
                        {shown.envs.map((entry) => (
                          <li key={entry.env.id} className="flex items-center gap-2 px-3 py-2">
                            <Checkbox
                              size="sm"
                              checked={selected.has(entry.env.id)}
                              onChange={() => toggle(entry.env.id)}
                              disabled={saving}
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

                      {shown.hasUnsavedChanges ? (
                        <Alert variant="warning" icon={true} size="sm">
                          This folder has undeployed changes. Deploy or discard them before renaming
                          or moving it.
                        </Alert>
                      ) : (
                        problem && (
                          <Alert variant="warning" icon={true} size="sm">
                            {problem}
                          </Alert>
                        )
                      )}

                      <div className="flex items-center justify-end gap-2">
                        <Button variant="secondary" onClick={onClose} disabled={saving}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          onClick={handleSave}
                          isLoading={saving}
                          disabled={
                            !changed ||
                            name === '' ||
                            problem !== null ||
                            chosen.length === 0 ||
                            shown.hasUnsavedChanges
                          }
                        >
                          Save in {plural(chosen.length, 'environment')}
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
