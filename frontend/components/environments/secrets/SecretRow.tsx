import { EnvironmentType, SecretType } from '@/apollo/graphql'
import { useEffect, useRef, useState } from 'react'
import { FaEyeSlash, FaEye, FaUndo, FaTrashAlt } from 'react-icons/fa'
import { Button } from '../../common/Button'

import { LogSecretReads } from '@/graphql/mutations/environments/readSecret.gql'
import clsx from 'clsx'
import { useMutation } from '@apollo/client'
import { areTagsAreSame } from '@/utils/tags'

import { CommentDialog } from './CommentDialog'
import { HistoryDialog } from './HistoryDialog'
import { OverrideDialog } from './OverrideDialog'
import { TagsDialog } from './TagsDialog'
import { ShareSecretDialog } from './ShareSecretDialog'
import { toggleBooleanKeepingCase } from '@/utils/secrets'
import { Switch } from '@headlessui/react'

export default function SecretRow(props: {
  orgId: string
  secret: SecretType
  environment: EnvironmentType
  cannonicalSecret: SecretType | undefined
  secretNames: Array<Partial<SecretType>>
  handlePropertyChange: Function
  handleDelete: Function
  globallyRevealed: boolean
  stagedForDelete?: boolean
}) {
  const {
    orgId,
    secret,
    cannonicalSecret,
    secretNames,
    handlePropertyChange,
    handleDelete,
    globallyRevealed,
    stagedForDelete,
  } = props

  const isBoolean = ['true', 'false'].includes(secret.value.toLowerCase())

  const booleanValue = secret.value.toLowerCase() === 'true'

  const [isRevealed, setIsRevealed] = useState<boolean>(false)

  const keyInputRef = useRef<HTMLInputElement>(null)

  const [readSecret] = useMutation(LogSecretReads)

  const handleRevealSecret = async () => {
    setIsRevealed(true)
    if (cannonicalSecret !== undefined) await readSecret({ variables: { ids: [secret.id] } })
  }

  const handleHideSecret = () => setIsRevealed(false)

  // Reveal boolean values on mount for boolean secrets
  useEffect(() => {
    if (isBoolean) setIsRevealed(true)
  }, [isBoolean])

  // Reveal newly created secrets by default
  useEffect(() => {
    if (cannonicalSecret === undefined) {
      setIsRevealed(true)
      if (keyInputRef.current) {
        keyInputRef.current.focus()
      }
    }
  }, [cannonicalSecret])

  // Handle global reveal
  useEffect(() => {
    if ((!isBoolean || globallyRevealed) && cannonicalSecret) setIsRevealed(globallyRevealed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globallyRevealed, isBoolean])

  const handleToggleBoolean = () => {
    const toggledValue = toggleBooleanKeepingCase(secret.value)
    handlePropertyChange(secret.id, 'value', toggledValue)
  }

  const toggleReveal = () => {
    isRevealed ? handleHideSecret() : handleRevealSecret()
  }

  const INPUT_BASE_STYLE =
    'w-full font-mono custom bg-transparent group-hover:bg-zinc-400/20 dark:group-hover:bg-zinc-400/10 transition ease ph-no-capture'

  const keyIsBlank = secret.key.length === 0

  const keyIsDuplicate =
    secretNames.findIndex((s) => s.key === secret.key && s.id !== secret.id) > -1

  const secretHasBeenModified = () => {
    if (cannonicalSecret === undefined) return true
    return (
      secret.key !== cannonicalSecret.key ||
      secret.value !== cannonicalSecret.value ||
      secret.comment !== cannonicalSecret.comment ||
      !areTagsAreSame(secret.tags, cannonicalSecret.tags)
    )
  }

  const rowBgColor = () => {
    if (!cannonicalSecret) return 'bg-emerald-400/20 dark:bg-emerald-400/10'
    else if (secretHasBeenModified()) return 'bg-amber-400/20 dark:bg-amber-400/10'
    else if (stagedForDelete) return 'bg-red-400/20 dark:bg-red-400/10'
  }

  const inputTextColor = () => {
    if (!cannonicalSecret) return 'text-emerald-900 dark:text-emerald-200'
    else if (secretHasBeenModified()) return 'text-amber-800 dark:text-amber-300'
    else if (stagedForDelete) return 'text-red-700 dark:text-red-400 line-through'
    else return 'text-zinc-900 dark:text-zinc-100'
  }

  return (
    <div className={clsx('flex flex-row w-full gap-2 group relative z-0', rowBgColor())}>
      <div className="w-1/3 relative">
        <input
          ref={keyInputRef}
          className={clsx(
            INPUT_BASE_STYLE,
            'rounded-sm',
            keyIsBlank
              ? 'ring-1 ring-inset ring-red-500'
              : keyIsDuplicate
                ? 'ring-1 ring-inset ring-amber-500'
                : 'focus:ring-1 focus:ring-inset focus:ring-zinc-500',
            inputTextColor()
          )}
          value={secret.key}
          onChange={(e) =>
            handlePropertyChange(secret.id, 'key', e.target.value.replace(/ /g, '_').toUpperCase())
          }
        />
        <div className="absolute inset-y-0 right-2 flex gap-1 items-center">
          <div
            className={clsx(
              secret.tags.length === 0 &&
                'opacity-0 group-hover:opacity-100 transition-opacity ease'
            )}
          >
            <TagsDialog
              orgId={orgId}
              secretName={secret.key}
              secretId={secret.id}
              tags={secret.tags}
              handlePropertyChange={handlePropertyChange}
            />
          </div>
        </div>
      </div>
      <div className="w-2/3 relative flex justify-between gap-2 focus-within:ring-1 focus-within:ring-inset focus-within:ring-zinc-500 rounded-sm bg-transparent transition ease p-px">
        {isBoolean && (
          <div className="flex items-center px-2">
            <Switch
              title="Toggle value"
              checked={booleanValue}
              onChange={handleToggleBoolean}
              className={`${
                booleanValue
                  ? 'bg-emerald-400/10 ring-emerald-400/20'
                  : 'bg-neutral-500/40 ring-neutral-500/30'
              } relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset`}
            >
              <span className="sr-only">Toggle</span>
              <span
                className={`${
                  booleanValue ? 'translate-x-6 bg-emerald-400' : 'translate-x-1 bg-neutral-500'
                } flex items-center justify-center h-4 w-4 transform rounded-full transition`}
              ></span>
            </Switch>
          </div>
        )}
        <input
          className={clsx(INPUT_BASE_STYLE, inputTextColor(), 'w-full focus:outline-none p-2')}
          value={secret.value}
          type={isRevealed ? 'text' : 'password'}
          onChange={(e) => handlePropertyChange(secret.id, 'value', e.target.value)}
        />

        <div className="flex gap-1 items-center group-hover:bg-zinc-100/30 group-hover:dark:bg-zinc-800/30 z-10">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity ease">
            {!isBoolean && (
              <Button
                variant="outline"
                tabIndex={-1}
                onClick={toggleReveal}
                title={isRevealed ? 'Mask value' : 'Reveal value'}
              >
                <span className="2xl:py-1">{isRevealed ? <FaEyeSlash /> : <FaEye />}</span>{' '}
                <span className="hidden 2xl:block text-xs">{isRevealed ? 'Mask' : 'Reveal'}</span>
              </Button>
            )}
          </div>

          <div className="opacity-0 group-hover:opacity-100 transition-opacity ease">
            <HistoryDialog secret={secret} handlePropertyChange={handlePropertyChange} />
          </div>

          <div
            className={clsx(
              secret.comment.length === 0 &&
                'opacity-0 group-hover:opacity-100 transition-opacity ease'
            )}
          >
            <CommentDialog
              secretName={secret.key}
              secretId={secret.id}
              comment={secret.comment}
              handlePropertyChange={handlePropertyChange}
            />
          </div>

          {cannonicalSecret && (
            <div
              className={clsx(
                (!secret.override || !secret.override.isActive) &&
                  'opacity-0 group-hover:opacity-100 transition-opacity ease'
              )}
            >
              <OverrideDialog
                secretName={secret.key}
                secretId={secret.id}
                environment={props.environment}
                override={secret.override!}
              />
            </div>
          )}

          {cannonicalSecret && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity ease">
              <ShareSecretDialog secret={secret} />
            </div>
          )}
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity ease flex items-center">
        {/* <DeleteConfirmDialog secretName={secret.key} secretId={secret.id} onDelete={handleDelete} /> */}
        <Button
          variant="danger"
          onClick={() => handleDelete(secret.id)}
          title={stagedForDelete ? 'Restore this secret' : 'Delete this secret'}
        >
          <div className="text-white dark:text-red-500 flex items-center gap-1 p-1">
            {stagedForDelete ? <FaUndo /> : <FaTrashAlt />}
          </div>
        </Button>
      </div>
    </div>
  )
}
