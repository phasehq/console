import { ApiSecretTypeChoices, EnvironmentType, SecretType } from '@/apollo/graphql'
import { useCallback, useContext, useEffect, useRef, useState, memo } from 'react'
import {
  FaEyeSlash,
  FaEye,
  FaUndo,
  FaTrashAlt,
  FaCompressArrowsAlt,
  FaExpandArrowsAlt,
  FaLock,
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
import { useAppPermissions } from '@/hooks/useAppPermissions'
import { useParams } from 'next/navigation'
import { MaskedTextarea } from '@/components/common/MaskedTextarea'
import { TypeSelector } from './TypeSelector'
import { useSecretReferenceAutocomplete } from '@/hooks/useSecretReferenceAutocomplete'
import { ReferenceAutocompleteDropdown } from '@/components/secrets/ReferenceAutocompleteDropdown'
import { SecretReferenceHighlight } from '@/components/secrets/SecretReferenceHighlight'
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
  const routeParams = useParams<{ app: string }>()
  const { hasPermission } = useAppPermissions(routeParams!.app)

  // Permissions
  const userCanUpdateSecrets = hasPermission('Secrets', 'update', true) || !canonicalSecret
  const userCanDeleteSecrets = hasPermission('Secrets', 'delete', true) || !canonicalSecret

  const isConfig = secret.type === ApiSecretTypeChoices.Config
  const isNewSecret = canonicalSecret === undefined
  // Only lock when the server version is sealed (so users can still change type before saving)
  const isSealedAndSaved = canonicalSecret?.type === ApiSecretTypeChoices.Sealed

  const isBoolean = !isSealedAndSaved && ['true', 'false'].includes(secret.value.toLowerCase())

  const booleanValue = secret.value.toLowerCase() === 'true'

  // Config: revealed by default. Sealed (saved): never revealed. New secrets: revealed.
  const getInitialRevealState = () => {
    if (isNewSecret) return true
    if (isSealedAndSaved) return false
    if (isConfig) return true
    return false
  }

  const [isRevealed, setIsRevealed] = useState<boolean>(getInitialRevealState())
  const [expanded, setExpanded] = useState(false)

  const keyInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const stableValueChange = useCallback(
    (value: string) => {
      handlePropertyChange(secret.id, 'value', value)
    },
    [handlePropertyChange, secret.id]
  )

  const autocomplete = useSecretReferenceAutocomplete({
    value: secret.value,
    isRevealed,
    textareaRef,
    onChange: stableValueChange,
    currentSecretKey: secret.key,
  })

  const highlightContent =
    isRevealed && secret.value.includes('${') ? (
      <SecretReferenceHighlight value={secret.value} />
    ) : undefined

  const [readSecret] = useMutation(LogSecretReads)

  const handleRevealSecret = async () => {
    if (isSealedAndSaved) return
    setIsRevealed(true)
    if (canonicalSecret !== undefined) await readSecret({ variables: { ids: [secret.id] } })
  }

  const toggleExpanded = () => setExpanded((currentExpanded) => !currentExpanded)

  const isMultiLine = secret.value.includes('\n')

  const handleHideSecret = () => {
    if (isSealedAndSaved) return
    setIsRevealed(false)
  }

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
    if (isSealedAndSaved) return // Sealed secrets: always masked
    if (isConfig) {
      setIsRevealed(true) // Config: always revealed
      return
    }
    if (!isBoolean || globallyRevealed) setIsRevealed(globallyRevealed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globallyRevealed, isBoolean, isSealedAndSaved, isConfig])

  const handleToggleBoolean = () => {
    const toggledValue = toggleBooleanKeepingCase(secret.value)
    handlePropertyChange(secret.id, 'value', toggledValue)
  }

  const toggleReveal = () => {
    if (isSealedAndSaved) return
    isRevealed ? handleHideSecret() : handleRevealSecret()
  }

  const focusNextRowKey = (currentElement: HTMLElement) => {
    const row = currentElement.closest('[data-secret-row]')
    // The row's parent is a wrapper div in page.tsx; siblings are at that level
    const wrapper = row?.parentElement
    const nextWrapper = wrapper?.nextElementSibling
    const nextKeyInput = nextWrapper?.querySelector('input') as HTMLElement | null
    nextKeyInput?.focus()
  }

  const INPUT_BASE_STYLE =
    'w-full font-mono custom bg-transparent group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700 transition ease ph-no-capture rounded-lg text-2xs 2xl:text-sm'

  const keyIsBlank = secret.key.length === 0

  const keyIsDuplicate =
    secretNames.findIndex((s) => s.key === secret.key && s.id !== secret.id) > -1

  const secretHasBeenModified = () => {
    if (canonicalSecret === undefined) return true
    return (
      secret.key !== canonicalSecret.key ||
      secret.value !== canonicalSecret.value ||
      secret.comment !== canonicalSecret.comment ||
      secret.type !== canonicalSecret.type ||
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
    if (isSealedAndSaved) return
    handlePropertyChange(secret.id, 'value', value)

    if (value.includes('\n') && !expanded) setExpanded(true)
  }

  const keyActionMenu = (
    <>
      <div className="flex items-center gap-1 absolute right-1 top-1/2 -translate-y-1/2 opacity-100 group-hover:opacity-0 group-focus-within:opacity-0 text-2xs">
        <div className="flex items-center gap-0.5">
          {secret.tags.map((tag) => (
            <FaCircle key={`tag-indicator-${tag.id}`} className="text-[8px]" color={tag.color} />
          ))}
        </div>
        <div>{secret.comment.length > 0 && <FaHashtag className="text-emerald-500" />}</div>
      </div>
      <div
        className={clsx(
          'flex gap-1 items-center pt-1 px-1 rounded-t-lg',
          'bg-zinc-200 dark:bg-zinc-700',
          'z-10 group-hover:z-10 group-focus-within:z-10 absolute right-0 -top-9 translate-y-9 group-hover:translate-y-0 group-focus-within:translate-y-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          'transition ease'
        )}
      >
        {!stagedForDelete && userCanUpdateSecrets && (
          <TypeSelector
            currentType={secret.type}
            onChange={(type) => handlePropertyChange(secret.id, 'type', type)}
            disabled={isSealedAndSaved}
          />
        )}
        <div
          className={clsx(
            secret.tags.length === 0 && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity ease'
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
                'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity ease'
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
        'flex gap-1 items-start pt-1 rounded-t-lg right-0 px-1 transition ease',
        'bg-zinc-200 dark:bg-zinc-700',
        'z-10 absolute -top-9 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 translate-y-9 group-hover:translate-y-0 group-focus-within:translate-y-0'
      )}
    >
      {isMultiLine && (
        <div className="">
          <Button
            variant="ghost"
            tabIndex={-1}
            onClick={() => toggleExpanded()}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <div className="py-1">{expanded ? <FaCompressArrowsAlt /> : <FaExpandArrowsAlt />}</div>
          </Button>
        </div>
      )}

      <div className="">
        {!isBoolean && !isSealedAndSaved && (
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
        {isSealedAndSaved && (
          <span
            className="text-xs text-neutral-500 px-2 py-1 flex items-center gap-1"
            title="This secret is sealed and cannot be revealed"
          >
            <FaLock /> Sealed
          </span>
        )}
      </div>

      {!stagedForDelete && (
        <div className="">
          <HistoryDialog secret={secret} handlePropertyChange={handlePropertyChange} />
        </div>
      )}

      {canonicalSecret && !stagedForDelete && !isSealedAndSaved && (
        <div className={clsx((!secret.override || !secret.override.isActive) && '')}>
          <OverrideDialog
            secretName={secret.key}
            secretId={secret.id}
            environment={props.environment}
            override={secret.override!}
          />
        </div>
      )}

      {canonicalSecret && !isSealedAndSaved && (
        <div className="">
          <ShareSecretDialog secret={secret} />
        </div>
      )}

      {userCanDeleteSecrets && (
        <Button
          variant="danger"
          tabIndex={-1}
          onClick={() => handleDelete(secret.id)}
          title={stagedForDelete ? 'Restore this secret' : 'Delete this secret'}
        >
          <div className="p-1">{stagedForDelete ? <FaUndo /> : <FaTrashAlt />}</div>
        </Button>
      )}
    </div>
  )

  return (
    <div data-secret-row className={clsx('flex flex-row w-full gap-2 z-0 relative hover:z-10 focus-within:z-20', rowBgColor())}>
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
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault()
              if (isSealedAndSaved) {
                focusNextRowKey(e.currentTarget)
              } else {
                ;(
                  e.currentTarget.parentElement?.nextElementSibling?.querySelector(
                    'textarea'
                  ) as HTMLElement
                )?.focus()
              }
            }
          }}
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
      <div className={clsx("w-2/3 group flex justify-between gap-2 focus-within:ring-1 focus-within:ring-inset focus-within:ring-zinc-500 rounded-lg bg-transparent transition ease", autocomplete.isOpen && 'rounded-bl-none')}>
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

        <div className="relative flex-1 z-20">
          <MaskedTextarea
            ref={textareaRef}
            className={clsx(
              INPUT_BASE_STYLE,
              inputTextColor(),
              'w-full group-hover:rounded-tr-none',
              autocomplete.isOpen && 'rounded-bl-none'
            )}
            value={isSealedAndSaved ? '' : secret.value}
            onChange={(v) => {
              handleValueChange(v)
              autocomplete.handleChange()
            }}
            onKeyDown={(e) => {
              autocomplete.handleKeyDown(e)
              if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault()
                focusNextRowKey(e.currentTarget)
              }
            }}
            onSelect={autocomplete.handleSelect}
            onBlur={autocomplete.handleBlur}
            isRevealed={isRevealed}
            expanded={expanded}
            onFocus={() => {
              setExpanded(true)
              // Move cursor to end for new secrets with prefilled values (e.g. reference shortcut)
              if (isNewSecret && secret.value && textareaRef.current) {
                const len = secret.value.length
                textareaRef.current.selectionStart = len
                textareaRef.current.selectionEnd = len
              }
              autocomplete.handleFocus()
            }}
            disabled={stagedForDelete || !userCanUpdateSecrets || isSealedAndSaved}
            placeholder={isSealedAndSaved ? 'Sealed secret' : undefined}
            highlightContent={highlightContent}
          />
          <ReferenceAutocompleteDropdown
            suggestions={autocomplete.suggestions}
            activeIndex={autocomplete.activeIndex}
            onSelect={autocomplete.acceptSuggestion}
            onNavigate={autocomplete.navigateToSuggestion}
            visible={autocomplete.isOpen}
          />
        </div>
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
