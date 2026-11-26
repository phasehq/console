'use client'

import { forwardRef, useContext, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useQuery } from '@apollo/client'
import { useParams, useRouter } from 'next/navigation'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { FaArrowLeft, FaArrowRight, FaCheck, FaPlus, FaServer, FaTrashAlt } from 'react-icons/fa'
import { FaArrowDownUpLock } from 'react-icons/fa6'
import {
  ApiEnvironmentEnvTypeChoices,
  ApiOrganisationPlanChoices,
  EnvironmentType,
  MemberType,
  OrganisationMemberType,
  OrganisationType,
  ServiceAccountType,
  TeamType,
} from '@/apollo/graphql'
import { GetGlobalAccessUsers } from '@/graphql/queries/organisation/getGlobalAccessUsers.gql'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { KeyringContext } from '@/contexts/keyringContext'
import { MAX_APP_NAME_LENGTH } from '@/constants'
import { useFileDrop } from '@/hooks/useFileDrop'
import {
  createApplication,
  DEFAULT_APP_ENVIRONMENTS,
  NewAppAccess,
  NewAppSecrets,
  NewAppTeamAccess,
} from '@/utils/app'
import { userHasGlobalAccess, userHasPermission } from '@/utils/access/permissions'
import { defaultEnvColor, sanitizeInput } from '@/utils/environment'
import { processEnvFile } from '@/utils/secrets'
import GenericDialog from '../common/GenericDialog'
import { Button } from '../common/Button'
import { Input } from '../common/Input'
import { Alert } from '../common/Alert'
import { ColorPicker } from '../common/ColorPicker'
import Spinner from '../common/Spinner'
import { UpsellDialog } from '../settings/organisation/UpsellDialog'
import { PlanLabel } from '../settings/organisation/PlanLabel'
import { EnvFileInput, readEnvFileInto } from '../environments/secrets/import/EnvFileInput'
import {
  EnvImportOptions,
  secretsForEnvs,
  useImportChoices,
} from '../environments/secrets/import/EnvImportOptions'
import { AccessScope, AppAccessPicker } from './AppAccessPicker'

/** An environment row: `key` stays the same while it is renamed. A blank color is the default */
type EnvRow = {
  key: string
  name: string
  envType: ApiEnvironmentEnvTypeChoices
  color: string
  isPrimary: boolean
}

let lastRowKey = 0
const rowKey = () => `env-${(lastRowKey += 1)}`

const STANDARD_ORDER: Partial<Record<ApiEnvironmentEnvTypeChoices, number>> = {
  [ApiEnvironmentEnvTypeChoices.Dev]: 0,
  [ApiEnvironmentEnvTypeChoices.Staging]: 1,
  [ApiEnvironmentEnvTypeChoices.Prod]: 2,
}
const isStandard = (row: Pick<EnvRow, 'envType'>) => row.envType in STANDARD_ORDER

/** The rows in the order the App will have them: the server keeps Development, Staging and
 * Production at the front, and adds each other environment after the last */
const inAppOrder = (rows: EnvRow[]) => [
  ...rows
    .filter(isStandard)
    .sort((a, b) => STANDARD_ORDER[a.envType]! - STANDARD_ORDER[b.envType]!),
  ...rows.filter((row) => !isStandard(row)),
]

// Production starts out primary, as it is for an App made any other way
const startingRows = (): EnvRow[] =>
  DEFAULT_APP_ENVIRONMENTS.map(({ name, envType }) => ({
    name,
    envType,
    key: rowKey(),
    color: '',
    isPrimary: envType === ApiEnvironmentEnvTypeChoices.Prod,
  }))

const rowColor = (row: EnvRow) =>
  row.color || defaultEnvColor({ envType: row.envType, name: row.name || 'environment' })

/** What's wrong with each row's name, if anything */
const nameProblems = (rows: EnvRow[]) => {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const name = row.name.toLowerCase()
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return new Map(
    rows.map((row) => [
      row.key,
      row.name === ''
        ? 'Give this Environment a name'
        : counts.get(row.name.toLowerCase())! > 1
          ? 'Another Environment has this name'
          : null,
    ])
  )
}

const listNames = (names: string[]) =>
  names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

const planName = (plan: ApiOrganisationPlanChoices) =>
  plan === ApiOrganisationPlanChoices.Fr
    ? 'Free'
    : plan === ApiOrganisationPlanChoices.Pr
      ? 'Pro'
      : 'Enterprise'

// Parsed only to count and check the keys: which environment they're for doesn't matter yet
const NO_ENV = { id: '' } as EnvironmentType

/** Keys that appear more than once */
const repeatedKeys = (keys: string[]) => {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const key of keys) (seen.has(key) ? repeated : seen).add(key)
  return [...repeated]
}

/** The dialog's pages, in order. Importing secrets takes two: the secrets, then where they go */
type Page = 'app' | 'secrets' | 'secretOptions' | 'access'
const STEP: Record<Page, string> = {
  app: 'App',
  secrets: 'Secrets',
  secretOptions: 'Secrets',
  access: 'Access',
}

const Steps = ({ steps, current }: { steps: string[]; current: string }) => {
  const at = steps.indexOf(current)
  return (
    <ol className="flex items-center gap-2 text-2xs font-medium" aria-label="Steps">
      {steps.map((label, index) => {
        const done = index < at
        const isCurrent = index === at
        return (
          <li
            key={label}
            className="flex items-center gap-2"
            aria-current={isCurrent ? 'step' : undefined}
          >
            {index > 0 && <span aria-hidden className="h-px w-5 bg-neutral-500/40" />}
            <span
              className={clsx(
                'flex items-center gap-1.5',
                isCurrent ? 'text-zinc-900 dark:text-zinc-100' : 'text-neutral-500'
              )}
            >
              <span
                className={clsx(
                  'flex size-4 items-center justify-center rounded-full text-[0.6rem] ring-1 ring-inset',
                  isCurrent
                    ? 'bg-emerald-500 text-white ring-emerald-500 dark:bg-emerald-400/20 dark:text-emerald-400 dark:ring-emerald-400/40'
                    : done
                      ? 'text-emerald-600 ring-emerald-500/60 dark:text-emerald-400'
                      : 'ring-neutral-500/40'
                )}
              >
                {done ? <FaCheck className="text-[0.5rem]" /> : index + 1}
              </span>
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

interface NewAppDialogProps {
  organisation: OrganisationType
  showButton: boolean
}

/**
 * Creates an App, a step at a time: its name and the Environments it starts with (Development,
 * Staging and Production to begin with, each one renamed, recoloured or removed, others added up
 * to the plan's limit, and one of them primary), then any secrets to import into them, then which
 * members, service accounts and teams can reach which of them. Opens the new App once it exists.
 */
const NewAppDialog = forwardRef(({ organisation, showButton }: NewAppDialogProps, ref) => {
  const router = useRouter()
  const params = useParams<{ team: string }>()
  const { keyring } = useContext(KeyringContext)

  const permissions = organisation.role?.permissions
  const canImport = userHasPermission(permissions, 'Secrets', 'create', true)
  const canAssignMembers =
    userHasPermission(permissions, 'Members', 'create', true) &&
    userHasPermission(permissions, 'Members', 'read')
  const canAssignServiceAccounts =
    userHasPermission(permissions, 'ServiceAccounts', 'create', true) &&
    userHasPermission(permissions, 'ServiceAccounts', 'read')
  // Teams get their keys from the server, so the App's encryption mode has to change for them
  const canAssignTeams =
    userHasPermission(permissions, 'Teams', 'read') &&
    userHasPermission(permissions, 'Teams', 'update') &&
    userHasPermission(permissions, 'EncryptionMode', 'update', true)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const nameInputRef = useRef(null)
  // Accounts are only fetched once the dialog has been opened
  const [opened, setOpened] = useState(false)

  const [page, setPage] = useState<Page>('app')
  const [name, setName] = useState('')
  const [rows, setRows] = useState<EnvRow[]>(startingRows)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const [envText, setEnvText] = useState('')
  const [importProblem, setImportProblem] = useState<string | null>(null)
  const [scope, setScope] = useState<AccessScope>(new Map())
  const [error, setError] = useState<Error | null>(null)
  // What it's doing while it creates, shown beside the button
  const [stage, setStage] = useState<string | null>(null)
  const busyRef = useRef(false)

  const { selectedIds, configs, toggleEnv, setConfig } = useImportChoices(
    rows.map((row) => row.key)
  )

  const { data: orgAdminsData } = useQuery(GetGlobalAccessUsers, {
    variables: { organisationId: organisation.id },
  })
  const { data: membersData, loading: membersLoading } = useQuery(GetOrganisationMembers, {
    variables: { organisationId: organisation.id, role: null },
    skip: !opened || !canAssignMembers,
    fetchPolicy: 'cache-and-network',
  })
  const { data: serviceAccountsData, loading: serviceAccountsLoading } = useQuery(
    GetServiceAccounts,
    {
      variables: { orgId: organisation.id },
      skip: !opened || !canAssignServiceAccounts,
      fetchPolicy: 'cache-and-network',
    }
  )
  const { data: teamsData, loading: teamsLoading } = useQuery(GetTeams, {
    variables: { organisationId: organisation.id },
    skip: !opened || !canAssignTeams,
    fetchPolicy: 'cache-and-network',
  })

  const members = useMemo(
    () =>
      canAssignMembers
        ? ((membersData?.organisationMembers ?? []) as OrganisationMemberType[])
        : [],
    [membersData, canAssignMembers]
  )
  const serviceAccounts = useMemo(
    () =>
      canAssignServiceAccounts
        ? ((serviceAccountsData?.serviceAccounts ?? []) as ServiceAccountType[])
        : [],
    [serviceAccountsData, canAssignServiceAccounts]
  )
  // Every team for an owner or admin, otherwise the teams you're in. Adding a team to an App takes
  // owning it, or a role that may add any team you're in
  const teams = useMemo(() => {
    if (!canAssignTeams) return []
    const everyTeam = userHasGlobalAccess(permissions)
    const anyOfMine = userHasPermission(permissions, 'Teams', 'create', true)
    return ((teamsData?.teams ?? []) as TeamType[]).filter((team) => {
      const owner = Boolean(organisation.memberId) && team.owner?.id === organisation.memberId
      const inTeam =
        everyTeam || team.members?.some((m) => m?.orgMember?.id === organisation.memberId)
      return inTeam && (owner || anyOfMine)
    })
  }, [teamsData, canAssignTeams, permissions, organisation.memberId])

  // Admins and the creator get every environment's keys as it is created
  const everywhere = useMemo(() => {
    const keyHolders = new Set(
      ((orgAdminsData?.organisationGlobalAccessUsers ?? []) as OrganisationMemberType[]).map(
        (user) => user.id
      )
    )
    const reasons = new Map<string, string>()
    for (const member of members) {
      if (userHasGlobalAccess(member.role?.permissions))
        reasons.set(
          member.id,
          `${member.self ? 'Your' : 'Their'} role gives access to every Environment`
        )
      else if (keyHolders.has(member.id))
        reasons.set(member.id, 'You get every Environment as its creator')
    }
    return reasons
  }, [orgAdminsData, members])

  // Keys can only be wrapped for a member who has keys of their own
  const unavailable = useMemo(
    () =>
      new Map(
        members
          .filter((member) => !member.identityKey && !everywhere.has(member.id))
          .map((member) => [member.id, 'Can be given access once they have signed in'])
      ),
    [members, everywhere]
  )

  const accountsLoading =
    (canAssignMembers && (!opened || (membersLoading && !membersData))) ||
    (canAssignServiceAccounts && (!opened || (serviceAccountsLoading && !serviceAccountsData))) ||
    (canAssignTeams && (!opened || (teamsLoading && !teamsData)))
  const assignable =
    members.filter((member) => !everywhere.has(member.id) && !unavailable.has(member.id)).length +
    serviceAccounts.length +
    teams.length
  // Without anyone to choose, there is no Access step
  const hasAccessStep =
    (canAssignMembers || canAssignServiceAccounts || canAssignTeams) &&
    (accountsLoading || assignable > 0)

  // The plan's per-App limit: none on Enterprise or self-hosted Free
  const maxEnvs = organisation.planDetail?.maxEnvsPerApp || null
  const atLimit = maxEnvs !== null && rows.length >= maxEnvs
  const upgradeTo =
    organisation.plan === ApiOrganisationPlanChoices.Fr
      ? ApiOrganisationPlanChoices.Pr
      : ApiOrganisationPlanChoices.En
  const missingStandard = DEFAULT_APP_ENVIRONMENTS.filter(
    (env) => !rows.some((row) => row.envType === env.envType)
  )
  const problems = nameProblems(rows)
  const duplicates = [...problems.values()].some(
    (problem) => problem === 'Another Environment has this name'
  )

  const hasSecrets = envText.trim() !== ''
  const found = useMemo(() => processEnvFile(envText, NO_ENV, '/', false, false), [envText])

  const pages: Page[] = [
    'app',
    ...(canImport ? (['secrets', ...(hasSecrets ? ['secretOptions'] : [])] as Page[]) : []),
    ...(hasAccessStep ? (['access'] as Page[]) : []),
  ]
  // A page that has dropped out (there turned out to be no one to choose) counts as the last
  const at = pages.indexOf(page)
  const index = at === -1 ? pages.length : at
  const nextPage = pages[index + 1]
  const previousPage = pages[index - 1]
  const steps = [...new Set([...pages, page].map((p) => STEP[p]))]

  // Teams get their keys from the server
  const teamsChosen = teams.some((team) => (scope.get(team.id)?.size ?? 0) > 0)

  const reset = () => {
    setPage('app')
    setName('')
    setRows(startingRows())
    setFocusKey(null)
    setShowProblems(false)
    setEnvText('')
    setImportProblem(null)
    setScope(new Map())
    setError(null)
    setStage(null)
  }

  useImperativeHandle(ref, () => ({
    openModal: () => dialogRef.current?.openModal(),
  }))

  const updateRow = (key: string, change: Partial<EnvRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)))
  const removeRow = (key: string) => setRows((current) => current.filter((row) => row.key !== key))
  const addRow = (row: Pick<EnvRow, 'name' | 'envType'>) => {
    const key = rowKey()
    setRows((current) =>
      inAppOrder([
        ...current,
        {
          ...row,
          key,
          color: '',
          // Production put back is primary again, unless another has been made primary since
          isPrimary:
            row.envType === ApiEnvironmentEnvTypeChoices.Prod &&
            !current.some((other) => other.isPrimary),
        },
      ])
    )
    if (!row.name) setFocusKey(key)
  }
  const makePrimary = (key: string) =>
    setRows((current) => current.map((row) => ({ ...row, isPrimary: row.key === key })))

  const setSecretsText = (text: string) => {
    setEnvText(text)
    setImportProblem(null)
  }
  const importFile = readEnvFileInto(setSecretsText)
  const { over, dropTarget } = useFileDrop(importFile, page === 'secrets')

  const create = async () => {
    if (busyRef.current || !keyring || !orgAdminsData) return

    const position = new Map(rows.map((row, at) => [row.key, at]))
    const placesOf = (keys: Iterable<string> | undefined) =>
      [...(keys ?? [])]
        .map((key) => position.get(key))
        .filter((at): at is number => at !== undefined)
        .sort((a, b) => a - b)

    let secrets: NewAppSecrets[] = []
    if (canImport && hasSecrets) {
      try {
        secrets = secretsForEnvs(
          envText,
          rows.map((row) => ({ id: row.key })),
          selectedIds,
          configs
        ).map(({ env, secrets }) => ({ environment: position.get(env.id)!, secrets }))
      } catch (err) {
        setError(err as Error)
        return
      }
    }

    const access: NewAppAccess[] = [
      ...members.map((account) => ({ account, memberType: MemberType.User })),
      ...serviceAccounts.map((account) => ({ account, memberType: MemberType.Service })),
    ].flatMap(({ account, memberType }) => {
      if (everywhere.has(account.id) || unavailable.has(account.id)) return []
      const environments = placesOf(scope.get(account.id))
      return environments.length > 0 ? [{ account, memberType, environments }] : []
    })
    const teamAccess: NewAppTeamAccess[] = teams.flatMap((team) => {
      const environments = placesOf(scope.get(team.id))
      return environments.length > 0 ? [{ teamId: team.id, environments }] : []
    })

    busyRef.current = true
    setError(null)
    setStage('Creating the App…')

    let created: Awaited<ReturnType<typeof createApplication>>
    try {
      created = await createApplication({
        name,
        organisation,
        keyring,
        globalAccessUsers: orgAdminsData.organisationGlobalAccessUsers,
        environments: rows.map((row) => ({
          name: row.name,
          envType: row.envType,
          color: row.color || null,
          isPrimary: row.isPrimary,
        })),
        secrets,
        access,
        teams: teamAccess,
        onProgress: setStage,
      })
    } catch (err) {
      // Nothing was created
      busyRef.current = false
      setStage(null)
      setError(err as Error)
      return
    }

    const missing = rows.filter((_, at) => !created.environments[at]).map((row) => row.name)
    const problems: string[] = []
    if (missing.length > 0) problems.push(`${listNames(missing)} couldn't be created`)
    if (!created.secretsImported) problems.push("the secrets couldn't be imported")
    if (!created.accessGiven) problems.push("the access you chose couldn't be given")
    if (!created.teamsGiven) problems.push("the teams you chose couldn't be given access")
    if (problems.length > 0) toast.warning(`${name} was created, but ${listNames(problems)}.`)
    else toast.success(`${name} was created`)

    busyRef.current = false
    dialogRef.current?.closeModal()
    router.push(`/${params?.team ?? organisation.name}/apps/${created.id}`)
  }

  const handleSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (page === 'app' && [...problems.values()].some(Boolean)) {
      setShowProblems(true)
      return
    }
    if (page === 'secrets' && hasSecrets) {
      if (found.length === 0) {
        setImportProblem('No secrets found. Put each one on its own line, as KEY=VALUE.')
        return
      }
      const repeated = repeatedKeys(found.map((secret) => secret.key))
      if (repeated.length > 0) {
        setImportProblem(
          `${listNames(repeated)} ${repeated.length === 1 ? 'is' : 'are'} in here more than once. Each key can only be imported once.`
        )
        return
      }
    }
    if (nextPage) setPage(nextPage)
    else create()
  }

  const busy = stage !== null

  const title = (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
          Create an App
        </h3>
        {teamsChosen ? (
          <div
            className="rounded-md px-2 text-2xs font-semibold flex items-center gap-1 text-sky-500 bg-sky-400/10 cursor-help"
            title="Teams get their keys from the server, so this App will use server-side encryption"
          >
            <FaServer />
            Server-side Encrypted
          </div>
        ) : (
          <div
            className="rounded-md px-2 text-2xs font-semibold flex items-center gap-1 text-emerald-500 bg-emerald-400/10 cursor-help"
            title="Secrets (keys, values, comments) will be encrypted with end-to-end encryption"
          >
            <FaArrowDownUpLock />
            End-to-End Encrypted
          </div>
        )}
      </div>
      {/* Only once the steps are known, so a lone member never sees the Access step flash */}
      {steps.length > 1 && (page !== 'app' || !accountsLoading) && (
        <Steps steps={steps} current={STEP[page]} />
      )}
    </div>
  )

  const submitLabel = !nextPage ? (
    'Create App'
  ) : (
    <>
      {page === 'secrets' && !hasSecrets ? 'Skip' : 'Next'} <FaArrowRight className="text-2xs" />
    </>
  )

  return (
    <>
      {showButton && (
        <Button variant="primary" onClick={() => dialogRef.current?.openModal()}>
          <FaPlus />
          Create an App
        </Button>
      )}

      <GenericDialog
        title="Create an App"
        dialogTitle={title}
        ref={dialogRef}
        onOpen={() => {
          reset()
          setOpened(true)
        }}
        canClose={() => !busyRef.current}
        initialFocus={nameInputRef}
      >
        <form className="space-y-5 pt-4" onSubmit={handleSubmit}>
          {error && (
            <Alert variant="danger" icon={true} size="sm">
              {error.message}
            </Alert>
          )}

          {page === 'app' && (
            <>
              <p className="text-sm text-neutral-500">
                Name the App and choose the Environments it starts with.
              </p>
              <Input
                value={name}
                setValue={setName}
                placeholder="MyApp"
                label="App name"
                id="appName"
                maxLength={MAX_APP_NAME_LENGTH}
                ref={nameInputRef}
                required
                disabled={busy}
              />

              <div className="space-y-2">
                <div className="flex items-baseline gap-3">
                  <span className="flex-1 text-xs text-neutral-500">
                    Environments<span className="ml-1 text-red-500">*</span>
                  </span>
                  <span className="w-14 shrink-0 text-center text-2xs text-neutral-500">
                    Primary
                  </span>
                  <span aria-hidden className="w-9 shrink-0" />
                </div>

                <ul className="space-y-2" aria-label="Environments">
                  {rows.map((row) => {
                    const problem = showProblems || duplicates ? problems.get(row.key) : null
                    const label = row.name || 'this Environment'
                    return (
                      <li key={row.key} className="space-y-1">
                        <div className="flex items-center gap-3">
                          {/* The swatch has no line height, so it centres on the field */}
                          <div className="leading-[0]" title="Environment color">
                            <ColorPicker
                              color={rowColor(row)}
                              setColor={(color) => updateRow(row.key, { color })}
                              disabled={busy}
                            />
                          </div>
                          <div className="flex-1">
                            <Input
                              value={row.name}
                              setValue={(value) =>
                                updateRow(row.key, { name: sanitizeInput(value) })
                              }
                              placeholder="Environment name"
                              aria-label="Environment name"
                              aria-invalid={Boolean(problem)}
                              maxLength={32}
                              autoFocus={row.key === focusKey}
                              required
                              disabled={busy}
                            />
                          </div>
                          <label
                            className="flex w-14 shrink-0 cursor-pointer justify-center py-2"
                            title={
                              row.isPrimary
                                ? `${row.name || 'This Environment'} is the primary Environment`
                                : `Make ${label} the primary Environment`
                            }
                          >
                            <input
                              type="radio"
                              name="primaryEnvironment"
                              className="peer sr-only"
                              checked={row.isPrimary}
                              onChange={() => makePrimary(row.key)}
                              disabled={busy}
                              aria-label={`Primary Environment: ${row.name || 'unnamed'}`}
                            />
                            <span
                              aria-hidden
                              className={clsx(
                                'flex size-4 items-center justify-center rounded-full border transition-colors ease peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/50',
                                row.isPrimary
                                  ? 'border-emerald-500'
                                  : 'border-neutral-400 hover:border-neutral-500'
                              )}
                            >
                              <span
                                className={clsx(
                                  'size-2 rounded-full',
                                  row.isPrimary && 'bg-emerald-500'
                                )}
                              />
                            </span>
                          </label>
                          <div className="flex w-9 shrink-0 justify-center">
                            <Button
                              variant="ghost"
                              type="button"
                              onClick={() => removeRow(row.key)}
                              disabled={busy || rows.length === 1}
                              title={
                                rows.length === 1
                                  ? 'An App needs at least one Environment'
                                  : `Remove ${label}`
                              }
                              aria-label={`Remove ${label}`}
                            >
                              <FaTrashAlt />
                            </Button>
                          </div>
                        </div>
                        {problem && <p className="pl-10 text-2xs text-red-500">{problem}</p>}
                      </li>
                    )
                  })}
                </ul>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {atLimit ? (
                      <UpsellDialog
                        title={
                          upgradeTo === ApiOrganisationPlanChoices.Pr
                            ? 'Upgrade to Pro for more environments'
                            : 'Upgrade to Enterprise for unlimited environments'
                        }
                        targetPlan={upgradeTo}
                        buttonVariant="ghost"
                        buttonLabel={
                          <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
                            <FaPlus className="shrink-0 text-2xs" /> Add Environment{' '}
                            <PlanLabel plan={upgradeTo} />
                          </span>
                        }
                      />
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            addRow({ name: '', envType: ApiEnvironmentEnvTypeChoices.Custom })
                          }
                        >
                          <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
                            <FaPlus className="shrink-0 text-2xs" /> Add Environment
                          </span>
                        </Button>
                        {missingStandard.map((env) => (
                          <Button
                            key={env.envType}
                            variant="ghost"
                            type="button"
                            disabled={busy}
                            onClick={() => addRow({ name: env.name, envType: env.envType })}
                            title={`Add ${env.name} back`}
                          >
                            <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-neutral-500">
                              <FaPlus className="shrink-0 text-2xs" /> {env.name}
                            </span>
                          </Button>
                        ))}
                      </>
                    )}
                  </div>
                  {maxEnvs !== null && (
                    <span className="text-2xs text-neutral-500">
                      {rows.length} of {maxEnvs} on the {planName(organisation.plan)} plan
                    </span>
                  )}
                </div>
                <div className="space-y-1 text-xs text-neutral-500">
                  <p>
                    The primary Environment is the App&apos;s main one, like a repository&apos;s
                    main branch: secret values that other Environments share with it are marked in
                    the editor.
                  </p>
                  <p>
                    Names use up to 32 letters, numbers, hyphens and underscores. Environments can
                    be added, renamed, reordered and removed later, too.
                  </p>
                </div>
              </div>
            </>
          )}

          {page === 'secrets' && (
            // A file dropped anywhere on the page lands in the box
            <div className="space-y-2" {...dropTarget}>
              <EnvFileInput
                value={envText}
                setValue={setSecretsText}
                onFile={importFile}
                over={over}
                rows={10}
                lead="Import the secrets the App starts with, or skip this step."
              />
              {importProblem && <p className="text-2xs text-red-500">{importProblem}</p>}
            </div>
          )}

          {page === 'secretOptions' && (
            <>
              <p className="text-sm text-neutral-500">
                {found.length === 1 ? '1 secret' : `${found.length} secrets`} found. Choose the
                Environments to import into, and whether each takes the values and comments or the
                keys alone.
              </p>
              <EnvImportOptions
                environments={rows.map((row) => ({
                  id: row.key,
                  name: row.name,
                  color: rowColor(row),
                }))}
                selectedIds={selectedIds}
                configs={configs}
                onToggleEnv={toggleEnv}
                onChangeConfig={setConfig}
              />
            </>
          )}

          {page === 'access' && (
            <>
              <p className="text-sm text-neutral-500">
                Choose who else can access{' '}
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{name}</span>, and
                which Environments each of them can reach. You can change this later in the
                App&apos;s Access settings.
              </p>
              {accountsLoading ? (
                <div className="flex justify-center py-10">
                  <Spinner size="md" />
                </div>
              ) : assignable === 0 ? (
                <p className="py-6 text-center text-sm text-neutral-500">
                  There&apos;s no one else to choose.
                </p>
              ) : (
                <AppAccessPicker
                  members={members}
                  serviceAccounts={serviceAccounts}
                  teams={teams}
                  environments={rows.map((row) => ({
                    key: row.key,
                    name: row.name,
                    color: rowColor(row),
                  }))}
                  scope={scope}
                  everywhere={everywhere}
                  unavailable={unavailable}
                  notices={{
                    teams: (
                      <Alert variant="warning" icon={true} size="sm">
                        Teams get their keys from the server. Giving a team access turns on
                        server-side encryption (SSE) for this App.
                      </Alert>
                    ),
                  }}
                  onChange={setScope}
                />
              )}
            </>
          )}

          <div className="flex items-center justify-between gap-3">
            {previousPage ? (
              <Button
                variant="secondary"
                type="button"
                onClick={() => setPage(previousPage)}
                disabled={busy}
              >
                <FaArrowLeft className="text-2xs" /> Back
              </Button>
            ) : (
              <Button
                variant="secondary"
                type="button"
                onClick={() => dialogRef.current?.closeModal()}
                disabled={busy}
              >
                Cancel
              </Button>
            )}
            <div className="flex items-center gap-3">
              {stage && <span className="text-xs text-neutral-500">{stage}</span>}
              <Button
                type="submit"
                variant="primary"
                isLoading={busy}
                disabled={
                  (page === 'secretOptions' && selectedIds.length === 0) ||
                  (!nextPage && (!orgAdminsData || !keyring))
                }
                title={
                  page === 'secretOptions' && selectedIds.length === 0
                    ? 'Choose an Environment to import into'
                    : undefined
                }
              >
                {submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </GenericDialog>
    </>
  )
})

NewAppDialog.displayName = 'NewAppDialog'

export default NewAppDialog
