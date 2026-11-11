import { FaChevronDown, FaPlus } from 'react-icons/fa'
import { FaCircle } from 'react-icons/fa6'
import GenericDialog from '../common/GenericDialog'
import { GetGlobalAccessUsers } from '@/graphql/queries/organisation/getGlobalAccessUsers.gql'
import {
  ApiEnvironmentEnvTypeChoices,
  ApiOrganisationPlanChoices,
  EnvironmentKeyInput,
  EnvironmentType,
  MemberType,
  OrganisationMemberType,
  ServiceAccountType,
} from '@/apollo/graphql'
import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { KeyringContext } from '@/contexts/keyringContext'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import {
  createNewEnv,
  encryptSecretsForEnv,
  unwrapEnvSecretsForUser,
  wrapEnvSecretsForAccount,
} from '@/utils/crypto'
import { CreateEnv } from '@/graphql/mutations/environments/createEnvironment.gql'
import { BulkProcessSecrets } from '@/graphql/mutations/environments/bulkProcessSecrets.gql'
import { CreateNewSecretFolder } from '@/graphql/mutations/environments/createFolder.gql'
import UpdateEnvScope from '@/graphql/mutations/apps/updateEnvScope.gql'
import GetAppMembers from '@/graphql/queries/apps/getAppMembers.gql'
import { GetAppServiceAccounts } from '@/graphql/queries/apps/getAppServiceAccounts.gql'
import { GetMemberEnvKeyGrants } from '@/graphql/queries/access/getMemberEnvKeyGrants.gql'
import { Button } from '../common/Button'
import { Input } from '../common/Input'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { toast } from 'react-toastify'
import Spinner from '../common/Spinner'
import { Alert } from '../common/Alert'
import { UpsellDialog, UpsellDialogHandle } from '../settings/organisation/UpsellDialog'
import { envColor, sanitizeInput } from '@/utils/environment'
import { PlanLabel } from '../settings/organisation/PlanLabel'
import { ColorPicker } from '../common/ColorPicker'
import { stringToHexColor } from '@/utils/copy'
import { useAppPermissions } from '@/hooks/useAppPermissions'
import { userHasGlobalAccess } from '@/utils/access/permissions'
import { EnvGrants, grantedEnvIds, hasEnvAccess } from '@/utils/access/envGrants'
import {
  EnvContents,
  emptyFoldersToCreate,
  secretsToClone,
} from '@/utils/environmentClone'
import { EnvAccessPicker } from './EnvAccessPicker'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'

export type CreateEnvironmentOptions = {
  /** Start as a copy of this environment */
  cloneFromId?: string
  /** Copy only these secrets, whichever env's they are: a new environment from a selection */
  onlySecretIds?: ReadonlySet<string>
}

export type CreateEnvironmentDialogHandle = {
  openModal: (options?: CreateEnvironmentOptions) => void
}

type Account =
  | (OrganisationMemberType & { memberType: MemberType.User })
  | (ServiceAccountType & { memberType: MemberType.Service })

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
const listNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
const accountName = (account: Account) =>
  account.memberType === MemberType.User ? account.fullName || account.email || '' : account.name

const SOURCE_OPTION = 'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm'

/** The environment to clone, if any */
const SourcePicker = ({
  environments,
  sourceId,
  allowEmpty,
  onChange,
}: {
  environments: EnvironmentType[]
  sourceId: string | null
  allowEmpty: boolean
  onChange: (sourceId: string | null) => void
}) => {
  const source = environments.find((env) => env.id === sourceId)
  return (
    <Listbox value={sourceId} onChange={onChange}>
      {({ open }) => (
        <div className="relative">
          <Listbox.Button
            className={clsx(
              'flex h-10 w-full items-center justify-between gap-2 bg-zinc-100 p-2 text-left text-sm text-zinc-900 ring-1 ring-inset ring-neutral-500/40 dark:bg-zinc-800 dark:text-zinc-100',
              open ? 'rounded-t-md' : 'rounded-md'
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {source && (
                <FaCircle className="shrink-0 text-[8px]" style={{ color: envColor(source) }} />
              )}
              <span className={clsx('truncate', !source && 'text-neutral-500')}>
                {source ? source.name : 'None'}
              </span>
            </span>
            <FaChevronDown
              className={clsx('shrink-0 text-xs text-neutral-500 transition-transform', open && 'rotate-180')}
            />
          </Listbox.Button>
          <Listbox.Options className="absolute z-10 -mt-px max-h-56 w-full overflow-y-auto rounded-b-md bg-zinc-100 p-1 shadow-2xl ring-1 ring-inset ring-neutral-500/40 focus:outline-none dark:bg-zinc-800">
            {allowEmpty && (
              <Listbox.Option value={null}>
                {({ focus }) => (
                  <div
                    className={clsx(
                      SOURCE_OPTION,
                      'text-neutral-500',
                      focus && 'bg-zinc-200 dark:bg-zinc-700'
                    )}
                  >
                    None
                  </div>
                )}
              </Listbox.Option>
            )}
            {environments.map((env) => (
              <Listbox.Option key={env.id} value={env.id}>
                {({ focus }) => (
                  <div className={clsx(SOURCE_OPTION, focus && 'bg-zinc-200 dark:bg-zinc-700')}>
                    <FaCircle className="shrink-0 text-[8px]" style={{ color: envColor(env) }} />
                    <span className="truncate">{env.name}</span>
                  </div>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </div>
      )}
    </Listbox>
  )
}

/**
 * The secrets grid's "+ New environment" button (with the plan to upgrade to,
 * when the plan's env limit is reached). The grid also opens it from any cell
 * of its new-environment column, its New menu, an env's menu (as a copy of that
 * env) and a selection of secrets.
 */
export const CreateEnvironmentDialog = forwardRef<
  CreateEnvironmentDialogHandle,
  {
    appId: string
    /** What an env holds as deployed, to copy from; null while it's still loading */
    contentsOf?: (envId: string) => EnvContents | null
  }
>(function CreateEnvironmentDialog({ appId, contentsOf }, ref) {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)
  const client = useApolloClient()

  const { hasPermission } = useAppPermissions(appId)
  const canAssignMembers =
    hasPermission('Members', 'read', true) && hasPermission('Members', 'update', true)
  const canAssignServiceAccounts =
    hasPermission('ServiceAccounts', 'read', true) && hasPermission('ServiceAccounts', 'update', true)

  // Accounts are only fetched once the dialog has been opened
  const [opened, setOpened] = useState(false)

  const { data: orgAdminsData, loading: orgAdminsDataLoading } = useQuery(GetGlobalAccessUsers, {
    variables: {
      organisationId: organisation?.id,
    },
    skip: !organisation,
  })

  const { data: appData, loading: appDataLoading } = useQuery(GetAppEnvironments, {
    variables: { appId },
  })

  const { data: membersData } = useQuery(GetAppMembers, {
    variables: { appId },
    skip: !opened || !canAssignMembers,
    fetchPolicy: 'cache-and-network',
  })
  const { data: serviceAccountsData } = useQuery(GetAppServiceAccounts, {
    variables: { appId },
    skip: !opened || !canAssignServiceAccounts,
    fetchPolicy: 'cache-and-network',
  })

  const isLoading = orgAdminsDataLoading || appDataLoading

  const allowNewEnv = () => {
    if (!organisation?.planDetail?.maxEnvsPerApp) return true
    return appData?.appEnvironments.length < organisation.planDetail?.maxEnvsPerApp
  }

  const planDisplay = () => {
    if (organisation?.plan === ApiOrganisationPlanChoices.Fr)
      return {
        planName: 'Free',
        dialogTitle: 'Upgrade to Pro',
        description: `The Free plan is limited to ${organisation.planDetail!.maxEnvsPerApp!} Environments per App. To create more Environments, please upgrade to Pro.`,
      }
    else if (organisation?.plan === ApiOrganisationPlanChoices.Pr)
      return {
        planName: 'Pro',
        dialogTitle: 'Upgrade to Enterprise',
        description: `The Pro plan is limited to ${organisation.planDetail!.maxEnvsPerApp!} Environments per App. To create more Environments, please upgrade to Enterprise.`,
      }
  }

  const [createEnvironment] = useMutation(CreateEnv)
  const [createSecrets] = useMutation(BulkProcessSecrets)
  const [createFolder] = useMutation(CreateNewSecretFolder)
  const [updateScope] = useMutation(UpdateEnvScope)

  const nameId = useId()
  const [name, setName] = useState('')
  // '' = auto: the server stores null and clients derive a color from the name
  const [color, setColor] = useState('')
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [onlySecretIds, setOnlySecretIds] = useState<ReadonlySet<string> | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // What it's doing while it creates, shown beside the button
  const [stage, setStage] = useState<string | null>(null)
  const busyRef = useRef(false)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const upsellRef = useRef<UpsellDialogHandle>(null)
  const inputRef = useRef(null)
  const pendingOptionsRef = useRef<CreateEnvironmentOptions | undefined>(undefined)
  // Once the picker has been used, changing what to copy leaves the choice alone
  const accessTouchedRef = useRef(false)
  const grantsRef = useRef(new Map<string, Promise<EnvGrants>>())

  const environments = useMemo(
    () =>
      [...((appData?.appEnvironments ?? []) as EnvironmentType[])].sort((a, b) => a.index - b.index),
    [appData]
  )
  // A selection can only be copied from an env that holds some of it
  const sources = useMemo(
    () =>
      !contentsOf
        ? []
        : !onlySecretIds
          ? environments
          : environments.filter((env) =>
              contentsOf(env.id)?.secrets.some((secret) => onlySecretIds.has(secret.id))
            ),
    [environments, contentsOf, onlySecretIds]
  )

  useImperativeHandle(ref, () => ({
    openModal: (options) => {
      if (!allowNewEnv()) return upsellRef.current?.openModal()
      pendingOptionsRef.current = options
      dialogRef.current?.openModal()
    },
  }))

  const handleOpen = () => {
    const options = pendingOptionsRef.current
    pendingOptionsRef.current = undefined
    const only = options?.onlySecretIds ?? null
    const firstHolding = only
      ? environments.find((env) => contentsOf?.(env.id)?.secrets.some((s) => only.has(s.id)))
      : undefined
    setOnlySecretIds(only)
    setSourceId(options?.cloneFromId ?? firstHolding?.id ?? null)
    setSelectedIds(new Set())
    accessTouchedRef.current = false
    grantsRef.current = new Map()
    setOpened(true)
  }

  const members = useMemo(
    () => (canAssignMembers ? ((membersData?.appUsers ?? []) as OrganisationMemberType[]) : []),
    [membersData, canAssignMembers]
  )
  const serviceAccounts = useMemo(
    () =>
      canAssignServiceAccounts
        ? ((serviceAccountsData?.appServiceAccounts ?? []) as ServiceAccountType[])
        : [],
    [serviceAccountsData, canAssignServiceAccounts]
  )

  // Admins and the creator get their keys with the environment itself
  const lockedReasons = useMemo(() => {
    const keyHolders = new Set(
      ((orgAdminsData?.organisationGlobalAccessUsers ?? []) as OrganisationMemberType[]).map(
        (user) => user.id
      )
    )
    const reasons = new Map<string, string>()
    for (const member of members) {
      if (userHasGlobalAccess(member.role?.permissions))
        reasons.set(member.id, 'Their role gives access to every Environment')
      else if (keyHolders.has(member.id)) reasons.set(member.id, 'You get access as its creator')
    }
    return reasons
  }, [orgAdminsData, members])

  const assignable = useMemo<Account[]>(
    () => [
      ...members
        .filter((member) => !lockedReasons.has(member.id))
        .map((member) => ({ ...member, memberType: MemberType.User as const })),
      ...serviceAccounts.map((account) => ({ ...account, memberType: MemberType.Service as const })),
    ],
    [members, serviceAccounts, lockedReasons]
  )

  const loadGrants = useCallback(
    (account: Account) => {
      let pending = grantsRef.current.get(account.id)
      if (!pending) {
        pending = client
          .query({
            query: GetMemberEnvKeyGrants,
            variables: { appId, memberId: account.id, memberType: account.memberType },
            fetchPolicy: 'network-only',
          })
          .then(({ data }) => grantedEnvIds(data?.environmentKeys))
        grantsRef.current.set(account.id, pending)
      }
      return pending
    },
    [client, appId]
  )

  // A copy starts with the access its source has
  const [prefilling, setPrefilling] = useState(false)
  useEffect(() => {
    if (!opened || accessTouchedRef.current) return
    if (!sourceId) {
      setSelectedIds(new Set())
      return
    }
    let cancelled = false
    setPrefilling(true)
    Promise.all(assignable.map(async (account) => [account.id, await loadGrants(account)] as const))
      .then((grants) => {
        if (cancelled || accessTouchedRef.current) return
        setSelectedIds(
          new Set(grants.filter(([, granted]) => hasEnvAccess(granted, sourceId)).map(([id]) => id))
        )
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPrefilling(false)
      })
    return () => {
      cancelled = true
    }
  }, [opened, sourceId, assignable, loadGrants])

  const source = environments.find((env) => env.id === sourceId)
  const contents = sourceId && contentsOf ? contentsOf(sourceId) : null
  const copied = contents ? secretsToClone(contents.secrets, onlySecretIds ?? undefined) : []
  // A selection brings only the folders its secrets sit in
  const emptyFolders =
    contents && !onlySecretIds
      ? emptyFoldersToCreate(
          contents.folders,
          copied.map((secret) => secret.path)
        )
      : []
  const sourceLoading = Boolean(sourceId) && !contents

  const closeModal = () => dialogRef.current?.closeModal()

  /** Copies the source's secrets and folders into the new environment */
  const fill = async (env: { id: string; identityKey: string }, salt: string) => {
    if (copied.length > 0) {
      setStage(`Copying ${plural(copied.length, 'secret')}…`)
      const secretsToCreate = await encryptSecretsForEnv(copied, { ...env, salt })
      const { errors } = await createSecrets({
        variables: { secretsToCreate, secretsToUpdate: [], secretsToDelete: [] },
      })
      if (errors) throw new Error('secrets not copied')
    }
    for (const folder of emptyFolders)
      await createFolder({ variables: { envId: env.id, name: folder.name, path: folder.path } })
  }

  /** Adds the new environment to each chosen account's own scope; returns the accounts it couldn't */
  const grant = async (
    env: { id: string; identityKey: string },
    envSecrets: { seed: string; salt: string }
  ) => {
    const chosen = assignable.filter((account) => selectedIds.has(account.id))
    if (chosen.length === 0) return []
    setStage(`Giving access to ${plural(chosen.length, 'account')}…`)

    const mine = new Map(environments.map((environment) => [environment.id, environment]))
    const unwrapped = new Map<string, ReturnType<typeof unwrapEnvSecretsForUser>>()
    const secretsOf = (envId: string) => {
      const held = mine.get(envId)
      if (!held?.wrappedSeed || !held.wrappedSalt) return null
      let pending = unwrapped.get(envId)
      if (!pending) {
        pending = unwrapEnvSecretsForUser(held.wrappedSeed, held.wrappedSalt, keyring!)
        unwrapped.set(envId, pending)
      }
      return pending.then((keys) => ({ ...keys, identityKey: held.identityKey }))
    }

    const refused: Account[] = []
    for (const account of chosen) {
      try {
        // The scope is replaced whole, so its other envs are wrapped again alongside the new one
        const { individual } = await loadGrants(account)
        const kept = individual.map((envId) => ({ envId, keys: secretsOf(envId) }))
        if (kept.some(({ keys }) => keys === null)) {
          refused.push(account)
          continue
        }
        const scope = [
          ...(await Promise.all(kept.map(async ({ envId, keys }) => ({ envId, ...(await keys!) })))),
          { envId: env.id, ...envSecrets, identityKey: env.identityKey },
        ]
        const envKeys: EnvironmentKeyInput[] = await Promise.all(
          scope.map(async ({ envId, seed, salt, identityKey }) => {
            const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForAccount({ seed, salt }, account)
            return { envId, userId: account.id, identityKey, wrappedSeed, wrappedSalt }
          })
        )
        const { errors } = await updateScope({
          variables: { memberId: account.id, memberType: account.memberType, appId, envKeys },
        })
        if (errors) refused.push(account)
      } catch {
        refused.push(account)
      }
    }
    return refused
  }

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (busyRef.current || sourceLoading || !keyring) return

    busyRef.current = true
    setStage('Creating the Environment…')
    let env: { id: string; identityKey: string }
    let envSecrets: { seed: string; salt: string }
    try {
      const newEnvData = await createNewEnv(
        appId,
        name,
        ApiEnvironmentEnvTypeChoices.Custom,
        orgAdminsData.organisationGlobalAccessUsers,
        appData.sseEnabled ? appData.serverPublicKey : null
      )
      const { data } = await createEnvironment({
        variables: {
          envInput: { ...newEnvData.createEnvPayload, color: color || null },
          adminKeys: newEnvData.adminKeysPayload,
          wrappedSeed: newEnvData.serverKeysPayload.wrappedSeed,
          wrappedSalt: newEnvData.serverKeysPayload.wrappedSalt,
        },
      })
      if (!data?.createEnvironment?.environment) throw new Error('not created')
      env = data.createEnvironment.environment
      envSecrets = newEnvData.envSecrets
    } catch {
      busyRef.current = false
      setStage(null)
      return
    }

    // From here the environment exists: whatever goes wrong is reported, not rolled back
    const problems: string[] = []
    try {
      await fill(env, envSecrets.salt)
    } catch {
      problems.push(`not everything from ${source?.name ?? 'the source'} was copied`)
    }
    const refused = await grant(env, envSecrets)
    if (refused.length > 0)
      problems.push(`${listNames(refused.map(accountName))} couldn't be given access`)

    await client.refetchQueries({ include: [GetAppEnvironments, 'GetAppSecrets'] })

    if (problems.length > 0) toast.warning(`${name} was created, but ${problems.join(' and ')}.`)
    else toast.success('Environment created!')
    setName('')
    setColor('')
    busyRef.current = false
    setStage(null)
    closeModal()
  }

  if (isLoading)
    return (
      <div className="flex w-full h-full items-center justify-center">
        <Spinner size="md" />
      </div>
    )

  if (!allowNewEnv()) {
    // Custom environments are a Pro feature (up to 10/app); Enterprise is unlimited.
    // The upgrade target tracks the org's current plan, not the hosting mode.
    const isFreePlan = organisation?.plan === ApiOrganisationPlanChoices.Fr
    const targetPlan = isFreePlan
      ? ApiOrganisationPlanChoices.Pr
      : ApiOrganisationPlanChoices.En

    return (
      <UpsellDialog
        ref={upsellRef}
        title={
          isFreePlan
            ? 'Upgrade to Pro to create custom environments'
            : 'Upgrade to Enterprise for unlimited environments'
        }
        targetPlan={targetPlan}
        buttonLabel={
          <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
            <FaPlus className="shrink-0 text-2xs" /> New environment <PlanLabel plan={targetPlan} />
          </span>
        }
        buttonVariant="ghost"
      />
    )
  }

  const showAccess = members.length + serviceAccounts.length > 0

  return (
    <GenericDialog
      title={allowNewEnv() ? 'Create a new Environment' : planDisplay()?.dialogTitle || ''}
      ref={dialogRef}
      onOpen={handleOpen}
      onClose={() => {}}
      canClose={() => !busyRef.current}
      buttonVariant="ghost"
      buttonContent={
        <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
          <FaPlus className="shrink-0 text-2xs" /> New environment
        </span>
      }
      initialFocus={inputRef}
    >
      <form className="space-y-4 pt-4" onSubmit={handleSubmit}>
        <div>
          <p className="text-neutral-500 text-sm">Create a new Environment in this App</p>
        </div>

        <div className="space-y-2">
          <label htmlFor={nameId} className="block text-xs text-neutral-500">
            Environment name<span className="ml-1 text-red-500">*</span>
          </label>
          {/* The label is outside the row and the swatch has no line height, so it centres on the field */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Input
                id={nameId}
                value={sanitizeInput(name)}
                setValue={setName}
                required
                maxLength={32}
                ref={inputRef}
              />
            </div>
            <div className="leading-[0]" title="Environment color">
              <ColorPicker
                color={color || stringToHexColor(name || 'environment')}
                setColor={setColor}
              />
            </div>
          </div>
          <p className="text-xs text-neutral-500">
            Use up to 32 characters. Only letters, numbers, hyphens, and underscores are allowed.
          </p>
        </div>

        {sources.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-neutral-500">
              {onlySecretIds ? 'Clone the selected secrets from' : 'Clone from'}
            </div>
            <SourcePicker
              environments={sources}
              sourceId={sourceId}
              allowEmpty={!onlySecretIds}
              onChange={setSourceId}
            />
            {source && (
              <p className="text-xs text-neutral-500">
                {sourceLoading
                  ? `Still loading ${source.name}…`
                  : `${
                      copied.length + emptyFolders.length === 0
                        ? `${source.name} has nothing to copy.`
                        : `Copies ${plural(copied.length, 'secret')}${
                            emptyFolders.length > 0
                              ? ` and ${plural(emptyFolders.length, 'empty folder')}`
                              : ''
                          } from ${source.name}.`
                    } Sealed, rotating and dynamic secrets and personal overrides aren't copied.`}
              </p>
            )}
          </div>
        )}

        <div className="space-y-2 border-t border-neutral-500/20 pt-4">
          <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Access {prefilling && <Spinner size="xs" />}
          </h3>
          <Alert variant="info" icon={true} size="sm">
            All Organisation Admins will have access to this Environment.
          </Alert>
          {showAccess && (
            <EnvAccessPicker
              members={members}
              serviceAccounts={serviceAccounts}
              selectedIds={selectedIds}
              lockedReasons={lockedReasons}
              onChange={(ids) => {
                accessTouchedRef.current = true
                setSelectedIds(ids)
              }}
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-3">
          {stage && <span className="text-xs text-neutral-500">{stage}</span>}
          <Button type="submit" variant="primary" isLoading={stage !== null} disabled={sourceLoading}>
            Create
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
})
