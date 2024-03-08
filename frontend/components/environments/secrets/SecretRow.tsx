import { EnvironmentType, SecretType } from '@/apollo/graphql'
import { useEffect, useRef, useState } from 'react'
import { FaEyeSlash, FaEye } from 'react-icons/fa'
import { Button } from '../../common/Button'

import { LogSecretRead } from '@/graphql/mutations/environments/readSecret.gql'
import clsx from 'clsx'
import { useMutation } from '@apollo/client'
import { areTagsAreSame } from '@/utils/tags'

import { DeleteConfirmDialog } from './DeleteDialog'
import { CommentDialog } from './CommentDialog'
import { HistoryDialog } from './HistoryDialog'
import { OverrideDialog } from './OverrideDialog'
import { TagsDialog } from './TagsDialog'
import { ShareSecretDialog } from './ShareSecretDialog'

export default function SecretRow(props: {
  orgId: string
  secret: SecretType
  environment: EnvironmentType
  cannonicalSecret: SecretType | undefined
  secretNames: Array<Partial<SecretType>>
  handlePropertyChange: Function
  handleDelete: Function
}) {
  const { orgId, secret, cannonicalSecret, secretNames, handlePropertyChange, handleDelete } = props

  const [isRevealed, setIsRevealed] = useState<boolean>(false)

  const keyInputRef = useRef<HTMLInputElement>(null)

  const [readSecret] = useMutation(LogSecretRead)

  // Reveal newly created secrets by default
  useEffect(() => {
    if (cannonicalSecret === undefined) {
      setIsRevealed(true)
      if (keyInputRef.current) {
        keyInputRef.current.focus()
      }
    }
  }, [cannonicalSecret])

  const handleRevealSecret = async () => {
    setIsRevealed(true)
    if (cannonicalSecret !== undefined) await readSecret({ variables: { id: secret.id } })
  }

  const handleHideSecret = () => setIsRevealed(false)

  const toggleReveal = () => {
    isRevealed ? handleHideSecret() : handleRevealSecret()
  }

  const INPUT_BASE_STYLE =
    'w-full text-zinc-800 font-mono custom bg-transparent group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700 dark:text-white transition ease ph-no-capture'

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

  return (
    <div className="flex flex-row w-full gap-2 group relative z-0">
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
            secretHasBeenModified() && '!text-amber-500'
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
      <div className="w-2/3 relative flex justify-between gap-2 focus-within:ring-1 focus-within:ring-inset focus-within:ring-zinc-500 rounded-sm bg-transparent group-hover:bg-zinc-100 dark:group-hover:bg-zinc-700 transition ease p-px">
        <input
          className={clsx(INPUT_BASE_STYLE, 'w-full focus:outline-none p-2')}
          value={secret.value}
          type={isRevealed ? 'text' : 'password'}
          onChange={(e) => handlePropertyChange(secret.id, 'value', e.target.value)}
        />

        <div className="flex gap-1 items-center group-hover:bg-zinc-100/30 group-hover:dark:bg-zinc-800/30 z-10">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity ease">
            <Button
              variant="outline"
              tabIndex={-1}
              onClick={toggleReveal}
              title={isRevealed ? 'Mask value' : 'Reveal value'}
            >
              <span className="2xl:py-1">{isRevealed ? <FaEyeSlash /> : <FaEye />}</span>{' '}
              <span className="hidden 2xl:block text-xs">{isRevealed ? 'Mask' : 'Reveal'}</span>
            </Button>
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

          <div className="opacity-0 group-hover:opacity-100 transition-opacity ease">
            <ShareSecretDialog secret={secret} />
          </div>
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity ease flex items-center">
        <DeleteConfirmDialog secretName={secret.key} secretId={secret.id} onDelete={handleDelete} />
      </div>
    </div>
  )
}
