'use client'

import { ApiSecretTypeChoices, EnvironmentType, SecretType } from '@/apollo/graphql'
import { Switch } from '@headlessui/react'
import clsx from 'clsx'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FaCheckCircle,
  FaCompressArrowsAlt,
  FaCopy,
  FaExpandArrowsAlt,
  FaEye,
  FaEyeSlash,
  FaLock,
  FaTrashAlt,
  FaUndo,
} from 'react-icons/fa'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'
import { MaskedTextarea } from '@/components/common/MaskedTextarea'
import { HistoryDialog } from '@/components/environments/secrets/HistoryDialog'
import { OverrideDialog } from '@/components/environments/secrets/OverrideDialog'
import { ShareSecretDialog } from '@/components/environments/secrets/ShareSecretDialog'
import { ReferenceAutocompleteDropdown } from '@/components/secrets/ReferenceAutocompleteDropdown'
import { SecretReferenceHighlight } from '@/components/secrets/SecretReferenceHighlight'
import { useSecretReferenceAutocomplete } from '@/hooks/useSecretReferenceAutocomplete'
import { toggleBooleanKeepingCase } from '@/utils/secrets'
import { STATUS_CELL_STYLES, STATUS_FLASH_STYLES, SecretCellStatus } from './SecretInfoLegend'
import { MissingCell } from './MissingCell'

export type SecretWithFlags = SecretType & { stagedForDelete?: boolean }

export type EnvEntry = {
  env: Partial<EnvironmentType>
  secret: SecretWithFlags | null
}

/**
 * Tab order through the grid like the single-env editor: key → each value in
 * the row → the next row's key. Returns false when there's nowhere to go, so
 * the browser's default applies.
 */
export const focusNextGridField = (from: HTMLElement): boolean => {
  const FIELDS = 'td input:not([disabled]), td textarea:not([disabled])'
  const row = from.closest('tr')
  if (!row) return false
  const fields = Array.from(row.querySelectorAll<HTMLElement>(FIELDS))
  let next: HTMLElement | null | undefined = fields[fields.indexOf(from) + 1]
  // Group headers, folders and dynamic keys have no fields — skip past them
  for (let sibling = row.nextElementSibling; !next && sibling; sibling = sibling.nextElementSibling) {
    next = sibling.querySelector<HTMLElement>(FIELDS)
  }
  if (!next) return false
  next.focus()
  return true
}

// Transparent and square: the cell itself is the field (FIELD_FILL)
const INPUT_BASE_STYLE =
  'w-full font-mono custom bg-transparent transition ease ph-no-capture text-2xs 2xl:text-xs'

// The whole cell lights up as the field on hover and focus; the menu rises from its top edge
const FIELD_FILL =
  'group-hover/cell:bg-zinc-200 group-focus-within/cell:bg-zinc-200 dark:group-hover/cell:bg-zinc-700 dark:group-focus-within/cell:bg-zinc-700 ring-inset ring-zinc-500 group-focus-within/cell:ring-1'

export type EnvValueCellProps = {
  rowId: string
  entry: EnvEntry
  serverEntry?: EnvEntry
  /** The row's current key (autocomplete, share and override labels) */
  rowKey: string
  keyIsStagedForDelete: boolean
  sameAsProd: boolean
  /** Rows owned by a rotation label missing values "Add static value" */
  inRotatingGroup: boolean
  globallyRevealed: boolean
  revealOnHover: boolean
  /** Deep-link / jump target: scroll into view and flash */
  highlighted: boolean
  canUpdateSecrets: boolean
  canDeleteSecrets: boolean
  updateValue: (rowId: string, envId: string, value: string) => void
  addValue: (rowId: string, env: EnvironmentType) => void
  deleteValue: (rowId: string, env: EnvironmentType) => void
  /** Logs reveals of saved values (one mutation shared by the grid) */
  logReads: (ids: string[]) => void
}

/**
 * One environment's value for a key, edited in place — the single-env value
 * editor (reveal, copy, multi-line expand, boolean switch, references,
 * history, personal override, share) rendered as a grid cell.
 */
const EnvValueCellBase = ({
  rowId,
  entry,
  serverEntry,
  rowKey,
  keyIsStagedForDelete,
  sameAsProd,
  inRotatingGroup,
  globallyRevealed,
  revealOnHover,
  highlighted,
  canUpdateSecrets,
  canDeleteSecrets,
  updateValue,
  addValue,
  deleteValue,
  logReads,
}: EnvValueCellProps) => {
  const secret = entry.secret
  const serverSecret = serverEntry?.secret ?? null
  const env = entry.env as EnvironmentType

  const isNew = secret !== null && serverSecret === null
  const isSealedAndSaved = serverSecret?.type === ApiSecretTypeChoices.Sealed
  const isConfig = secret?.type === ApiSecretTypeChoices.Config
  const isRotating = Boolean(secret?.rotatingSecretId)
  const stagedForDelete = Boolean(secret?.stagedForDelete) || keyIsStagedForDelete
  const value = secret?.value ?? ''
  const isBoolean = secret !== null && !isSealedAndSaved && ['true', 'false'].includes(value.toLowerCase())
  const isMultiLine = value.includes('\n')
  const valueModified = !isNew && secret !== null && serverSecret !== null && serverSecret.value !== value

  // Rotation owns the value; a brand-new value is always editable by whoever added it
  const userCanUpdate = !isRotating && (canUpdateSecrets || isNew)
  const userCanDelete = !isRotating && (canDeleteSecrets || isNew)

  const [isRevealed, setIsRevealed] = useState<boolean>(() => {
    if (isNew) return true
    if (isSealedAndSaved) return false
    if (isConfig) return true
    return value === ''
  })
  const [expanded, setExpanded] = useState(false)
  // The tray's dialogs mount on first hover/focus — every idle cell carrying
  // history/override/share dialogs makes large grids slow to render
  const [trayMounted, setTrayMounted] = useState(false)
  // Set by "Add value" so the new value's field takes focus once it renders
  const focusValueRef = useRef(false)

  const revealValue = () => {
    if (isSealedAndSaved || !secret) return
    setIsRevealed(true)
    if (serverSecret) logReads([serverSecret.id])
  }

  const toggleReveal = () => {
    if (isSealedAndSaved) return
    isRevealed ? setIsRevealed(false) : revealValue()
  }

  // Booleans are always revealed (the switch shows the value)
  useEffect(() => {
    if (isBoolean) setIsRevealed(true)
  }, [isBoolean])

  // Global reveal/mask, acting only on actual toggles so mount-time rules stand
  const prevGlobalRef = useRef(globallyRevealed)
  useEffect(() => {
    if (prevGlobalRef.current === globallyRevealed) return
    prevGlobalRef.current = globallyRevealed
    if (isSealedAndSaved) return
    if (isConfig) setIsRevealed(true)
    else if (!isBoolean || globallyRevealed) setIsRevealed(globallyRevealed)
  }, [globallyRevealed, isBoolean, isConfig, isSealedAndSaved])

  // Type toggles: config reveals, anything else masks (booleans stay revealed)
  const prevTypeRef = useRef(secret?.type)
  useEffect(() => {
    const nextType = secret?.type
    const prevType = prevTypeRef.current
    prevTypeRef.current = nextType
    if (prevType == null || nextType == null || prevType === nextType || isSealedAndSaved) return
    if (nextType === ApiSecretTypeChoices.Config) setIsRevealed(true)
    else if (!isBoolean) setIsRevealed(false)
  }, [secret?.type, isSealedAndSaved, isBoolean])

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (secret && focusValueRef.current) {
      focusValueRef.current = false
      textareaRef.current?.focus()
    }
  }, [secret])

  const handleValueChange = useCallback(
    (next: string) => {
      if (isSealedAndSaved) return
      updateValue(rowId, env.id, next)
      if (next.includes('\n')) setExpanded(true)
    },
    [updateValue, rowId, env.id, isSealedAndSaved]
  )

  const autocomplete = useSecretReferenceAutocomplete({
    value,
    isRevealed,
    textareaRef,
    onChange: handleValueChange,
    currentSecretKey: rowKey,
  })

  const highlightContent =
    isRevealed && value.includes('${') ? <SecretReferenceHighlight value={value} /> : undefined

  // Share and override label the value with the row's (possibly renamed) key
  const labelledSecret = useMemo(
    () => (secret ? ({ ...secret, key: rowKey } as SecretType) : null),
    [secret, rowKey]
  )

  // History offers "restore this value" — the only property it writes back
  const handleHistoryRestore = useCallback(
    (_id: string, property: string, restored: string) => {
      if (property === 'value') handleValueChange(restored)
    },
    [handleValueChange]
  )

  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlighted)
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [highlighted])

  const status: SecretCellStatus =
    secret === null ? 'missing' : value === '' && !isSealedAndSaved ? 'blank' : sameAsProd ? 'sameAsProd' : 'present'

  const cellTint = highlighted
    ? STATUS_FLASH_STYLES[status]
    : stagedForDelete
      ? 'bg-red-400/20 dark:bg-red-400/10'
      : isNew
        ? 'bg-emerald-400/10'
        : valueModified
          ? 'bg-amber-400/20 dark:bg-amber-400/10'
          : status === 'missing' || status === 'blank'
            ? STATUS_CELL_STYLES[status]
            : ''

  const textColor = stagedForDelete
    ? 'text-red-700 dark:text-red-400 line-through'
    : isNew
      ? 'text-emerald-700 dark:text-emerald-200'
      : valueModified
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-zinc-900 dark:text-zinc-100'

  if (secret === null) {
    return (
      <div ref={rootRef} className="h-full">
        <MissingCell
          actionLabel={inRotatingGroup ? 'Add static value' : 'Add value'}
          onAction={() => {
            focusValueRef.current = true
            addValue(rowId, env)
            setIsRevealed(true)
          }}
          disabled={keyIsStagedForDelete}
          title={`${rowKey || 'This key'} is missing in ${env.name}`}
          className={clsx('transition-colors duration-300', highlighted && STATUS_FLASH_STYLES.missing)}
        />
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      // Raised while active so its menu rises over the sticky header (z-20) and the row above,
      // yet stays under the sticky key column (z-30) when scrolled beneath it
      className={clsx(
        'group/cell relative h-full transition-colors duration-300 hover:z-[25] focus-within:z-[25]',
        cellTint
      )}
      onMouseEnter={() => {
        setTrayMounted(true)
        if (revealOnHover && !isRevealed) revealValue()
      }}
      onFocus={() => setTrayMounted(true)}
    >
      <div className={clsx('relative flex h-full items-start gap-1 px-1 py-0.5 transition-colors', FIELD_FILL)}>
        {isBoolean && !stagedForDelete && (
          <div className="flex h-8 items-center px-1">
            <Switch
              title="Toggle value"
              checked={value.toLowerCase() === 'true'}
              onChange={() => handleValueChange(toggleBooleanKeepingCase(value))}
              disabled={!userCanUpdate}
              className={clsx(
                value.toLowerCase() === 'true'
                  ? 'bg-emerald-400/10 ring-emerald-400/20'
                  : 'bg-neutral-500/40 ring-neutral-500/30',
                'relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset'
              )}
            >
              <span className="sr-only">Toggle</span>
              <span
                className={clsx(
                  value.toLowerCase() === 'true'
                    ? 'translate-x-6 bg-emerald-400'
                    : 'translate-x-1 bg-neutral-500',
                  'flex h-4 w-4 transform items-center justify-center rounded-full transition'
                )}
              />
            </Switch>
          </div>
        )}

        <div className="relative min-w-0 flex-1">
          <MaskedTextarea
            ref={textareaRef}
            className={clsx(INPUT_BASE_STYLE, textColor)}
            value={isSealedAndSaved ? '' : value}
            onChange={(next) => {
              handleValueChange(next)
              autocomplete.handleChange()
            }}
            onKeyDown={(e) => {
              // Autocomplete claims Tab to accept a suggestion
              autocomplete.handleKeyDown(e)
              if (e.key === 'Tab' && !e.shiftKey && !e.defaultPrevented) {
                if (focusNextGridField(e.currentTarget)) e.preventDefault()
              }
            }}
            onSelect={autocomplete.handleSelect}
            onBlur={autocomplete.handleBlur}
            onFocus={() => {
              setExpanded(true)
              autocomplete.handleFocus()
            }}
            isRevealed={isRevealed}
            expanded={expanded}
            readOnly={isRotating}
            disabled={stagedForDelete || isSealedAndSaved || (!userCanUpdate && !isRotating)}
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

        {sameAsProd && value !== '' && (
          <FaCheckCircle
            className="mt-2 shrink-0 text-2xs text-amber-500"
            title="This value is the same as Production"
          />
        )}

        {/* Rises above the value on hover, like the single-env value menu */}
        {trayMounted && (
        <div
          className={clsx(
            'absolute bottom-full right-0 flex items-start gap-1 rounded-t-lg bg-zinc-200 px-1 pt-1 dark:bg-zinc-700',
            // Hidden, it sits over the value — it must not take clicks meant for the field
            'pointer-events-none translate-y-full opacity-0 transition ease group-focus-within/cell:pointer-events-auto group-focus-within/cell:translate-y-0 group-focus-within/cell:opacity-100 group-hover/cell:pointer-events-auto group-hover/cell:translate-y-0 group-hover/cell:opacity-100'
          )}
        >
          {isMultiLine && (
            <Button
              variant="ghost"
              tabIndex={-1}
              onClick={() => setExpanded((current) => !current)}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              <div className="py-0.5 2xl:py-1">
                {expanded ? <FaCompressArrowsAlt /> : <FaExpandArrowsAlt />}
              </div>
            </Button>
          )}

          {!isBoolean && !isSealedAndSaved && (
            <Button
              variant="outline"
              tabIndex={-1}
              onClick={toggleReveal}
              title={isRevealed ? 'Mask value' : 'Reveal value'}
            >
              <span className="py-0.5 2xl:py-1">{isRevealed ? <FaEyeSlash /> : <FaEye />}</span>
            </Button>
          )}
          {isSealedAndSaved && (
            <span
              className="flex items-center gap-1 px-2 py-0.5 text-xs text-neutral-500 2xl:py-1"
              title="This secret is sealed and cannot be revealed"
            >
              <FaLock /> Sealed
            </span>
          )}

          {serverSecret && !stagedForDelete && (
            <HistoryDialog
              secret={secret}
              handlePropertyChange={handleHistoryRestore}
              labelFrom="xl"
            />
          )}

          {serverSecret && !stagedForDelete && !isSealedAndSaved && (
            <OverrideDialog
              secretId={serverSecret.id}
              secretName={rowKey}
              environment={env}
              override={secret.override ?? null}
              labelFrom="xl"
            />
          )}

          {serverSecret && !isSealedAndSaved && labelledSecret && (
            <ShareSecretDialog secret={labelledSecret} />
          )}

          {!isSealedAndSaved && (
            <CopyButton value={value}>
              <div className="flex items-center gap-0.5">
                <FaCopy className="h-4 w-4" />
                <span className="hidden xl:inline">Copy</span>
              </div>
            </CopyButton>
          )}

          {userCanDelete && (
            <Button
              variant="danger"
              tabIndex={-1}
              onClick={() => deleteValue(rowId, env)}
              title={secret.stagedForDelete ? 'Restore this value' : `Delete this value from ${env.name}`}
            >
              <div className="py-0.5 2xl:py-1">
                {secret.stagedForDelete ? <FaUndo /> : <FaTrashAlt />}
              </div>
            </Button>
          )}
        </div>
        )}
      </div>
    </div>
  )
}

const cellSecretEqual = (a: SecretWithFlags | null | undefined, b: SecretWithFlags | null | undefined) => {
  if (!a || !b) return !a && !b
  return (
    a.id === b.id &&
    a.value === b.value &&
    a.type === b.type &&
    a.rotatingSecretId === b.rotatingSecretId &&
    (a.stagedForDelete ?? false) === (b.stagedForDelete ?? false) &&
    (a.override?.value ?? null) === (b.override?.value ?? null) &&
    (a.override?.isActive ?? null) === (b.override?.isActive ?? null)
  )
}

const areEnvValueCellsEqual = (prev: EnvValueCellProps, next: EnvValueCellProps) =>
  prev.rowId === next.rowId &&
  prev.rowKey === next.rowKey &&
  prev.entry.env.id === next.entry.env.id &&
  prev.entry.env.name === next.entry.env.name &&
  prev.keyIsStagedForDelete === next.keyIsStagedForDelete &&
  prev.sameAsProd === next.sameAsProd &&
  prev.inRotatingGroup === next.inRotatingGroup &&
  prev.globallyRevealed === next.globallyRevealed &&
  prev.revealOnHover === next.revealOnHover &&
  prev.highlighted === next.highlighted &&
  prev.canUpdateSecrets === next.canUpdateSecrets &&
  prev.canDeleteSecrets === next.canDeleteSecrets &&
  prev.updateValue === next.updateValue &&
  prev.addValue === next.addValue &&
  prev.deleteValue === next.deleteValue &&
  prev.logReads === next.logReads &&
  cellSecretEqual(prev.entry.secret, next.entry.secret) &&
  // Server fields drive isSealedAndSaved and the modified tint; a deploy only changes them
  cellSecretEqual(prev.serverEntry?.secret, next.serverEntry?.secret)

export const EnvValueCell = memo(EnvValueCellBase, areEnvValueCellsEqual)
