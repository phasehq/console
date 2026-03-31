'use client'

import { AppType, EnvironmentType, TeamType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { AddTeamAppsOp } from '@/graphql/mutations/teams/addTeamApps.gql'
import { useMutation, useQuery } from '@apollo/client'
import { useContext, useRef, useState } from 'react'
import { FaPlus, FaCheck, FaUsers, FaChevronDown } from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { Disclosure } from '@headlessui/react'

export const AddTeamToAppDialog = ({
  appId,
  appEnvironments,
}: {
  appId: string
  appEnvironments: EnvironmentType[]
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: teamsData } = useQuery(GetTeams, {
    variables: { organisationId: organisation?.id },
    skip: !organisation,
  })

  const [addTeamApps, { loading }] = useMutation(AddTeamAppsOp)

  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [selectedEnvIds, setSelectedEnvIds] = useState<Set<string>>(new Set())

  // Filter out teams that already have access to this app
  const availableTeams: TeamType[] =
    teamsData?.teams?.filter(
      (team: TeamType) => !team.apps?.some((a) => a!.id === appId)
    ) || []

  const envIds = appEnvironments.map((e) => e.id)

  const toggleEnv = (envId: string) => {
    setSelectedEnvIds((prev) => {
      const next = new Set(prev)
      if (next.has(envId)) next.delete(envId)
      else next.add(envId)
      return next
    })
  }

  const toggleAllEnvs = () => {
    setSelectedEnvIds((prev) => {
      const allSelected = envIds.every((id) => prev.has(id))
      return allSelected ? new Set() : new Set(envIds)
    })
  }

  const handleSubmit = async () => {
    if (!selectedTeamId || selectedEnvIds.size === 0) return
    try {
      await addTeamApps({
        variables: {
          teamId: selectedTeamId,
          appEnvs: [
            {
              appId,
              envIds: Array.from(selectedEnvIds),
            },
          ],
        },
        refetchQueries: [
          {
            query: GetTeams,
            variables: { organisationId: organisation!.id },
          },
          {
            query: GetApps,
            variables: { organisationId: organisation!.id, appId },
          },
        ],
      })
      toast.success('Team added to app')
      reset()
      dialogRef.current?.closeModal()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const reset = () => {
    setSelectedTeamId(null)
    setSelectedEnvIds(new Set())
  }

  const selectedTeam = availableTeams.find((t) => t.id === selectedTeamId)

  return (
    <GenericDialog
      title="Add team to app"
      buttonContent={
        <>
          <FaPlus /> Add Team
        </>
      }
      buttonVariant="primary"
      ref={dialogRef}
      onClose={reset}
    >
      <div className="space-y-4 py-4">
        {availableTeams.length === 0 ? (
          <p className="text-sm text-neutral-500 text-center py-4">
            No available teams. All teams already have access to this app, or no teams exist.
          </p>
        ) : (
          <>
            {/* Team Selection */}
            <div className="space-y-2">
              <label className="block text-neutral-500 text-xs">Select a team</label>
              <div className="max-h-48 overflow-y-auto divide-y divide-zinc-500/20 border border-zinc-500/20 rounded-lg">
                {availableTeams.map((team: TeamType) => (
                  <div
                    key={team.id}
                    className={clsx(
                      'flex items-center justify-between py-2.5 px-3 cursor-pointer transition',
                      selectedTeamId === team.id
                        ? 'bg-emerald-500/10'
                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    )}
                    onClick={() => {
                      setSelectedTeamId(team.id)
                      // Auto-select all envs when a team is picked
                      setSelectedEnvIds(new Set(envIds))
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <FaUsers className="text-neutral-500 text-sm" />
                      <div>
                        <div className="text-sm font-medium">{team.name}</div>
                        <div className="text-xs text-neutral-500">
                          {team.memberCount} member{team.memberCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div
                      className={clsx(
                        'w-5 h-5 rounded-full border flex items-center justify-center transition',
                        selectedTeamId === team.id
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-neutral-500/40'
                      )}
                    >
                      {selectedTeamId === team.id && <FaCheck className="text-xs" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Environment Selection */}
            {selectedTeam && (
              <Disclosure defaultOpen>
                {({ open }) => (
                  <div className="border border-zinc-500/20 rounded-lg overflow-hidden">
                    <Disclosure.Button className="w-full flex items-center justify-between p-3 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      <span className="text-sm font-medium">
                        Environment access
                        {selectedEnvIds.size > 0 && (
                          <span className="text-2xs ml-2 px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-500">
                            {selectedEnvIds.size} selected
                          </span>
                        )}
                      </span>
                      <FaChevronDown
                        className={clsx(
                          'text-neutral-500 transition-transform',
                          open && 'rotate-180'
                        )}
                      />
                    </Disclosure.Button>
                    <Disclosure.Panel className="p-3 border-t border-zinc-500/20">
                      <div className="space-y-1">
                        <div
                          className="flex items-center gap-2 p-1.5 cursor-pointer text-sm text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                          onClick={toggleAllEnvs}
                        >
                          <div
                            className={clsx(
                              'w-4 h-4 rounded border flex items-center justify-center transition',
                              envIds.every((id) => selectedEnvIds.has(id))
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : 'border-neutral-500/40'
                            )}
                          >
                            {envIds.every((id) => selectedEnvIds.has(id)) && (
                              <FaCheck className="text-2xs" />
                            )}
                          </div>
                          Select all environments
                        </div>
                        {appEnvironments.map((env) => (
                          <div
                            key={env.id}
                            className="flex items-center gap-2 p-1.5 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
                            onClick={() => toggleEnv(env.id)}
                          >
                            <div
                              className={clsx(
                                'w-4 h-4 rounded border flex items-center justify-center transition',
                                selectedEnvIds.has(env.id)
                                  ? 'bg-emerald-500 border-emerald-500 text-white'
                                  : 'border-neutral-500/40'
                              )}
                            >
                              {selectedEnvIds.has(env.id) && (
                                <FaCheck className="text-2xs" />
                              )}
                            </div>
                            <span className="text-sm">{env.name}</span>
                            <span className="text-2xs text-neutral-500 uppercase">
                              {env.envType}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Disclosure.Panel>
                  </div>
                )}
              </Disclosure>
            )}
          </>
        )}

        <div className="flex justify-end items-center">
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={loading}
            disabled={!selectedTeamId || selectedEnvIds.size === 0}
          >
            Add Team
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
