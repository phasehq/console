'use client'

import {
  forwardRef,
  useContext,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQuery } from '@apollo/client'
import { useParams, useRouter } from 'next/navigation'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { FaArrowLeft, FaArrowRight, FaCheck, FaPlus, FaTrashAlt } from 'react-icons/fa'
import { FaArrowDownUpLock } from 'react-icons/fa6'
import {
  ApiEnvironmentEnvTypeChoices,
  ApiOrganisationPlanChoices,
  MemberType,
  OrganisationMemberType,
  OrganisationType,
  ServiceAccountType,
} from '@/apollo/graphql'
import { GetGlobalAccessUsers } from '@/graphql/queries/organisation/getGlobalAccessUsers.gql'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { KeyringContext } from '@/contexts/keyringContext'
import { MAX_APP_NAME_LENGTH } from '@/constants'
import { createApplication, DEFAULT_APP_ENVIRONMENTS, NewAppAccess } from '@/utils/app'
import { userHasGlobalAccess, userHasPermission } from '@/utils/access/permissions'
import { defaultEnvColor, sanitizeInput } from '@/utils/environment'
import GenericDialog from '../common/GenericDialog'
import { Button } from '../common/Button'
import { Input } from '../common/Input'
import { Alert } from '../common/Alert'
import { ColorPicker } from '../common/ColorPicker'
import Spinner from '../common/Spinner'
import { UpsellDialog } from '../settings/organisation/UpsellDialog'
import { PlanLabel } from '../settings/organisation/PlanLabel'
import { AccessScope, AppAccessPicker } from './AppAccessPicker'

/** An environment row: `key` stays the same while it is renamed. A blank color is the default */
type EnvRow = { key: string; name: string; envType: ApiEnvironmentEnvTypeChoices; color: string }

let lastRowKey = 0
const rowKey = () => `env-${(lastRowKey += 1)}`

const STANDARD_ORDER: Partial<Record<ApiEnvironmentEnvTypeChoices, number>> = {
  [ApiEnvironmentEnvTypeChoices.Dev]: 0,
  [ApiEnvironmentEnvTypeChoices.Staging]: 1,
  [ApiEnvironmentEnvTypeChoices.Prod]: 2,
}
const isStandard = (row: EnvRow) => row.envType in STANDARD_ORDER

/** The rows in the order the App will have them: the server keeps Development, Staging and
 * Production at the front, and adds each other environment after the last */
const inAppOrder = (rows: EnvRow[]) => [
  ...rows
    .filter(isStandard)
    .sort((a, b) => STANDARD_ORDER[a.envType]! - STANDARD_ORDER[b.envType]!),
  ...rows.filter((row) => !isStandard(row)),
]

const startingRows = (): EnvRow[] =>
  DEFAULT_APP_ENVIRONMENTS.map((env) => ({ ...env, key: rowKey(), color: '' }))

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
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

const planName = (plan: ApiOrganisationPlanChoices) =>
  plan === ApiOrganisationPlanChoices.Fr
    ? 'Free'
    : plan === ApiOrganisationPlanChoices.Pr
      ? 'Pro'
      : 'Enterprise'

const Steps = ({ step }: { step: 1 | 2 }) => (
  <ol className="flex items-center gap-2 text-2xs font-medium" aria-label="Steps">
    {(['App', 'Access'] as const).map((label, at) => {
      const number = (at + 1) as 1 | 2
      const done = number < step
      const current = number === step
      return (
        <li key={label} className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
          {at > 0 && <span aria-hidden className="h-px w-5 bg-neutral-500/40" />}
          <span
            className={clsx(
              'flex items-center gap-1.5',
              current ? 'text-zinc-900 dark:text-zinc-100' : 'text-neutral-500'
            )}
          >
            <span
              className={clsx(
                'flex size-4 items-center justify-center rounded-full text-[0.6rem] ring-1 ring-inset',
                current
                  ? 'bg-emerald-500 text-white ring-emerald-500 dark:bg-emerald-400/20 dark:text-emerald-400 dark:ring-emerald-400/40'
                  : done
                    ? 'text-emerald-600 ring-emerald-500/60 dark:text-emerald-400'
                    : 'ring-neutral-500/40'
              )}
            >
              {done ? <FaCheck className="text-[0.5rem]" /> : number}
            </span>
            {label}
          </span>
        </li>
      )
    })}
  </ol>
)

interface NewAppDialogProps {
  organisation: OrganisationType
  showButton: boolean
}

/**
 * Creates an App: its name and the Environments it starts with (Development, Staging and
 * Production to begin with, each one renamed, recoloured or removed, and others added up to the
 * plan's limit), then, on a second page, which members and service accounts can reach which of
 * them. Opens the new App once it exists.
 */
const NewAppDialog = forwardRef(({ organisation, showButton }: NewAppDialogProps, ref) => {
  const router = useRouter()
  const params = useParams<{ team: string }>()
  const { keyring } = useContext(KeyringContext)

  const permissions = organisation.role?.permissions
  const canAssignMembers =
    userHasPermission(permissions, 'Members', 'create', true) &&
    userHasPermission(permissions, 'Members', 'read')
  const canAssignServiceAccounts =
    userHasPermission(permissions, 'ServiceAccounts', 'create', true) &&
    userHasPermission(permissions, 'ServiceAccounts', 'read')

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const nameInputRef = useRef(null)
  // Accounts are only fetched once the dialog has been opened
  const [opened, setOpened] = useState(false)

  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [rows, setRows] = useState<EnvRow[]>(startingRows)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const [scope, setScope] = useState<AccessScope>(new Map())
  const [error, setError] = useState<Error | null>(null)
  // What it's doing while it creates, shown beside the button
  const [stage, setStage] = useState<string | null>(null)
  const busyRef = useRef(false)

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

  const members = useMemo(
    () =>
      canAssignMembers ? ((membersData?.organisationMembers ?? []) as OrganisationMemberType[]) : [],
    [membersData, canAssignMembers]
  )
  const serviceAccounts = useMemo(
    () =>
      canAssignServiceAccounts
        ? ((serviceAccountsData?.serviceAccounts ?? []) as ServiceAccountType[])
        : [],
    [serviceAccountsData, canAssignServiceAccounts]
  )

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
    (canAssignServiceAccounts && (!opened || (serviceAccountsLoading && !serviceAccountsData)))
  const assignable =
    members.filter((member) => !everywhere.has(member.id) && !unavailable.has(member.id)).length +
    serviceAccounts.length
  // Without anyone to choose, there is no second page
  const hasAccessStep =
    (canAssignMembers || canAssignServiceAccounts) && (accountsLoading || assignable > 0)

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

  const reset = () => {
    setStep(1)
    setName('')
    setRows(startingRows())
    setFocusKey(null)
    setShowProblems(false)
    setScope(new Map())
    setError(null)
    setStage(null)
  }

  useImperativeHandle(ref, () => ({
    openModal: () => dialogRef.current?.openModal(),
  }))

  const updateRow = (key: string, change: Partial<EnvRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)))
  const removeRow = (key: string) =>
    setRows((current) => current.filter((row) => row.key !== key))
  const addRow = (row: Omit<EnvRow, 'key' | 'color'>) => {
    const key = rowKey()
    setRows((current) => inAppOrder([...current, { ...row, key, color: '' }]))
    if (!row.name) setFocusKey(key)
  }

  const create = async () => {
    if (busyRef.current || !keyring || !orgAdminsData) return
    busyRef.current = true
    setError(null)
    setStage('Creating the App…')

    const position = new Map(rows.map((row, at) => [row.key, at]))
    const access: NewAppAccess[] = [
      ...members.map((account) => ({ account, memberType: MemberType.User })),
      ...serviceAccounts.map((account) => ({ account, memberType: MemberType.Service })),
    ].flatMap(({ account, memberType }) => {
      if (everywhere.has(account.id) || unavailable.has(account.id)) return []
      const environments = [...(scope.get(account.id) ?? [])]
        .map((key) => position.get(key))
        .filter((at): at is number => at !== undefined)
        .sort((a, b) => a - b)
      return environments.length > 0 ? [{ account, memberType, environments }] : []
    })

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
        })),
        access,
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
    if (!created.accessGiven) problems.push("the access you chose couldn't be given")
    if (problems.length > 0) toast.warning(`${name} was created, but ${problems.join(' and ')}.`)
    else toast.success(`${name} was created`)

    busyRef.current = false
    dialogRef.current?.closeModal()
    router.push(`/${params?.team ?? organisation.name}/apps/${created.id}`)
  }

  const handleSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (step === 1) {
      if ([...problems.values()].some(Boolean)) {
        setShowProblems(true)
        return
      }
      if (hasAccessStep) {
        setStep(2)
        return
      }
    }
    create()
  }

  const busy = stage !== null

  const title = (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
          Create an App
        </h3>
        <div
          className="rounded-md px-2 text-2xs font-semibold flex items-center gap-1 text-emerald-500 bg-emerald-400/10 cursor-help"
          title="Secrets (keys, values, comments) will be encrypted with end-to-end encryption"
        >
          <FaArrowDownUpLock />
          End-to-End Encrypted
        </div>
      </div>
      {/* Only once it's known there is someone to choose, so a lone member never sees it flash */}
      {(step === 2 || (hasAccessStep && !accountsLoading)) && <Steps step={step} />}
    </div>
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

          {step === 1 ? (
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
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-xs text-neutral-500">
                    Environments<span className="ml-1 text-red-500">*</span>
                  </span>
                  {maxEnvs !== null && (
                    <span className="text-2xs text-neutral-500">
                      {rows.length} of {maxEnvs} on the {planName(organisation.plan)} plan
                    </span>
                  )}
                </div>

                <ul className="space-y-2" aria-label="Environments">
                  {rows.map((row) => {
                    const problem = showProblems || duplicates ? problems.get(row.key) : null
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
                          <Button
                            variant="ghost"
                            type="button"
                            onClick={() => removeRow(row.key)}
                            disabled={busy || rows.length === 1}
                            title={
                              rows.length === 1
                                ? 'An App needs at least one Environment'
                                : `Remove ${row.name || 'this Environment'}`
                            }
                            aria-label={`Remove ${row.name || 'this Environment'}`}
                          >
                            <FaTrashAlt />
                          </Button>
                        </div>
                        {problem && <p className="pl-10 text-2xs text-red-500">{problem}</p>}
                      </li>
                    )
                  })}
                </ul>

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
                          onClick={() => addRow(env)}
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
                <p className="text-xs text-neutral-500">
                  Names use up to 32 letters, numbers, hyphens and underscores. Environments can be
                  added, renamed, reordered and removed later, too.
                </p>
              </div>
            </>
          ) : (
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
              ) : (
                <AppAccessPicker
                  members={members}
                  serviceAccounts={serviceAccounts}
                  environments={rows.map((row) => ({
                    key: row.key,
                    name: row.name,
                    color: rowColor(row),
                  }))}
                  scope={scope}
                  everywhere={everywhere}
                  unavailable={unavailable}
                  onChange={setScope}
                />
              )}
            </>
          )}

          <div className="flex items-center justify-between gap-3">
            {step === 1 ? (
              <Button
                variant="secondary"
                type="button"
                onClick={() => dialogRef.current?.closeModal()}
                disabled={busy}
              >
                Cancel
              </Button>
            ) : (
              <Button variant="secondary" type="button" onClick={() => setStep(1)} disabled={busy}>
                <FaArrowLeft className="text-2xs" /> Back
              </Button>
            )}
            <div className="flex items-center gap-3">
              {stage && <span className="text-xs text-neutral-500">{stage}</span>}
              {step === 1 && hasAccessStep ? (
                <Button type="submit" variant="primary">
                  Next <FaArrowRight className="text-2xs" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={busy}
                  disabled={!orgAdminsData || !keyring}
                >
                  Create App
                </Button>
              )}
            </div>
          </div>
        </form>
      </GenericDialog>
    </>
  )
})

NewAppDialog.displayName = 'NewAppDialog'

export default NewAppDialog
