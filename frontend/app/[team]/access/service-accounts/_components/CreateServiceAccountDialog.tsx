import { OrganisationMemberType, RoleType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Fragment, useContext, useEffect, useRef, useState } from 'react'
import { FaChevronDown, FaPlus } from 'react-icons/fa'
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { GetServiceAccountHandlers } from '@/graphql/queries/service-accounts/getServiceAccountHandlers.gql'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { GetServerKey } from '@/graphql/queries/syncing/getServerKey.gql'
import { CreateServiceAccountOp } from '@/graphql/mutations/service-accounts/createServiceAccount.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { useMutation, useQuery } from '@apollo/client'
import {
  organisationSeed,
  organisationKeyring,
  getUserKxPublicKey,
  encryptAsymmetric,
} from '@/utils/crypto'
import { Input } from '@/components/common/Input'
import { RoleLabel } from '@/components/users/RoleLabel'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'

const bip39 = require('bip39')

export const CreateServiceAccountDialog = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: roleData, loading: roleDataPending } = useQuery(GetRoles, {
    variables: { orgId: organisation?.id },
    skip: !organisation,
  })

  const { data: serviceAccountHandlerData } = useQuery(GetServiceAccountHandlers, {
    variables: { orgId: organisation?.id },
    skip: !organisation,
  })

  const [createServiceAccount] = useMutation(CreateServiceAccountOp)

  const { data: serverKeyData } = useQuery(GetServerKey)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [name, setName] = useState('')
  const [role, setRole] = useState<RoleType | null>(null)
  const [thirdParty, setThirdParty] = useState(false)
  const [createPending, setCreatePending] = useState(false)

  const roleOptions = roleData?.roles.filter((option: RoleType) => option.name !== 'Owner') || []

  const handleCreateServiceAccount = (e: { preventDefault: () => void }) => {
    return new Promise<boolean>((resolve) => {
      e.preventDefault()
      setCreatePending(true)
      setTimeout(async () => {
        // Compute new keys for service account
        const mnemonic = bip39.generateMnemonic(256)
        const accountSeed = await organisationSeed(mnemonic, organisation!.id)
        const keyring = await organisationKeyring(accountSeed)

        // Wrap keys for server if required
        let serverKeys = undefined
        if (thirdParty) {
          const serverKey = serverKeyData.serverPublicKey

          const serverEncryptedKeyring = await encryptAsymmetric(JSON.stringify(keyring), serverKey)

          const serverEncryptedMnemonic = await encryptAsymmetric(mnemonic, serverKey)

          serverKeys = {
            serverEncryptedKeyring,
            serverEncryptedMnemonic,
          }
        }

        // Wrap keys for service account handlers
        const handlers: OrganisationMemberType[] = serviceAccountHandlerData.serviceAccountHandlers

        const handlerWrappingPromises = handlers.map(async (handler) => {
          const kxKey = await getUserKxPublicKey(handler.identityKey!)
          const wrappedKeyring = await encryptAsymmetric(JSON.stringify(keyring), kxKey)
          const wrappedRecovery = await encryptAsymmetric(mnemonic, kxKey)
          return {
            memberId: handler.id,
            wrappedKeyring,
            wrappedRecovery,
          }
        })

        const handlerKeys = await Promise.all(handlerWrappingPromises)

        await createServiceAccount({
          variables: {
            name,
            orgId: organisation!.id,
            roleId: role!.id,
            identityKey: keyring.publicKey,
            serverWrappedKeyring: serverKeys?.serverEncryptedKeyring || null,
            serverWrappedRecovery: serverKeys?.serverEncryptedMnemonic || null,
            handlers: handlerKeys,
          },
          refetchQueries: [
            {
              query: GetServiceAccounts,
              variables: { orgId: organisation!.id },
            },
          ],
        })

        setCreatePending(false)

        if (dialogRef.current) dialogRef.current.closeModal()

        toast.success('Created new service account!')

        resolve(true)
      }, 500)
    })
  }

  return (
    <GenericDialog
      title="Create a new Service Account"
      buttonContent={
        <>
          <FaPlus /> Create Service Account
        </>
      }
      buttonVariant="primary"
      size="lg"
      ref={dialogRef}
    >
      <form onSubmit={handleCreateServiceAccount}>
        <div className="grid grid-cols-2 gap-8 max-h-[85vh] overflow-y-auto">
          <Input value={name} setValue={setName} label="Account name" required maxLength={32} />
          <div className="space-y-1 w-full">
            <label className="block text-neutral-500 text-sm mb-2" htmlFor="role">
              Role
            </label>
            <Listbox value={role} onChange={setRole} name="role">
              {({ open }) => (
                <>
                  <Listbox.Button as={Fragment} aria-required>
                    <div
                      className={clsx(
                        'py-2 flex items-center justify-between w-full rounded-md h-10'
                      )}
                    >
                      {role ? <RoleLabel role={role} /> : <>Select a role</>}
                      <FaChevronDown
                        className={clsx(
                          'transition-transform ease duration-300 text-neutral-500',
                          open ? 'rotate-180' : 'rotate-0'
                        )}
                      />
                    </div>
                  </Listbox.Button>
                  <Listbox.Options className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10 w-max focus:outline-none">
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
          {/* <div>
            <label className="block text-neutral-500 text-sm mb-2" htmlFor="role">
              Enable third-party authentication
            </label>
            <ToggleSwitch value={thirdParty} onToggle={() => setThirdParty(!thirdParty)} />
          </div> */}
        </div>
        <div className="flex justify-end items-center gap-2 pt-8">
          <Button type="submit" variant="primary" isLoading={createPending}>
            Create Service Account
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}
