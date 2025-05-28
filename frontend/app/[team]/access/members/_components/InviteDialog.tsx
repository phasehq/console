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
import { FaChevronDown, FaDownload, FaPlus, FaTrashAlt } from 'react-icons/fa'
import { GetOrganisationPlan } from '@/graphql/queries/organisation/getOrganisationPlan.gql'
import GetInvites from '@/graphql/queries/organisation/getInvites.gql'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { BulkInviteMembers } from '@/graphql/mutations/organisation/bulkInviteMembers.gql'
import { userHasGlobalAccess, userHasPermission } from '@/utils/access/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import clsx from 'clsx'
import GenericDialog from '@/components/common/GenericDialog'
import { toast } from 'react-toastify'
import { FaEnvelope } from 'react-icons/fa6'

type Invite = {
  email: string
  role?: RoleType
}

type InviteLink = {
  email: string
  link: string
}

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

  const defaultRole = roleOptions
    ? roleOptions.find((option) => option.name === 'Developer') || roleOptions[0]
    : undefined

  const upsell =
    isCloudHosted() &&
    activeOrganisation?.plan === ApiOrganisationPlanChoices.Fr &&
    data?.organisationPlan.seatsUsed.total === data?.organisationPlan.maxUsers

  const [createInvites, { error, loading: mutationLoading }] = useMutation(BulkInviteMembers)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  const [invites, setInvites] = useState<Invite[]>([{ email: '', role: undefined }])

  const emailInputRef = useRef(null)

  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([])
  const [errorMessage, setErrorMessage] = useState<string>('')

  const addInvite = () => {
    setInvites([...invites, { email: '', role: defaultRole }]) // default to first role
  }

  const updateInvite = (index: number, updated: Partial<Invite>) => {
    setInvites((prev) =>
      prev.map((invite, i) => (i === index ? { ...invite, ...updated } : invite))
    )
  }

  const removeInvite = (index: number) => {
    setInvites(invites.filter((_, i) => i !== index))
  }

  const reset = () => {
    setInvites([{ email: '', role: defaultRole }])
    setInviteLinks([])
    setErrorMessage('')
  }

  const closeModal = () => {
    reset()
    dialogRef.current?.closeModal()
  }

  const openModal = () => dialogRef.current?.openModal()

  useEffect(() => {
    if (defaultRole) {
      invites.forEach((invite, i) => {
        if (invite.role === undefined) updateInvite(i, { role: defaultRole })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultRole])

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

    const invalid = invites.find((invite) => !invite.email || !invite.role)
    if (invalid) {
      toast.error('Please fill out all emails and roles.')
      return
    }

    const seen = new Set<string>()
    const duplicates = invites.some((invite) => {
      if (seen.has(invite.email)) return true
      seen.add(invite.email)
      return false
    })

    if (duplicates) {
      toast.error('Duplicate email addresses are not allowed.')
      return
    }

    try {
      const response = await createInvites({
        variables: {
          orgId: organisationId,
          invites: invites.map((invite) => ({
            email: invite.email,
            apps: [],
            roleId: invite.role!.id,
          })),
        },
        refetchQueries: [
          {
            query: GetInvites,
            variables: { orgId: organisationId },
          },
        ],
        fetchPolicy: 'network-only',
      })

      const returnedInvites = response.data?.bulkInviteOrganisationMembers.invites ?? []

      const links: InviteLink[] = returnedInvites.map((invite: any) => ({
        email: invite.inviteeEmail,
        link: getInviteLink(invite.id),
      }))

      setInviteLinks(links)
    } catch (err) {
      console.error(err)
      toast.error('An error occurred while sending invites.')
    }
  }

  const BulkAddEmailsDialog = () => {
    const [bulkEmails, setBulkEmails] = useState('')

    const handleBulkEmailImport = () => {
      const seen = new Set(invites.map((i) => i.email))
      const newEmails = bulkEmails
        .split(/[\s,]+/) // split by spaces, commas, or newlines
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) // validate email format
        .filter((email) => !seen.has(email))

      if (newEmails.length === 0) {
        toast.error('No valid or unique emails found.')
        return
      }

      const imported = newEmails.map((email) => ({
        email,
        role: defaultRole,
      }))

      setInvites((prev) => [...prev.filter((invite) => invite.email !== ''), ...imported])
      setBulkEmails('')

      toast.success(`${imported.length} email(s) imported.`)
    }

    return (
      <GenericDialog
        title="Import emails"
        buttonVariant="ghost"
        buttonContent={
          <>
            <FaDownload />
            Bulk import emails
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-neutral-500">
            Paste email adresses separated by commas, spaces, or new lines
          </p>
          <div className="space-y-4">
            <textarea
              value={bulkEmails}
              onChange={(e) => setBulkEmails(e.target.value)}
              placeholder="Paste emails separated by commas, spaces, or new lines"
              rows={10}
              className="w-full text-sm"
            ></textarea>
            <div className="flex justify-end">
              <Button onClick={handleBulkEmailImport} variant="primary" type="button">
                Import
              </Button>
            </div>
          </div>
        </div>
      </GenericDialog>
    )
  }

  if (upsell)
    return (
      <UpsellDialog
        buttonLabel={
          <>
            <FaPlus /> Add members
          </>
        }
      />
    )

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        size="lg"
        title="Invite members"
        initialFocus={emailInputRef}
        onClose={reset}
        buttonContent={
          <>
            <FaPlus /> Add members
          </>
        }
      >
        <div className="space-y-4 divide-y divide-neutral-500/40 h-full ">
          <p className="text-neutral-500">Invite users to your Organisation.</p>
          <div>
            {inviteLinks.length === 0 && (
              <form className="space-y-6 pt-4" onSubmit={handleInvite}>
                {errorMessage && (
                  <Alert variant="danger" icon={true}>
                    {errorMessage}
                  </Alert>
                )}

                <p className="text-neutral-500">
                  Enter the email address and role for each user. They&apos;ll each get a unique
                  invite link.
                </p>

                <div className="text-sm h-full max-h-[65vh] overflow-y-auto">
                  {invites.map((invite, index) => (
                    <div key={index} className="flex items-end gap-6 py-2">
                      <div className="w-full">
                        <Input
                          value={invite.email}
                          setValue={(value) => updateInvite(index, { email: value })}
                          label={index === 0 ? 'User email' : undefined}
                          type="email"
                          required
                        />
                      </div>
                      <div className="space-y-1 w-full relative overflow-y-visible">
                        {index === 0 && <label className="text-neutral-500 text-sm">Role</label>}
                        <Listbox
                          value={invite.role}
                          onChange={(value) => updateInvite(index, { role: value })}
                        >
                          {({ open }) => (
                            <>
                              <Listbox.Button as={Fragment} aria-required>
                                <div
                                  className={clsx(
                                    'p-2 flex items-center justify-between gap-4 h-10 ring-1 ring-inset ring-neutral-500/40 bg-zinc-100 dark:bg-zinc-800 rounded-lg',
                                    !userCanReadRoles ? 'cursor-not-allowed' : 'cursor-pointer'
                                  )}
                                >
                                  {invite.role && <RoleLabel role={invite.role} />}
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
                                {roleOptions.map((role) => (
                                  <Listbox.Option key={role.name} value={role} as={Fragment}>
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
                      <div className="pb-1">
                        {invites.length > 1 && (
                          <Button
                            variant="danger"
                            type="button"
                            onClick={() => removeInvite(index)}
                          >
                            <div className="p-1 shrink-0">
                              <FaTrashAlt />
                            </div>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-4">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={addInvite}
                    className="text-sm text-left text-neutral-500 inline-flex items-center gap-2"
                  >
                    <FaPlus /> Add another member
                  </Button>

                  <BulkAddEmailsDialog />
                </div>

                <div className="col-span-2 flex items-center gap-4 justify-between">
                  <Button variant="secondary" type="button" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit" isLoading={mutationLoading}>
                    <FaEnvelope /> Invite {invites.length > 1 && ` ${invites.length} users`}
                  </Button>
                </div>
              </form>
            )}
            {inviteLinks.length > 0 && (
              <div className="py-8 space-y-6">
                <div className="text-center max-w-lg mx-auto">
                  <h3 className="font-semibold text-xl text-black dark:text-white">
                    Invite{inviteLinks.length > 0 ? 's' : ''} sent!
                  </h3>
                  <p className="text-neutral-500">
                    Invite link{inviteLinks.length > 0 ? 's have' : 'has'} been sent by email. You
                    can also copy the invite link{inviteLinks.length > 0 ? 's' : ''} for each user
                    and share them manually. Invites expire in 72 hours.
                  </p>
                </div>
                <Alert variant="info" icon={true} size="sm">
                  You can add users to specific Apps and Environments once they accept their invite
                  and join your Organisation.
                </Alert>

                {inviteLinks.length <= 5 &&
                  inviteLinks.map(({ email, link }) => (
                    <div key={email} className="space-y-2">
                      <p className="text-sm font-medium text-black dark:text-white">{email}</p>
                      <div className="group relative overflow-x-hidden rounded-lg border border-neutral-500/40 bg-zinc-300/50 dark:bg-zinc-800/50 p-3 text-left text-emerald-800 dark:text-emerald-300">
                        <pre className="ph-no-capture text-sm whitespace-nowrap">{link}</pre>
                        <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent to-zinc-300 dark:to-zinc-800" />
                        <div className="absolute right-1 top-2.5">
                          <CopyButton value={link} defaultHidden={false} />
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </GenericDialog>
    </>
  )
}
