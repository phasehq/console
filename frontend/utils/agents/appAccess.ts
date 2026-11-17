/**
 * App Connections: an app's secrets, for some of its environments, served
 * by the Console itself. The backend (`api/utils/agent_app_access.py`) is
 * the authority; this file only reads what it sends and words it.
 */

import { draftFromPolicy, type PolicyEffect } from '@/utils/agents/accessPolicy'

export const APP_SERVICE_TYPE = 'phase_app'

/** The four kinds of call the secrets API has, in the order they are shown. */
export const APP_CLASSES = ['read', 'create', 'update', 'delete'] as const
export type AppClass = (typeof APP_CLASSES)[number]
export const WRITE_CLASSES: readonly AppClass[] = ['create', 'update', 'delete']

/** The most environments one request may name; the backend refuses more. */
export const MAX_APP_ENVIRONMENTS = 20

export const APP_CLASS_HINT: Record<AppClass, string> = {
  read: 'List secrets and read their values',
  create: 'Add new secrets',
  update: 'Change secrets that exist',
  delete: 'Remove secrets',
}

export const SSE_REQUIRED_LINE =
  "Agent access needs server-side encryption. Enable it in the app's settings."

/** Shown wherever a member gives an Agent an app's secrets: unlike other
 * Connections, the values themselves reach whoever holds the Agent's token. */
export const TOKEN_HOLDERS_LINE =
  'Anyone who can create a token for this Agent can read these secrets with it.'

export const isAppConnection = (serviceType?: string | null) =>
  serviceType?.trim().toLowerCase() === APP_SERVICE_TYPE

export type AppAccessLevel = 'read' | 'read_write'

export const ACCESS_LEVEL_LABEL: Record<AppAccessLevel, string> = {
  read: 'Read',
  read_write: 'Read and write',
}

export type AppRef = { id: string; name: string; sseEnabled?: boolean }
export type EnvironmentRef = { id: string; name: string; envType?: string }

export type ClassAccess = { effect: PolicyEffect; until?: string }
export type AppAccess = Record<AppClass, ClassAccess>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const EFFECTS: readonly string[] = ['allow', 'ask', 'block']

/** The effect of each class on a grant, as the server sends it. Anything unreadable is blocked. */
export const readAppAccess = (value: unknown): AppAccess => {
  const source = isRecord(value) ? value : {}
  return Object.fromEntries(
    APP_CLASSES.map((name) => {
      const raw = source[name]
      const effect =
        isRecord(raw) && typeof raw.effect === 'string' && EFFECTS.includes(raw.effect)
          ? (raw.effect as PolicyEffect)
          : 'block'
      const until = isRecord(raw) && typeof raw.until === 'string' ? raw.until : undefined
      return [name, until ? { effect, until } : { effect }]
    })
  ) as AppAccess
}

export const readAppRef = (value: unknown): AppRef | null =>
  isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
    ? {
        id: value.id,
        name: value.name,
        ...(typeof value.sseEnabled === 'boolean' ? { sseEnabled: value.sseEnabled } : {}),
      }
    : null

export const readEnvironmentRefs = (value: unknown): EnvironmentRef[] =>
  Array.isArray(value)
    ? value.flatMap((item): EnvironmentRef[] =>
        isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string'
          ? [
              {
                id: item.id,
                name: item.name,
                ...(typeof item.envType === 'string' ? { envType: item.envType } : {}),
              },
            ]
          : []
      )
    : []

/** "a, b and c". */
export const listWords = (words: string[]): string =>
  words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** The classes in their usual order, with all three write classes said as "write". */
const classWords = (classes: readonly AppClass[]): string[] => {
  const ordered = APP_CLASSES.filter((name) => classes.includes(name))
  if (!WRITE_CLASSES.every((name) => ordered.includes(name))) return [...ordered]
  return [...ordered.filter((name) => !WRITE_CLASSES.includes(name)), 'write']
}

/** "Create, update and delete" for a list of classes, each named. */
export const describeClasses = (classes: readonly string[]): string =>
  capitalise(listWords(APP_CLASSES.filter((name) => classes.includes(name))))

/** "1 Dec 2026, 14:00" in the reader's locale. */
export const formatAccessTime = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.valueOf())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export type AccessWords = {
  /** What the grant lets through now, such as "Read, and write until 1 Dec 2026, 14:00". */
  allowed: string
  /** What waits for a Change Request or is refused, such as "Writes ask"; '' when nothing. */
  restricted: string
}

/** A grant's access in plain words. */
export const describeAppAccess = (access: AppAccess): AccessWords => {
  const open = APP_CLASSES.filter((name) => access[name].effect === 'allow' && !access[name].until)
  // Time-limited allows, grouped by when they end.
  const timed = new Map<string, AppClass[]>()
  for (const name of APP_CLASSES) {
    const until = access[name].effect === 'allow' ? access[name].until : undefined
    if (until) timed.set(until, [...(timed.get(until) ?? []), name])
  }
  const parts = [
    ...(open.length ? [listWords(classWords(open))] : []),
    ...Array.from(timed.entries()).map(
      ([until, names]) => `${listWords(classWords(names))} until ${formatAccessTime(until)}`
    ),
  ]
  const allowed = parts.length ? capitalise(parts.join(', and ')) : 'Nothing yet'
  const restricted = (['ask', 'block'] as const)
    .map((effect) => {
      const names = APP_CLASSES.filter((name) => access[name].effect === effect)
      if (!names.length) return ''
      const words = classWords(names).map((word) =>
        word === 'write' ? 'writes' : word === 'read' ? 'reads' : word
      )
      return `${listWords(words)} ${effect === 'ask' ? 'ask' : 'blocked'}`
    })
    .filter(Boolean)
  return {
    allowed,
    restricted: restricted.length ? capitalise(restricted.join(', ')) : '',
  }
}

const EFFECT_WORD: Record<PolicyEffect, string> = {
  allow: 'allowed',
  ask: 'ask',
  block: 'blocked',
}

/** The rules of an app Connection in a few words: "Reads allowed, writes ask". */
export const appPolicySummary = (policy: unknown): string => {
  const { classes } = draftFromPolicy(policy)
  const byEffect = new Map<PolicyEffect, AppClass[]>()
  for (const name of APP_CLASSES)
    byEffect.set(classes[name], [...(byEffect.get(classes[name]) ?? []), name])
  const parts = (['allow', 'ask', 'block'] as const).flatMap((effect) => {
    const names = byEffect.get(effect)
    if (!names) return []
    const words = classWords(names).map((word) =>
      word === 'write' ? 'writes' : word === 'read' ? 'reads' : word
    )
    return [`${listWords(words)} ${EFFECT_WORD[effect]}`]
  })
  return capitalise(parts.join(', '))
}

/** The name a new app Connection starts with. */
export const defaultAppConnectionName = (appName: string) => `${appName} secrets`

/**
 * What the viewer may not see of an app. The backend withholds the name of an
 * app, or of an environment, the viewer cannot access, and says so here; the
 * item itself stays listed. `WithheldApp` and `AppEnvironments` show it.
 */
export type AppVisibility = { appRestricted: boolean; hiddenEnvironmentCount: number }

export const readAppVisibility = (value: unknown): AppVisibility => {
  const source = isRecord(value) ? value : {}
  const hidden = source.hiddenEnvironmentCount
  return {
    appRestricted: source.appRestricted === true,
    hiddenEnvironmentCount:
      typeof hidden === 'number' && Number.isInteger(hidden) && hidden > 0 ? hidden : 0,
  }
}

export const isWithheld = (visibility: AppVisibility) =>
  visibility.appRestricted || visibility.hiddenEnvironmentCount > 0

export const WITHHELD_APP_LABEL = "An app you can't access"

/** "+2 more you can't access" after names, "2 environments you can't access" alone. */
export const hiddenEnvironmentsLabel = (count: number, afterNames: boolean) =>
  afterNames
    ? `+${count} more you can't access`
    : `${count} environment${count === 1 ? '' : 's'} you can't access`

/**
 * Why a member cannot approve a request about what they cannot see; '' when they can.
 * A request for an app's secrets passes how many of its environments the member can
 * access: they may approve those and leave the rest.
 */
export const withheldReviewLine = (
  visibility: AppVisibility,
  approvableEnvironments?: number
): string =>
  visibility.appRestricted
    ? 'You need access to this app to review this request.'
    : visibility.hiddenEnvironmentCount === 0
      ? ''
      : approvableEnvironments === undefined
        ? 'You need access to every environment in this request to approve it.'
        : approvableEnvironments > 0
          ? ''
          : 'You need access to these environments to approve this request.'

/** Shown by Approve to a member who can access only some of the environments asked for. */
export const PARTIAL_APPROVAL_LINE =
  'Approving covers only the environments listed, and the rest stays open for someone with access.'
