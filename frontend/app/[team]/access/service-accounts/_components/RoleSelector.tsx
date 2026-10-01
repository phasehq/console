import { ServiceAccountType, RoleType } from '@/apollo/graphql'
import { RoleLabel } from '@/components/users/RoleLabel'
import { KeyringContext } from '@/contexts/keyringContext'
import { organisationContext } from '@/contexts/organisationContext'
import { AssignableRoleOption } from '@/components/access/AssignableRoleOption'
import { userCanGrantRole, userHasPermission } from '@/utils/access/permissions'
import { isHandledGraphQLError } from '@/utils/errors'
import { useQuery, useMutation } from '@apollo/client'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'
import { useContext, useState, Fragment } from 'react'
import { FaChevronDown } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { UpdateServiceAccountOp } from '@/graphql/mutations/service-accounts/updateServiceAccount.gql'

export const ServiceAccountRoleSelector = (props: {
  account: ServiceAccountType
  displayOnly?: boolean
}) => {
  const { account, displayOnly } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const userCanReadApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'read')

  const userCanUpdateAccountRoles = organisation
    ? userHasPermission(organisation.role!.permissions, 'ServiceAccounts', 'update') &&
      userHasPermission(organisation.role!.permissions, 'Roles', 'read')
    : false

  const { data: appsData } = useQuery(GetApps, {
    variables: { organisationId: organisation!.id },
    skip: !userCanReadApps,
  })

  const { data: roleData, loading: roleDataPending } = useQuery(GetRoles, {
    variables: { orgId: organisation!.id },
    skip: !userCanUpdateAccountRoles,
  })

  const [updateRole] = useMutation(UpdateServiceAccountOp)

  const [role, setRole] = useState<RoleType>(account.role!)

  const isOwner = role.name!.toLowerCase() === 'owner'

  const handleUpdateRole = async (newRole: RoleType) => {
    try {
      await updateRole({
        variables: {
          serviceAccountId: account.id,
          roleId: newRole.id,
          name: account.name,
        },
      })
      setRole(newRole)
      toast.success('Updated role!')
    } catch (error) {
      // The global errorLink surfaces the server error (e.g. grant-ceiling violations)
      if (!isHandledGraphQLError(error)) toast.error('Something went wrong')
    }
  }

  const roleOptions =
    roleData?.roles.filter(
      (option: RoleType) => option.name !== 'Owner' && option.name !== 'Admin'
    ) || []

  // Grant ceiling: roles with permissions beyond the viewer's own can't be assigned
  const roleIsAssignable = (option: RoleType) =>
    userCanGrantRole(organisation?.role?.permissions ?? '', option.permissions ?? '')

  const disabled = isOwner || !userCanUpdateAccountRoles || displayOnly

  if (roleDataPending) return <></>

  return disabled ? (
    <RoleLabel role={role} />
  ) : (
    <div className="space-y-1 w-full relative">
      <Listbox disabled={disabled} value={role} onChange={handleUpdateRole}>
        {({ open }) => (
          <>
            <Listbox.Button as={Fragment} aria-required>
              <div
                className={clsx(
                  'py-2 flex items-center gap-4 rounded-md h-10',
                  disabled ? 'cursor-not-allowed' : 'cursor-pointer'
                )}
              >
                <RoleLabel role={role} />
                {!disabled && (
                  <FaChevronDown
                    className={clsx(
                      'transition-transform ease duration-300 text-neutral-500',
                      open ? 'rotate-180' : 'rotate-0'
                    )}
                  />
                )}
              </div>
            </Listbox.Button>
            <Listbox.Options className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10 w-max min-w-[15rem] focus:outline-none">
              {roleOptions.map((option: RoleType) => (
                <AssignableRoleOption
                  key={option.name}
                  option={option}
                  assignable={roleIsAssignable(option)}
                />
              ))}
            </Listbox.Options>
          </>
        )}
      </Listbox>
    </div>
  )
}
