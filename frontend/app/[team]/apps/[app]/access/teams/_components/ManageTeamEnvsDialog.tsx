'use client'

import { EnvironmentType, TeamAppEnvironmentType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { organisationContext } from '@/contexts/organisationContext'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { UpdateTeamAppEnvironmentsOp } from '@/graphql/mutations/teams/updateTeamAppEnvironments.gql'
import { useMutation } from '@apollo/client'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { FaCog } from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'

export const ManageTeamEnvsDialog = ({
  teamId,
  teamName,
  appId,
  appEnvironments,
  teamEnvs,
}: {
  teamId: string
  teamName: string
  appId: string
  appEnvironments: EnvironmentType[]
  teamEnvs: TeamAppEnvironmentType[]
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [updateEnvs, { loading }] = useMutation(UpdateTeamAppEnvironmentsOp)
  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const initialIds = useMemo(
    () => new Set(teamEnvs.filter((tae) => tae.environment).map((tae) => tae.environment!.id)),
    [teamEnvs]
  )

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialIds))

  useEffect(() => {
    setSelectedIds(new Set(initialIds))
  }, [initialIds])

  const scopeUpdated = useMemo(() => {
    if (selectedIds.size !== initialIds.size) return true
    for (const id of selectedIds) {
      if (!initialIds.has(id)) return true
    }
    return false
  }, [selectedIds, initialIds])

  const allEnvIds = appEnvironments.map((e) => e.id)
  const allSelected = allEnvIds.length > 0 && allEnvIds.every((id) => selectedIds.has(id))

  const toggleEnv = (envId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(envId)) next.delete(envId)
      else next.add(envId)
      return next
    })
  }

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allEnvIds))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedIds.size === 0) return
    try {
      await updateEnvs({
        variables: {
          teamId,
          appId,
          envIds: Array.from(selectedIds),
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
      toast.success(`Updated environment access for ${teamName}`)
      dialogRef.current?.closeModal()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleClose = () => {
    setSelectedIds(new Set(initialIds))
  }

  const handleCancel = () => {
    if (scopeUpdated) {
      setSelectedIds(new Set(initialIds))
    } else {
      dialogRef.current?.closeModal()
    }
  }

  const scopeLabel = appEnvironments
    .filter((e) => initialIds.has(e.id))
    .map((e) => e.name)
    .join(' + ')

  return (
    <div className="flex items-center gap-4">
      <span className="text-zinc-900 dark:text-zinc-100 text-2xs font-medium">
        {scopeLabel || 'None'}
      </span>
      <div className="opacity-0 group-hover:opacity-100 transition ease flex items-center gap-2">
        <GenericDialog
          ref={dialogRef}
          title={`Manage environment access for ${teamName}`}
          buttonVariant="secondary"
          buttonContent={
            <>
              <FaCog /> Manage
            </>
          }
          onClose={handleClose}
        >
          <form className="space-y-6 pt-4" onSubmit={handleSubmit}>
            <div>
              <label className="block text-2xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                Environment scope <span className="text-red-500">*</span>
              </label>
              {selectedIds.size === 0 && (
                <p className="text-red-500 text-xs mb-2">Select at least one environment</p>
              )}
              <div
                className="flex items-center justify-between py-2 cursor-pointer"
                onClick={toggleAll}
              >
                <span className="text-2xs text-neutral-500">All environments</span>
                <ToggleSwitch size="sm" value={allSelected} onToggle={toggleAll} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {appEnvironments.map((env) => {
                  const isSelected = selectedIds.has(env.id)
                  return (
                    <div
                      key={env.id}
                      className={clsx(
                        'flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-full border transition',
                        isSelected
                          ? 'border-emerald-500/40 bg-emerald-500/10'
                          : 'border-zinc-500/20 hover:border-zinc-500/40'
                      )}
                      onClick={() => toggleEnv(env.id)}
                    >
                      <span className="text-2xs text-zinc-900 dark:text-zinc-100">{env.name}</span>
                      <ToggleSwitch
                        size="sm"
                        value={isSelected}
                        onToggle={() => toggleEnv(env.id)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="flex items-center gap-4 justify-between">
              <Button variant="secondary" type="button" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                isLoading={loading}
                disabled={selectedIds.size === 0 || !scopeUpdated}
              >
                Save
              </Button>
            </div>
          </form>
        </GenericDialog>
      </div>
    </div>
  )
}
