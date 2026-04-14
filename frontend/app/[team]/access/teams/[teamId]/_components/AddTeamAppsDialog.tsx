'use client'

import { AppType, TeamType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { Checkbox } from '@/components/common/Checkbox'
import { organisationContext } from '@/contexts/organisationContext'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { AddTeamAppsOp } from '@/graphql/mutations/teams/addTeamApps.gql'
import { useMutation, useQuery } from '@apollo/client'
import { useContext, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { FaChevronDown, FaExclamationTriangle, FaExternalLinkAlt, FaSearch, FaTimesCircle } from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { Disclosure } from '@headlessui/react'
import { FaCubes } from 'react-icons/fa6'

export const AddTeamAppsDialog = ({ team }: { team: TeamType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const params = useParams<{ team: string }>()

  const { data: appsData } = useQuery(GetApps, {
    variables: { organisationId: organisation?.id },
    skip: !organisation,
  })

  const [addApps, { loading }] = useMutation(AddTeamAppsOp)

  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const [selectedEnvs, setSelectedEnvs] = useState<Record<string, Set<string>>>({})
  const [searchQuery, setSearchQuery] = useState('')

  const existingAppIds = new Set(team.apps?.map((a) => a!.id) || [])

  const allApps: AppType[] =
    appsData?.apps?.filter((app: AppType) => !existingAppIds.has(app.id)) || []

  const sseApps = allApps.filter((app) => app.sseEnabled)
  const nonSseApps = allApps.filter((app) => !app.sseEnabled)

  const filteredSseApps =
    searchQuery !== ''
      ? sseApps.filter((app) => app.name?.toLowerCase().includes(searchQuery.toLowerCase()))
      : sseApps

  const filteredNonSseApps =
    searchQuery !== ''
      ? nonSseApps.filter((app) => app.name?.toLowerCase().includes(searchQuery.toLowerCase()))
      : nonSseApps

  const toggleEnv = (appId: string, envId: string) => {
    setSelectedEnvs((prev) => {
      const next = { ...prev }
      if (!next[appId]) next[appId] = new Set()
      else next[appId] = new Set(next[appId])

      if (next[appId].has(envId)) next[appId].delete(envId)
      else next[appId].add(envId)

      if (next[appId].size === 0) delete next[appId]
      return next
    })
  }

  const toggleAllEnvs = (appId: string, envIds: string[]) => {
    setSelectedEnvs((prev) => {
      const next = { ...prev }
      const current = next[appId] || new Set()
      const allSelected = envIds.every((id) => current.has(id))

      if (allSelected) {
        delete next[appId]
      } else {
        next[appId] = new Set(envIds)
      }
      return next
    })
  }

  const selectedCount = Object.keys(selectedEnvs).length

  const handleSubmit = async () => {
    if (selectedCount === 0) return
    try {
      const appEnvs = Object.entries(selectedEnvs).map(([appId, envIds]) => ({
        appId,
        envIds: Array.from(envIds),
      }))
      await addApps({
        variables: {
          teamId: team.id,
          appEnvs,
        },
        refetchQueries: [
          {
            query: GetTeams,
            variables: { organisationId: organisation!.id, teamId: team.id },
          },
        ],
      })
      toast.success(`Granted access to ${selectedCount} app${selectedCount !== 1 ? 's' : ''}`)
      reset()
      dialogRef.current?.closeModal()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const reset = () => {
    setSelectedEnvs({})
    setSearchQuery('')
  }

  return (
    <GenericDialog
      title="Manage app access"
      buttonContent={
        <>
          <FaCubes /> Manage app Access
        </>
      }
      buttonVariant="primary"
      ref={dialogRef}
      size="lg"
      onClose={reset}
    >
      <div className="space-y-3 pt-4">
        <p className="text-2xs text-neutral-500">
          Grant this team access to apps and environments. Only SSE-enabled apps can be assigned to
          teams.
        </p>

        <div className="relative flex items-center bg-zinc-200 dark:bg-zinc-800 rounded-md px-2">
          <FaSearch className="text-neutral-500 text-xs shrink-0" />
          <input
            placeholder="Search apps"
            className="custom bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-neutral-500 w-full text-xs py-1.5"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <FaTimesCircle
            className={clsx(
              'cursor-pointer text-neutral-500 transition-opacity ease absolute right-2 text-xs',
              searchQuery ? 'opacity-100' : 'opacity-0'
            )}
            role="button"
            onClick={() => setSearchQuery('')}
          />
        </div>

        {filteredSseApps.length === 0 && filteredNonSseApps.length === 0 ? (
          <p className="text-xs text-neutral-500 text-center py-4">
            {searchQuery
              ? 'No apps match your search'
              : 'No available apps. All SSE-enabled apps are already assigned to this team.'}
          </p>
        ) : (
          <div className="max-h-[80vh] overflow-y-auto space-y-1.5">
            {filteredSseApps.map((app: AppType) => {
              const envIds = app.environments?.filter(Boolean).map((e) => e!.id) || []
              const appSelected = selectedEnvs[app.id]
              const allEnvsSelected = appSelected && envIds.every((id) => appSelected.has(id))

              return (
                <Disclosure key={app.id}>
                  {({ open }) => (
                    <div className="border border-zinc-500/20 rounded-lg overflow-hidden">
                      <Disclosure.Button className="w-full flex items-center justify-between px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-xs text-zinc-900 dark:text-zinc-100">{app.name}</span>
                          {appSelected && (
                            <span className="text-2xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-500">
                              {appSelected.size} env{appSelected.size !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <FaChevronDown
                          className={clsx(
                            'text-neutral-500 text-2xs transition-transform',
                            open && 'rotate-180'
                          )}
                        />
                      </Disclosure.Button>
                      <Disclosure.Panel className="px-3 pb-2 border-t border-zinc-500/20">
                        <div
                          className="flex items-center justify-between py-2 cursor-pointer"
                          onClick={() => toggleAllEnvs(app.id, envIds)}
                        >
                          <span className="text-2xs text-neutral-500">All environments</span>
                          <Checkbox
                            size="sm"
                            checked={!!allEnvsSelected}
                            onChange={() => toggleAllEnvs(app.id, envIds)}
                          />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {app.environments?.map((env) => {
                            if (!env) return null
                            const isSelected = !!appSelected?.has(env.id)
                            return (
                              <div
                                key={env.id}
                                className={clsx(
                                  'flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-full border transition',
                                  isSelected
                                    ? 'border-emerald-500/40 bg-emerald-500/10'
                                    : 'border-zinc-500/20 hover:border-zinc-500/40'
                                )}
                                onClick={() => toggleEnv(app.id, env.id)}
                              >
                                <span className="text-2xs text-zinc-900 dark:text-zinc-100">{env.name}</span>
                                <Checkbox
                                  size="sm"
                                  checked={isSelected}
                                  onChange={() => toggleEnv(app.id, env.id)}
                                />
                              </div>
                            )
                          })}
                        </div>
                      </Disclosure.Panel>
                    </div>
                  )}
                </Disclosure>
              )
            })}

            {filteredNonSseApps.length > 0 && (
              <>
                <div className="border-t border-zinc-500/20" />
                <Disclosure>
                  {({ open }) => (
                    <div>
                      <Disclosure.Button className="w-full flex items-center justify-between py-2 px-3 text-2xs text-amber-500">
                        <div className="flex items-center gap-1.5">
                          <FaExclamationTriangle className="shrink-0" />
                          <span>{filteredNonSseApps.length} hidden app{filteredNonSseApps.length !== 1 ? 's' : ''}</span>
                        </div>
                        <FaChevronDown
                          className={clsx(
                            'text-neutral-500 text-2xs transition-transform',
                            open && 'rotate-180'
                          )}
                        />
                      </Disclosure.Button>
                      <Disclosure.Panel className="space-y-1">
                        <p className="text-2xs text-neutral-500 mb-2">
                          These apps need SSE enabled in settings before they can be assigned to teams.
                        </p>
                        {filteredNonSseApps.map((app: AppType) => (
                          <div key={app.id} className="flex items-center justify-between py-1.5 px-2">
                            <Link
                              href={`/${params!.team}/apps/${app.id}/settings`}
                              className="font-medium text-xs text-zinc-900 dark:text-zinc-100 hover:text-emerald-500 dark:hover:text-emerald-400 transition"
                            >
                              {app.name}
                            </Link>
                            <FaExternalLinkAlt className="text-neutral-500 text-2xs shrink-0" />
                          </div>
                        ))}
                      </Disclosure.Panel>
                    </div>
                  )}
                </Disclosure>
              </>
            )}
          </div>
        )}

        <div className="flex justify-between items-center pt-1">
          <span className="text-2xs text-neutral-500">
            {selectedCount} app{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={loading}
            disabled={selectedCount === 0}
          >
            Grant Access
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
