import { ApiOrganisationPlanChoices, RoleType } from '@/apollo/graphql'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'
import { Input } from '@/components/common/Input'
import { UpsellDialog } from '@/components/settings/organisation/UpsellDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { isCloudHosted } from '@/utils/appConfig'
import { getInviteLink } from '@/utils/crypto'
import { useQuery, useMutation } from '@apollo/client'
import { Listbox } from '@headlessui/react'
import { useSearchParams } from 'next/navigation'
import { useContext, useState, useRef, useEffect, Fragment, useMemo } from 'react'
import { FaChevronDown, FaPlus } from 'react-icons/fa'
import { GetOrganisationPlan } from '@/graphql/queries/organisation/getOrganisationPlan.gql'
import GetInvites from '@/graphql/queries/organisation/getInvites.gql'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import InviteMember from '@/graphql/mutations/organisation/inviteNewMember.gql'
import { userHasGlobalAccess, userHasPermission } from '@/utils/access/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import clsx from 'clsx'
import GenericDialog from '@/components/common/GenericDialog'
import { toast } from 'react-toastify'

export const InviteDialog = (props: { organisationId: string }) => {
  const { organisationId } = props

  const { activeOrganisation } = useContext(organisationContext)

  const searchParams = useSearchParams()

  // Permissions
  const userCanReadRoles = userHasPermission(activeOrganisation?.role?.permissions, 'Roles', 'read')

  const { data } = useQuery(GetOrganisationPlan, {
    variables: { organisationId },
    fetchPolicy: 'cache-and-network',
  })

  const { data: roleData, loading: roleDataPending } = useQuery(GetRoles, {
    variables: { orgId: activeOrganisation!.id },
    skip: !userCanReadRoles,
  })

  const roleOptions: RoleType[] = useMemo(() => {
    return (
      roleData?.roles.filter(
        (option: RoleType) =>
          !userHasGlobalAccess(option.permissions) &&
          !userHasPermission(option.permissions, 'ServiceAccountTokens', 'create')
      ) || []
    )
  }, [roleData])

  const upsell =
    isCloudHosted() &&
    activeOrganisation?.plan === ApiOrganisationPlanChoices.Fr &&
    data?.organisationPlan.seatsUsed.total === data?.organisationPlan.maxUsers

  const [createInvite, { error, loading: mutationLoading }] = useMutation(InviteMember)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  const [email, setEmail] = useState<string>('')
  const [role, setRole] = useState<RoleType | undefined>(undefined)

  const emailInputRef = useRef(null)

  const [inviteLink, setInviteLink] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')

  const reset = () => {
    setEmail('')
    setInviteLink('')
    setErrorMessage('')
  }

  const closeModal = () => {
    reset()
    dialogRef.current?.closeModal()
  }

  const openModal = () => dialogRef.current?.openModal()

  useEffect(() => {
    if (roleOptions && roleOptions.length > 0) {
      const defaultRole =
        roleOptions.find((option) => option.name === 'Developer') || roleOptions[0]

      setRole(defaultRole)
    }
  }, [roleOptions])

  useEffect(() => {
    if (searchParams?.get('invite')) {
      openModal()
    }
  }, [searchParams])

  useEffect(() => {
    if (error) setErrorMessage(error.message)
  }, [error])

  const handleInvite = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (!role) {
      toast.error('Please select a role')
      return
    }
    const { data } = await createInvite({
      variables: {
        email,
        orgId: organisationId,
        apps: [],
        roleId: role.id,
      },
      refetchQueries: [
        {
          query: GetInvites,
          variables: {
            orgId: organisationId,
          },
        },
      ],
      fetchPolicy: 'network-only',
    })

    setInviteLink(getInviteLink(data?.inviteOrganisationMember.invite.id))
  }

  if (upsell)
    return (
      <UpsellDialog
        buttonLabel={
          <>
            <FaPlus /> Add a member
          </>
        }
      />
    )

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        size="lg"
        title="Invite a new member"
        initialFocus={emailInputRef}
        onClose={reset}
        buttonContent={
          <>
            <FaPlus /> Add a member
          </>
        }
      >
        <div className="space-y-4 divide-y divide-neutral-500/40">
          <p className="text-neutral-500">Invite a user to your Organisation.</p>
          <div>
            {!inviteLink && (
              <form className="space-y-8 py-4" onSubmit={handleInvite}>
                {errorMessage && (
                  <Alert variant="danger" icon={true}>
                    {errorMessage}
                  </Alert>
                )}

                <p className="text-neutral-500">
                  Enter the email address of the user you want to invite below. An invitation link
                  will be sent to this email address.
                </p>

                <Alert variant="info" icon={true}>
                  <p>
                    You will need to manually provision access to <strong> applications </strong>{' '}
                    and <strong> environments </strong> after the member has joined the
                    organization.
                  </p>
                </Alert>

                <div className="flex items-center gap-6">
                  <div className="w-full">
                    <Input
                      value={email}
                      setValue={(value) => setEmail(value)}
                      label="User email"
                      type="email"
                      required
                      autoFocus
                      ref={emailInputRef}
                    />
                  </div>
                  <div className="space-y-1 w-full relative">
                    <label className="text-neutral-500 text-sm">Role</label>
                    <Listbox value={role} onChange={setRole}>
                      {({ open }) => (
                        <>
                          <Listbox.Button as={Fragment} aria-required>
                            <div
                              className={clsx(
                                'p-2 flex items-center justify-between gap-4 h-10 ring-1 ring-inset ring-neutral-500/40 bg-zinc-100 dark:bg-zinc-800 rounded-lg',
                                !userCanReadRoles ? 'cursor-not-allowed' : 'cursor-pointer'
                              )}
                            >
                              {role && <RoleLabel role={role} />}
                              {userCanReadRoles && (
                                <FaChevronDown
                                  className={clsx(
                                    'transition-transform ease duration-300 text-neutral-500',
                                    open ? 'rotate-180' : 'rotate-0'
                                  )}
                                />
                              )}
                            </div>
                          </Listbox.Button>
                          <Listbox.Options className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10 w-full focus:outline-none">
                            {roleOptions.map((role: RoleType) => (
                              <Listbox.Option key={role.name} value={role} as={Fragment}>
                                {({ active, selected }) => (
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

                <div className="col-span-2 flex items-center gap-4 justify-end">
                  <Button variant="secondary" type="button" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit" isLoading={mutationLoading}>
                    Invite
                  </Button>
                </div>
              </form>
            )}
            {inviteLink && (
              <div className="py-8 space-y-6">
                <div className="text-center max-w-lg mx-auto">
                  <h3 className="font-semibold text-xl text-black dark:text-white">Invite sent!</h3>
                  <p className="text-neutral-500">
                    An invite link has been sent by email to{' '}
                    <span className="font-medium text-black dark:text-white">{email}</span>. You can
                    also share the link below to invite this user to your organisation. This invite
                    will expire in 72 hours.
                  </p>
                </div>

                <div className="group relative overflow-x-hidden rounded-lg border border-neutral-500/40 bg-zinc-300/50 dark:bg-zinc-800/50 p-3 text-left text-emerald-800 dark:text-emerald-300">
                  <pre className="ph-no-capture text-sm">{inviteLink}</pre>
                  <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent to-zinc-300 dark:to-zinc-800"></div>
                  <div className="absolute right-1 top-2.5 ">
                    <CopyButton value={inviteLink} defaultHidden={false} />
                  </div>
                </div>

                <Alert variant="info" icon={true} size="sm">
                  You can add users to specific Apps and Environments once they accept this invite
                  and join your Organisation.
                </Alert>
              </div>
            )}
          </div>
        </div>
      </GenericDialog>
    </>
  )
}
