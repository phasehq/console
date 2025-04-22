'use client'

import { OrganisationMemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import RemoveMember from '@/graphql/mutations/organisation/deleteOrgMember.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { useMutation } from '@apollo/client'
import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useContext, useState } from 'react'
import { FaTimes, FaTrashAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { useRouter } from 'next/navigation'

export const DeleteMemberConfirmDialog = (props: {
  member: OrganisationMemberType
  organisationId: string
}) => {
  const { member, organisationId } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [removeMember] = useMutation(RemoveMember)

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const router = useRouter()

  const handleRemoveMember = async () => {
    await removeMember({
      variables: { memberId: member.id },
      refetchQueries: [
        {
          query: GetOrganisationMembers,
          variables: { organisationId: organisationId, role: null },
        },
      ],
      onCompleted: () => {
        toast.success('Member removed successfully')
        closeModal()
        router.push(`/${organisation?.name}/access/members`)
      },
      onError: (error) => {
        toast.error(`Failed to remove member: ${error.message}`)
        closeModal()
      },
    })
  }

  const activeUserCanDeleteUsers = organisation?.role?.permissions
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'delete', false)
    : false

  const allowDelete =
    !member.self! && activeUserCanDeleteUsers && member.role!.name!.toLowerCase() !== 'owner'

  return (
    <>
      {allowDelete && (
        <Button
          variant="danger"
          onClick={openModal}
          title="Remove member"
          disabled={member.role!.name!.toLowerCase() === 'owner'}
          className="flex items-center gap-1"
        >
          <FaTrashAlt /> Delete
        </Button>
      )}

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={closeModal}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-md" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Remove member
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6 p-4">
                    <p className="text-neutral-500">
                      Are you sure you want to remove {member.fullName || member.email} from this
                      organisation? This action cannot be undone.
                    </p>
                    <div className="flex items-center gap-4">
                      <Button variant="secondary" type="button" onClick={closeModal}>
                        Cancel
                      </Button>
                      <Button variant="danger" onClick={handleRemoveMember}>
                        Remove Member
                      </Button>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
