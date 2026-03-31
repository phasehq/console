'use client'

import { RoleType, TeamType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { RoleLabel } from '@/components/users/RoleLabel'
import { organisationContext } from '@/contexts/organisationContext'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { UpdateTeamOp } from '@/graphql/mutations/teams/updateTeam.gql'
import { useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useRef, useState } from 'react'
import { FaCog, FaChevronDown, FaUserShield, FaRobot } from 'react-icons/fa'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'
import { toast } from 'react-toastify'

const RoleSelector = ({
  value,
  onChange,
  options,
  icon,
  title,
  subtitle,
}: {
  value: RoleType | null
  onChange: (v: RoleType | null) => void
  options: RoleType[]
  icon: React.ReactNode
  title: string
  subtitle: string
}) => (
  <div className="space-y-2 w-full">
    <div className="flex items-start gap-3">
      <div className="text-neutral-500 mt-0.5 text-lg shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {title}
        </label>
        <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>
        <div className="mt-2 relative">
          <Listbox value={value} onChange={onChange}>
            {({ open }) => (
              <>
                <Listbox.Button as={Fragment}>
                  <div className="py-2 flex items-center justify-between w-full rounded-md border border-zinc-500/20 px-3 h-10 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition">
                    {value ? (
                      <RoleLabel role={value} />
                    ) : (
                      <span className="text-neutral-500 text-sm">None (use org role)</span>
                    )}
                    <FaChevronDown
                      className={clsx(
                        'transition-transform ease duration-300 text-neutral-500 text-xs',
                        open ? 'rotate-180' : 'rotate-0'
                      )}
                    />
                  </div>
                </Listbox.Button>
                <Listbox.Options className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10 w-full focus:outline-none mt-1">
                  <Listbox.Option value={null} as={Fragment}>
                    {({ active }) => (
                      <div
                        className={clsx(
                          'flex items-center gap-2 p-2 cursor-pointer rounded-full text-sm',
                          active && 'bg-zinc-300 dark:bg-zinc-700'
                        )}
                      >
                        None (use org role)
                      </div>
                    )}
                  </Listbox.Option>
                  {options.map((role: RoleType) => (
                    <Listbox.Option key={role.id} value={role} as={Fragment}>
                      {({ active }) => (
                        <div
                          className={clsx(
                            'flex items-center gap-2 p-2 cursor-pointer rounded-full',
                            active && 'bg-zinc-300 dark:bg-zinc-700'
                          )}
                        >
                          <RoleLabel role={role} />
                        </div>
                      )}
                    </Listbox.Option>
                  ))}
                </Listbox.Options>
              </>
            )}
          </Listbox>
        </div>
      </div>
    </div>
  </div>
)

export const UpdateTeamDialog = ({ team }: { team: TeamType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: roleData } = useQuery(GetRoles, {
    variables: { orgId: organisation?.id },
    skip: !organisation,
  })

  const [updateTeam, { loading }] = useMutation(UpdateTeamOp)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [name, setName] = useState(team.name)
  const [description, setDescription] = useState(team.description || '')
  const [memberRole, setMemberRole] = useState<RoleType | null>(
    (team.memberRole as RoleType) || null
  )
  const [saRole, setSaRole] = useState<RoleType | null>(
    (team.serviceAccountRole as RoleType) || null
  )

  const roleOptions = roleData?.roles || []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await updateTeam({
        variables: {
          teamId: team.id,
          name,
          description: description || null,
          memberRoleId: memberRole?.id || '',
          serviceAccountRoleId: saRole?.id || '',
        },
        refetchQueries: [
          {
            query: GetTeams,
            variables: { organisationId: organisation!.id, teamId: team.id },
          },
        ],
      })
      toast.success('Team updated')
      dialogRef.current?.closeModal()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <GenericDialog
      title="Team settings"
      buttonContent={
        <>
          <FaCog /> Settings
        </>
      }
      buttonVariant="secondary"
      ref={dialogRef}
      onClose={() => {
        setName(team.name)
        setDescription(team.description || '')
        setMemberRole((team.memberRole as RoleType) || null)
        setSaRole((team.serviceAccountRole as RoleType) || null)
      }}
    >
      <form onSubmit={handleSubmit} className="space-y-6 pt-4">
        <Input value={name} setValue={setName} label="Team name" required maxLength={64} />

        <div className="space-y-2 w-full">
          <label className="block text-neutral-500 text-xs">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 p-2 text-sm resize-none"
            rows={3}
            placeholder="Optional team description"
          />
        </div>

        <div className="space-y-4">
          <RoleSelector
            value={memberRole}
            onChange={setMemberRole}
            options={roleOptions}
            icon={<FaUserShield />}
            title="Member role"
            subtitle="Choose a role that overrides org-level permissions for team members within apps assigned to this team."
          />

          <RoleSelector
            value={saRole}
            onChange={setSaRole}
            options={roleOptions}
            icon={<FaRobot />}
            title="Service account role"
            subtitle="Choose a role that overrides org-level permissions for service accounts within apps assigned to this team."
          />
        </div>

        <div className="flex justify-end items-center gap-2">
          <Button type="submit" variant="primary" isLoading={loading}>
            Save Changes
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}
