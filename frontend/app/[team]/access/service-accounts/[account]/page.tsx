'use client'

import Spinner from '@/components/common/Spinner'
import { organisationContext } from '@/contexts/organisationContext'
import { GetServiceAccountDetail } from '@/graphql/queries/service-accounts/getServiceAccountDetail.gql'
import { UpdateServiceAccountOp } from '@/graphql/mutations/service-accounts/updateServiceAccount.gql'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { userHasPermission, userHasGlobalAccess } from '@/utils/access/permissions'
import { useMutation, useQuery } from '@apollo/client'
import Link from 'next/link'
import { Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { FaBan, FaBoxOpen, FaBuilding, FaChevronDown, FaChevronLeft, FaCog, FaEdit, FaLink, FaNetworkWired, FaUsers } from 'react-icons/fa'
import { FaServer, FaArrowDownUpLock } from 'react-icons/fa6'
import { DeleteServiceAccountDialog } from '../_components/DeleteServiceAccountDialog'
import { AddAppButton } from './_components/AddAppsToServiceAccountsButton'
import { ServiceAccountType, TeamType } from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import { EmptyState } from '@/components/common/EmptyState'
import { ServiceAccountRoleSelector } from '../_components/RoleSelector'
import { RoleLabel } from '@/components/users/RoleLabel'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'
import CopyButton from '@/components/common/CopyButton'
import { SseLabel } from '@/components/apps/EncryptionModeIndicator'
import { IPChip } from '../../network/_components/IPChip'
import { UpdateAccountNetworkPolicies } from '@/components/access/UpdateAccountNetworkPolicies'
import { ServiceAccountTokens } from './_components/ServiceAccountTokens'
import { KeyManagementDialog } from '@/components/service-accounts/KeyManagementDialog'
import { ServiceAccountIdentities } from './_components/ServiceAccountIdentities'
import { UpdateServiceAccountOwnershipOp } from '@/graphql/mutations/service-accounts/updateServiceAccountOwnership.gql'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'

export default function ServiceAccount({ params }: { params: { team: string; account: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [name, setName] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [savingOwnership, setSavingOwnership] = useState(false)
  const ownershipDialogRef = useRef<{ closeModal: () => void }>(null)

  const userCanReadSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read')
    : false

  const userCanReadAppMemberships = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read', true)
    : false

  const userCanViewNetworkAccess = organisation
    ? userHasPermission(organisation?.role?.permissions, 'NetworkAccessPolicies', 'read')
    : false

  const userCanUpdateSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'update')
    : false

  const userCanDeleteSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'delete')
    : false

  const userCanReadTeams = organisation
    ? userHasPermission(organisation.role!.permissions, 'Teams', 'read')
    : false

  const userIsGlobalAccess = organisation
    ? userHasGlobalAccess(organisation.role!.permissions)
    : false

  const { data, loading } = useQuery(GetServiceAccountDetail, {
    variables: { orgId: organisation?.id, id: params.account },
    skip: !organisation || !userCanReadSA,
    fetchPolicy: 'cache-and-network',
  })

  const { data: teamsData } = useQuery(GetTeams, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !userCanReadTeams,
  })

  const [updateAccount] = useMutation(UpdateServiceAccountOp)
  const [updateOwnership] = useMutation(UpdateServiceAccountOwnershipOp)

  const account: ServiceAccountType = data?.serviceAccounts[0]
  const isTeamOwned = !!account?.team

  const accountTeams = useMemo(() => {
    if (!teamsData?.teams || !account) return []
    return (teamsData.teams as TeamType[]).filter((team) =>
      team.members?.some((m) => m.serviceAccount?.id === account.id)
    )
  }, [teamsData, account])

  const isMultiTeamOrg = !isTeamOwned && accountTeams.length > 1

  // Ownership can be changed by global_access users, or the creator of the owning team
  const ownerTeam = useMemo(() => {
    if (!account?.team || !teamsData?.teams) return null
    return (teamsData.teams as TeamType[]).find((t) => t.id === account.team?.id) || null
  }, [teamsData, account])

  const userCanManageOwnership = useMemo(() => {
    if (userIsGlobalAccess) return true
    if (ownerTeam?.createdBy?.id && organisation?.memberId) {
      return ownerTeam.createdBy.id === organisation.memberId
    }
    return false
  }, [userIsGlobalAccess, ownerTeam, organisation])

  // Non global-access users only see teams they're a member of
  const availableTeams = useMemo(() => {
    if (!teamsData?.teams) return []
    const allTeams = teamsData.teams as TeamType[]
    if (userIsGlobalAccess) return allTeams
    return allTeams.filter((t) =>
      t.members?.some((m) => m.orgMember?.id === organisation?.memberId)
    )
  }, [teamsData, userIsGlobalAccess, organisation])

  // For team-owned SAs, only team members + global_access can manage
  const userCanManageTeamSA = useMemo(() => {
    if (!isTeamOwned) return true // org-level SAs use existing permission checks
    if (userIsGlobalAccess) return true
    return ownerTeam?.members?.some((m) => m.orgMember?.id === organisation?.memberId) ?? false
  }, [isTeamOwned, userIsGlobalAccess, ownerTeam, organisation])

  const nameUpdated = account ? account.name !== name : false

  const updateName = async () => {
    if (!userCanUpdateSA) {
      toast.error("You don't have the permissions requried to update Service Accounts")
    }
    await updateAccount({
      variables: {
        serviceAccountId: account.id,
        roleId: account.role!.id,
        name,
      },
      refetchQueries: [
        {
          query: GetServiceAccountDetail,
          variables: { orgId: organisation?.id, id: params.account },
        },
      ],
    })

    toast.success('Updated account name!')
  }

  const resetName = () => setName(account.name)

  const handleOwnershipSave = async () => {
    setSavingOwnership(true)
    try {
      await updateOwnership({
        variables: {
          serviceAccountId: account.id,
          teamId: selectedTeamId,
        },
        refetchQueries: [
          {
            query: GetServiceAccountDetail,
            variables: { orgId: organisation?.id, id: params.account },
          },
        ],
      })
      toast.success(
        selectedTeamId
          ? 'Service account assigned to team'
          : 'Service account promoted to organisation level'
      )
      if (ownershipDialogRef.current) ownershipDialogRef.current.closeModal()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSavingOwnership(false)
    }
  }

  useEffect(() => {
    if (account) setName(account.name)
  }, [account])

  if (!userCanReadSA)
    return (
      <section>
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view service accounts in this organisation."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      </section>
    )

  if (loading)
    return (
      <div>
        <Spinner size="md" />
      </div>
    )

  if (!account)
    return (
      <section>
        <EmptyState
          title="Not found"
          subtitle="This service account doesn't exist or you don't have access to it"
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      </section>
    )

  return (
    <section className="overflow-y-auto px-3 sm:px-4 lg:px-6">
      <div className="pb-4">
        <Link
          href={`/${params.team}/access/service-accounts`}
          className="text-neutral-500 inline-flex items-center gap-2 text-sm hover:text-zinc-800 dark:hover:text-zinc-200 transition ease"
        >
          <FaChevronLeft /> Back to service accounts
        </Link>
      </div>
      <div className="w-full space-y-6 py-4 text-zinc-900 dark:text-zinc-100 divide-y divide-neutral-500/40">
        <div className="flex items-end justify-between">
          <div className="text-base font-medium flex items-center gap-2">
            <Avatar serviceAccount={account} size="xl" />
            <div>
              <h3 className="relative group w-full max-w-md">
                <input
                  className="custom bg-transparent hover:bg-neutral-500/10 rounded-lg transition ease w-full text-base font-medium"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  readOnly={!userCanUpdateSA}
                  maxLength={64}
                />
                {nameUpdated ? (
                  <div className="flex items-center inset-y-0 gap-1 absolute right-2 backdrop-blur-sm">
                    <Button variant="secondary" onClick={resetName}>
                      <span className="text-2xs">Discard</span>
                    </Button>
                    <Button variant="primary" onClick={updateName}>
                      <span className="text-2xs">Save</span>
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center inset-y-0 gap-1 absolute right-2 opacity-0 group-hover:opacity-100 transition ease ">
                    <FaEdit className="text-neutral-500 text-base" />
                  </div>
                )}
              </h3>
              <div className="flex items-center gap-2">
                <CopyButton
                  value={account.id}
                  buttonVariant="ghost"
                  title="Copy Service Account ID to clipboard"
                >
                  <span className="text-neutral-500 text-xs font-mono">{account.id}</span>
                </CopyButton>
                {account.team ? (
                  <Link
                    href={`/${params.team}/access/teams/${account.team.id}`}
                    className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 hover:bg-blue-500/25 transition ease"
                    title={`Owned by team "${account.team.name}" — bound to the team lifecycle`}
                  >
                    <FaLink className="text-[0.55rem]" />
                    {account.team.name}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-neutral-500/15 text-neutral-600 dark:text-neutral-400" title="Organisation-level account — visible org-wide">
                    <FaBuilding className="text-[0.55rem]" />
                    Organisation
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-neutral-500 mt-1">
            {account.serverSideKeyManagementEnabled ? (
              <FaServer className="text-sky-500" />
            ) : (
              <FaArrowDownUpLock className="text-emerald-500" />
            )}

            <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
              {account.serverSideKeyManagementEnabled ? 'Server-side' : 'Client-side'} KMS
            </span>
            {userCanUpdateSA && userCanManageTeamSA && (
              <KeyManagementDialog serviceAccount={account} buttonVariant={'secondary'} />
            )}
          </div>
        </div>

        <div className="py-4 space-y-3">
          {/* Header Section */}
          <div>
            <div className="text-base font-medium">Role</div>
            <div className="text-neutral-500 text-sm">Manage the role for this account</div>
          </div>

          {/* Role Selector and Description */}
          <div className="space-y-2">
            <div className="text-sm w-max flex items-center gap-2">
              <ServiceAccountRoleSelector account={account} displayOnly={!userCanUpdateSA || isTeamOwned} />
              {isTeamOwned && (
                <span className="text-2xs text-neutral-500">(managed by team)</span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-xs text-neutral-500">
                {account.role?.description || 'No description available for this role'}
              </div>
            </div>
          </div>
        </div>

        {userCanManageOwnership && userCanReadTeams && (
          <div className="py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-base font-medium">Ownership</div>
                <div className="text-neutral-500 text-sm">
                  {account.team
                    ? 'This account is owned by a team and only visible to team members.'
                    : 'This account is organisation-level and visible to all members with permission.'}
                </div>
              </div>
              <GenericDialog
                title="Manage Ownership"
                buttonContent={<>Manage</>}
                buttonVariant="secondary"
                size="sm"
                ref={ownershipDialogRef}
                onOpen={() => {
                  setSelectedTeamId(account.team?.id || null)
                  setSavingOwnership(false)
                }}
              >
                <div className="pt-4 space-y-4">
                  <p className="text-sm text-neutral-500">
                    Change who owns and manages this service account.
                  </p>

                  <Listbox
                    value={selectedTeamId}
                    onChange={setSelectedTeamId}
                    disabled={isMultiTeamOrg}
                  >
                    {({ open }) => (
                      <div className="relative">
                        <Listbox.Button
                          className={clsx(
                            'w-full flex items-center justify-between gap-2 py-2 px-3 rounded-md bg-zinc-100 dark:bg-zinc-800 text-sm',
                            isMultiTeamOrg ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                          )}
                        >
                          <span className="flex items-center gap-1.5">
                            {selectedTeamId ? (
                              <>
                                <FaUsers className="text-blue-500 text-xs" />
                                {availableTeams.find((t) => t.id === selectedTeamId)?.name ||
                                  account.team?.name}
                              </>
                            ) : (
                              <>
                                <FaBuilding className="text-neutral-500 text-xs" />
                                Organisation (no team)
                              </>
                            )}
                          </span>
                          <FaChevronDown
                            className={clsx(
                              'transition-transform ease duration-300 text-neutral-500 text-xs',
                              open ? 'rotate-180' : 'rotate-0'
                            )}
                          />
                        </Listbox.Button>
                        <Listbox.Options className="absolute z-10 mt-1 w-full bg-zinc-200 dark:bg-zinc-800 rounded-md shadow-2xl p-1 max-h-60 overflow-auto focus:outline-none">
                          {userIsGlobalAccess && (
                            <Listbox.Option value={null} as={Fragment}>
                              {({ active, selected }) => (
                                <div
                                  className={clsx(
                                    'px-3 py-2 cursor-pointer rounded text-sm flex items-center gap-1.5',
                                    active && 'bg-zinc-300 dark:bg-zinc-700',
                                    selected && 'font-medium'
                                  )}
                                >
                                  <FaBuilding className="text-neutral-500 text-xs" />
                                  Organisation (no team)
                                </div>
                              )}
                            </Listbox.Option>
                          )}
                          {availableTeams.map((t) => (
                            <Listbox.Option key={t.id} value={t.id} as={Fragment}>
                              {({ active, selected }) => (
                                <div
                                  className={clsx(
                                    'px-3 py-2 cursor-pointer rounded text-sm flex items-center gap-1.5',
                                    active && 'bg-zinc-300 dark:bg-zinc-700',
                                    selected && 'font-medium'
                                  )}
                                >
                                  <FaUsers className="text-blue-500 text-xs" />
                                  {t.name}
                                </div>
                              )}
                            </Listbox.Option>
                          ))}
                        </Listbox.Options>
                      </div>
                    )}
                  </Listbox>

                  {isMultiTeamOrg && (
                    <Alert variant="info" icon size="sm">
                      <span className="text-xs">
                        This account is a member of multiple teams and cannot be assigned to a
                        specific team. Remove the account from all but one team before changing
                        ownership.
                      </span>
                    </Alert>
                  )}

                  {isTeamOwned && selectedTeamId === null && (
                    <Alert variant="warning" icon size="sm">
                      <span className="text-xs">
                        Promoting this account to organisation level will make it visible and
                        manageable by all users with the relevant permissions. The existing team
                        membership will be preserved.
                      </span>
                    </Alert>
                  )}

                  <div className="flex justify-end pt-2">
                    <Button
                      variant="primary"
                      onClick={handleOwnershipSave}
                      isLoading={savingOwnership}
                      disabled={
                        isMultiTeamOrg ||
                        selectedTeamId === (account.team?.id || null)
                      }
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </GenericDialog>
            </div>
          </div>
        )}

        {userCanReadTeams && (
          <div className="py-4 space-y-3">
            <div>
              <div className="text-base font-medium">Teams</div>
              <div className="text-neutral-500 text-sm">
                Teams this account belongs to
              </div>
            </div>

            <div className="space-y-2 divide-y divide-neutral-500/20 py-4">
              {accountTeams.length > 0 ? (
                accountTeams.map((team) => (
                  <div
                    key={team.id}
                    className="flex items-center justify-between py-1.5 px-2 group"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/${params.team}/access/teams/${team.id}`}
                          className="font-medium text-sm text-zinc-900 dark:text-zinc-100 hover:underline"
                        >
                          {team.name}
                        </Link>
                        {team.serviceAccountRole && <RoleLabel role={team.serviceAccountRole} size="xs" />}
                      </div>
                      {team.description && (
                        <div className="text-2xs text-neutral-500 truncate max-w-md">
                          {team.description}
                        </div>
                      )}
                      <div className="text-2xs text-neutral-500">
                        {team.apps?.length || 0} app{team.apps?.length !== 1 ? 's' : ''}
                        {team.apps && team.apps.length > 0 && (
                          <> ({team.apps.map((a) => a!.name).join(', ')})</>
                        )}
                      </div>
                    </div>
                    <Link
                      className="opacity-0 group-hover:opacity-100 transition ease"
                      href={`/${params.team}/access/teams/${team.id}`}
                    >
                      <Button variant="secondary" icon={FaCog}>
                        Manage
                      </Button>
                    </Link>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-neutral-500">
                  This account is not part of any teams.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-medium">App Access</div>
              <div className="text-neutral-500 text-sm">
                {isTeamOwned ? (
                  <>
                    App access for this account is managed through the{' '}
                    <Link
                      href={`/${params.team}/access/teams/${account.team!.id}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {account.team!.name}
                    </Link>{' '}
                    team.
                  </>
                ) : (
                  'Manage the Apps and Environments that this account has access to'
                )}
              </div>
            </div>
            {!isTeamOwned && userCanReadAppMemberships && account.appMemberships?.length! > 0 && (
              <AddAppButton
                serviceAccountId={params.account}
                appMemberships={account.appMemberships ?? []}
              />
            )}
          </div>

          {userCanReadAppMemberships ? (
            <div className="space-y-2 divide-y divide-neutral-500/20 py-4">
              {account.appMemberships && account.appMemberships.length > 0 ? (
                account.appMemberships.map((appMembership) => (
                  <div
                    key={appMembership?.id}
                    className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center py-1.5 px-2 group"
                  >
                    {/* App Name and ID */}
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                          {appMembership?.name}
                        </div>
                        <SseLabel sseEnabled={Boolean(appMembership?.sseEnabled)} />
                      </div>
                      <div className="flex items-center gap-2 text-sm text-neutral-500 group/id">
                        <span className="text-neutral-500 text-2xs flex items-center">App ID:</span>
                        <CopyButton value={appMembership.id} buttonVariant="ghost">
                          <span className="text-neutral-500 text-2xs font-mono">
                            {appMembership.id}
                          </span>
                        </CopyButton>
                      </div>
                    </div>

                    {/* Environments */}
                    <div className="col-span-2">
                      <div className="text-2xs uppercase tracking-widest text-neutral-500 mb-1">
                        Environments
                      </div>
                      <div className="text-xs text-zinc-700 dark:text-zinc-300">
                        {appMembership?.environments?.map((env) => env?.name).join(' + ')}
                      </div>
                    </div>

                    {/* Manage Button */}
                    {!isTeamOwned && (
                      <div className="flex justify-end">
                        <Link
                          className="opacity-0 group-hover:opacity-100 transition ease"
                          href={`/${params.team}/apps/${appMembership?.id}/access/service-accounts?manageAccount=${account.id}`}
                        >
                          <Button variant="secondary" icon={FaCog}>
                            Manage
                          </Button>
                        </Link>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="py-8">
                  <EmptyState
                    title="No Apps"
                    subtitle={
                      isTeamOwned
                        ? `This account will gain app access through the ${account.team!.name} team.`
                        : 'This Service Account does not have access to any Apps. Grant this account access from the Access tab of an App.'
                    }
                    graphic={
                      <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                        <FaBoxOpen />
                      </div>
                    }
                  >
                    {!isTeamOwned && userCanReadAppMemberships && (
                      <AddAppButton
                        serviceAccountId={params.account}
                        appMemberships={account.appMemberships ?? []}
                        align={'right'}
                      />
                    )}
                  </EmptyState>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8">
              <EmptyState
                title="Access restricted"
                subtitle="You don't have the permissions required to view Service Account App memberships"
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <FaBan />
                  </div>
                }
              >
                <></>
              </EmptyState>
            </div>
          )}
        </div>

        <ServiceAccountIdentities account={account} />

        {userCanViewNetworkAccess && (
          <div className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-base font-medium">Network Access Policy</div>
                <div className="text-neutral-500 text-sm">
                  Manage the network access policy for this Account
                </div>
              </div>
              {userCanManageTeamSA && account.networkPolicies?.length! > 0 && (
                <UpdateAccountNetworkPolicies account={account} />
              )}
            </div>

            {!userCanManageTeamSA ? (
              <div className="py-6 text-center text-neutral-500 text-sm">
                You must be a member of the{' '}
                <Link href={`/${params.team}/access/teams/${account.team!.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                  {account.team!.name}
                </Link>{' '}
                team to manage network policies for this account.
              </div>
            ) : account.networkPolicies?.length! > 0 ? (
              <div className="divide-y divide-neutral-500/20 py-4">
                {account.networkPolicies?.map((policy) => (
                  <div key={policy.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex items-center gap-2">
                      <FaNetworkWired className="text-neutral-500 shrink-0 text-xs" />
                      <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                        {policy.name}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {policy.allowedIps.split(',').map((ip) => (
                        <IPChip key={ip} ip={ip}></IPChip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No Policy"
                subtitle={
                  <>
                    This service account does not have any Network Access Policies associated with
                    it.
                    <br /> Access is allowed from any IP address -{' '}
                    <span className="font-semibold font-mono">0.0.0.0/0, ::/0</span>
                  </>
                }
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-5xl text-center">
                    <FaNetworkWired />
                  </div>
                }
              >
                <UpdateAccountNetworkPolicies account={account} />
              </EmptyState>
            )}
          </div>
        )}

        {userCanManageTeamSA ? (
          <ServiceAccountTokens account={account} />
        ) : (
          <div className="py-4 space-y-3">
            <div>
              <div className="text-base font-medium">Tokens</div>
              <div className="text-neutral-500 text-sm">
                Service account access tokens
              </div>
            </div>
            <div className="py-6 text-center text-neutral-500 text-sm">
              You must be a member of the{' '}
              <Link href={`/${params.team}/access/teams/${account.team!.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                {account.team!.name}
              </Link>{' '}
              team to manage tokens for this account.
            </div>
          </div>
        )}

        {userCanDeleteSA && userCanManageTeamSA && (
          <div className="space-y-2 py-4">
            <div>
              <div className="text-base font-medium">Danger Zone</div>
              <div className="text-neutral-500 text-sm">
                These actions are destructive and cannot be reversed
              </div>
            </div>

            <div className="flex justify-between ring-1 ring-inset ring-red-500/40 bg-red-400/10 rounded-lg space-y-2 p-3">
              <div>
                <div className="font-medium text-sm text-red-400">Delete account</div>
                <div className="text-neutral-500 text-xs">
                  Permanently delete this Service Account and all associated tokens
                </div>
              </div>
              <DeleteServiceAccountDialog account={account} />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
