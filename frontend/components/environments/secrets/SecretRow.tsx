import { EnvironmentType, SecretType } from '@/apollo/graphql'
import { useContext, useEffect, useRef, useState, memo } from 'react'
import {
  FaEyeSlash,
  FaEye,
  FaUndo,
  FaTrashAlt,
  FaCompressArrowsAlt,
  FaExpandArrowsAlt,
} from 'react-icons/fa'
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
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { MaskedTextarea } from '@/components/common/MaskedTextarea'
import { FaCircle, FaHashtag } from 'react-icons/fa6'

function SecretRow(props: {
  orgId: string
  secret: SecretType & { isImported?: boolean }
  environment: EnvironmentType
  canonicalSecret: SecretType | undefined
  secretNames: Array<Partial<SecretType>>
  handlePropertyChange: Function
  handleDelete: Function
  globallyRevealed: boolean
  stagedForDelete?: boolean
}) {
  const {
    orgId,
    secret,
    canonicalSecret,
    secretNames,
    handlePropertyChange,
    handleDelete,
    globallyRevealed,
    stagedForDelete,
  } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  // Permissions
  const userCanUpdateSecrets =
    userHasPermission(organisation?.role?.permissions, 'Secrets', 'update', true) ||
    !canonicalSecret
  const userCanDeleteSecrets =
    userHasPermission(organisation?.role?.permissions, 'Secrets', 'delete', true) ||
    !canonicalSecret

  const isBoolean = ['true', 'false'].includes(secret.value.toLowerCase())

  const booleanValue = secret.value.toLowerCase() === 'true'

  const [isRevealed, setIsRevealed] = useState<boolean>(canonicalSecret === undefined)
  const [expanded, setExpanded] = useState(false)

  const keyInputRef = useRef<HTMLInputElement>(null)

  const [readSecret] = useMutation(LogSecretReads)

  const handleRevealSecret = async () => {
    setIsRevealed(true)
    if (canonicalSecret !== undefined) await readSecret({ variables: { ids: [secret.id] } })
  }

  const toggleExpanded = () => setExpanded((currentExpanded) => !currentExpanded)

  const isMultiLine = secret.value.includes('\n')

  const handleHideSecret = () => setIsRevealed(false)

  // Reveal boolean values on mount for boolean secrets
  useEffect(() => {
    if (isBoolean) setIsRevealed(true)
  }, [isBoolean])

  // Focus and reveal newly created secrets
  // The setTimeout is a hack to override the initial state change based on the value of  globallyRevealed
  useEffect(() => {
    if (canonicalSecret === undefined) {
      setTimeout(() => setIsRevealed(true), 100)
      if (keyInputRef.current && !secret.isImported) {
        keyInputRef.current.focus()
      }
    }
  }, [canonicalSecret, secret.isImported])

  // Handle global reveal
  useEffect(() => {
    if (!isBoolean || globallyRevealed) setIsRevealed(globallyRevealed)
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
    'w-full font-mono custom bg-transparent group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700 transition ease ph-no-capture rounded-lg'

  const keyIsBlank = secret.key.length === 0

  const keyIsDuplicate =
    secretNames.findIndex((s) => s.key === secret.key && s.id !== secret.id) > -1

  const secretHasBeenModified = () => {
    if (canonicalSecret === undefined) return true
    return (
      secret.key !== canonicalSecret.key ||
      secret.value !== canonicalSecret.value ||
      secret.comment !== canonicalSecret.comment ||
      !areTagsAreSame(secret.tags, canonicalSecret.tags)
    )
  }

  const rowBgColor = () => {
    if (!canonicalSecret) return 'bg-emerald-400/20 dark:bg-emerald-400/10'
    else if (stagedForDelete) return 'bg-red-400/20 dark:bg-red-400/10'
    else if (secretHasBeenModified()) return 'bg-amber-400/20 dark:bg-amber-400/10'
  }

  const inputTextColor = () => {
    if (!canonicalSecret) return 'text-emerald-700 dark:text-emerald-200'
    else if (stagedForDelete) return 'text-red-700 dark:text-red-400 line-through'
    else if (secretHasBeenModified()) return 'text-amber-700 dark:text-amber-300'
    else return 'text-zinc-900 dark:text-zinc-100'
  }

  const handleValueChange = (value: string) => {
    handlePropertyChange(secret.id, 'value', value)

    if (value.includes('\n') && !expanded) setExpanded(true)
  }

  const keyActionMenu = (
    <>
      <div className="flex items-center gap-1 absolute right-1 top-3 opacity-100 group-hover:opacity-0 text-2xs">
        <div className="flex items-center gap-0.5">
          {secret.tags.map((tag) => (
            <FaCircle key={`tag-indicator-${tag.id}`} color={tag.color} />
          ))}
        </div>
        <div>{secret.comment.length > 0 && <FaHashtag className="text-emerald-500" />}</div>
      </div>
      <div
        className={clsx(
          'flex gap-1 items-center pt-1 px-1 rounded-t-lg',
          'bg-zinc-200 dark:bg-zinc-700',
          'z-10 group-hover:z-10 absolute right-0 -top-9 translate-y-9 group-hover:translate-y-0 opacity-0 group-hover:opacity-100',
          'transition ease'
        )}
      >
        <div
          className={clsx(
            secret.tags.length === 0 && 'opacity-0 group-hover:opacity-100 transition-opacity ease'
          )}
        >
          <TagsDialog
            orgId={orgId}
            secretName={secret.key}
            secretId={secret.id}
            tags={secret.tags}
            handlePropertyChange={handlePropertyChange}
            disabled={!userCanUpdateSecrets}
          />
        </div>
        {!stagedForDelete && (
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
        )}
      </div>
    </>
  )

  const valueActionMenu = (
    <div
      className={clsx(
        'flex gap-1 items-start pt-1 rounded-t-lg right-px px-1 transition ease',
        'bg-zinc-200 dark:bg-zinc-700',
        'z-10 absolute -top-9 opacity-0 group-hover:opacity-100 translate-y-9 group-hover:translate-y-0'
      )}
    >
      {isMultiLine && (
        <div className="">
          <Button
            variant="ghost"
            onClick={() => toggleExpanded()}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <div className="py-1">{expanded ? <FaCompressArrowsAlt /> : <FaExpandArrowsAlt />}</div>
          </Button>
        </div>
      )}

      <div className="">
        {!isBoolean && (
          <Button
            variant="outline"
            tabIndex={-1}
            onClick={toggleReveal}
            title={isRevealed ? 'Mask value' : 'Reveal value'}
          >
            <span className="py-1">{isRevealed ? <FaEyeSlash /> : <FaEye />}</span>{' '}
            <span className="hidden 2xl:block text-xs">{isRevealed ? 'Mask' : 'Reveal'}</span>
          </Button>
        )}
      </div>

      {!stagedForDelete && (
        <div className="">
          <HistoryDialog secret={secret} handlePropertyChange={handlePropertyChange} />
        </div>
      )}

      {canonicalSecret && !stagedForDelete && (
        <div className={clsx((!secret.override || !secret.override.isActive) && '')}>
          <OverrideDialog
            secretName={secret.key}
            secretId={secret.id}
            environment={props.environment}
            override={secret.override!}
          />
        </div>
      )}

      {canonicalSecret && (
        <div className="">
          <ShareSecretDialog secret={secret} />
        </div>
      )}

      {userCanDeleteSecrets && (
        <Button
          variant="danger"
          onClick={() => handleDelete(secret.id)}
          title={stagedForDelete ? 'Restore this secret' : 'Delete this secret'}
        >
          <div className="p-1">{stagedForDelete ? <FaUndo /> : <FaTrashAlt />}</div>
        </Button>
      )}
    </div>
  )

  return (
    <div className={clsx('flex flex-row w-full gap-2 z-0 relative hover:z-10', rowBgColor())}>
      <div className="w-1/3 relative group peer">
        <input
          ref={keyInputRef}
          disabled={stagedForDelete || !userCanUpdateSecrets}
          className={clsx(
            INPUT_BASE_STYLE,
            'rounded-lg group-hover:rounded-tr-none',
            '',
            keyIsBlank
              ? 'ring-1 ring-inset ring-red-500'
              : keyIsDuplicate
                ? 'ring-1 ring-inset ring-amber-500'
                : 'focus:ring-1 focus:ring-inset focus:ring-zinc-500',
            inputTextColor()
          )}
          value={secret.key}
          onChange={(e) => {
            const { selectionStart } = e.target
            handlePropertyChange(secret.id, 'key', e.target.value.replace(/ /g, '_').toUpperCase())
            requestAnimationFrame(() => {
              if (keyInputRef.current) {
                keyInputRef.current.selectionStart = selectionStart
                keyInputRef.current.selectionEnd = selectionStart
              }
            })
          }}
        />
        {keyActionMenu}
      </div>
      <div className="w-2/3 group flex justify-between gap-2 focus-within:ring-1 focus-within:ring-inset focus-within:ring-zinc-500 rounded-lg bg-transparent transition ease p-px">
        {isBoolean && !stagedForDelete && (
          <div className="flex items-center px-2">
            <Switch
              title="Toggle value"
              checked={booleanValue}
              onChange={handleToggleBoolean}
              disabled={stagedForDelete || !userCanUpdateSecrets}
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

        <MaskedTextarea
          className={clsx(
            INPUT_BASE_STYLE,
            inputTextColor(),
            'w-full p-2 group-hover:rounded-tr-none'
          )}
          value={secret.value}
          onChange={(v) => handleValueChange(v)}
          isRevealed={isRevealed}
          expanded={expanded}
          onFocus={() => setExpanded(true)}
          disabled={stagedForDelete || !userCanUpdateSecrets}
        />
        {valueActionMenu}
      </div>
    </div>
  )
}

export default memo(SecretRow, (prev, next) => {
  // Re-render only when the row's relevant props change
  return (
    prev.secret === next.secret &&
    prev.canonicalSecret === next.canonicalSecret &&
    prev.globallyRevealed === next.globallyRevealed &&
    prev.stagedForDelete === next.stagedForDelete &&
    prev.orgId === next.orgId &&
    prev.environment === next.environment
  )
})
