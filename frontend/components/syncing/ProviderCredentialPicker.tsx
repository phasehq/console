import { ProviderCredentialsType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import { useQuery } from '@apollo/client'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { Fragment, useContext, useEffect } from 'react'
import { FaChevronDown, FaKey, FaPlus } from 'react-icons/fa'
import { Button } from '../common/Button'
import { usePathname } from 'next/navigation'

export const ProviderCredentialPicker = (props: {
  credential: ProviderCredentialsType | null
  setCredential: (credential: ProviderCredentialsType) => void
  orgId: string
  disabled?: boolean
  providerFilter?: string
  newCredentialCallback?: () => void
  setDefault?: boolean
}) => {
  const {
    credential,
    setCredential,
    orgId,
    disabled,
    providerFilter,
    newCredentialCallback,
    setDefault,
  } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: credentialsData } = useQuery(GetSavedCredentials, {
    variables: { orgId },
  })

  const credentials: ProviderCredentialsType[] = credentialsData?.savedCredentials ?? []

  const filteredCredentials = providerFilter
    ? credentials.filter((cred) => cred.provider?.id === providerFilter)
    : credentials

  useEffect(() => {
    if (setDefault) setCredential(filteredCredentials[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerFilter, filteredCredentials, setDefault])

  const NewCredentialsLink = () => (
    <Link href={`/${organisation!.name}/integrations?newCredential=true`}>
      <Button variant="secondary" onClick={newCredentialCallback}>
        <div className="flex items-center gap-2">
          <FaPlus /> Add service credentials
        </div>
      </Button>
    </Link>
  )

  if (filteredCredentials.length === 0)
    return (
      <div>
        <NewCredentialsLink />
      </div>
    )

  return (
    <Listbox value={credential} onChange={setCredential}>
      {({ open }) => (
        <>
          <label className="block text-gray-700 text-sm font-bold mb-2">Service credentials</label>
          <Listbox.Button as={Fragment} aria-required aria-disabled={disabled}>
            <div
              className={clsx(
                'p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800/60 rounded-md text-zinc-800 dark:text-white border border-zinc-300 dark:border-none focus:outline outline-emerald-500',
                disabled && 'cursor-not-allowed opacity-60'
              )}
            >
              {credential?.name || 'Select credentials'}
              <FaChevronDown
                className={clsx(
                  'transition-transform ease duration-300 text-neutral-500',
                  open ? 'rotate-180' : 'rotate-0'
                )}
              />
            </div>
          </Listbox.Button>
          <Listbox.Options>
            <div className="bg-zinc-100 dark:bg-zinc-800/60 p-2 rounded-b-md shadow-2xl backdrop-blur-md absolute z-10 space-y-2 border border-t-0 dark:border-none border-neutral-500/20">
              {filteredCredentials.map((cred: ProviderCredentialsType) => (
                <Listbox.Option key={cred.id} value={cred} as={Fragment}>
                  {({ active, selected }) => (
                    <div
                      className={clsx(
                        'flex items-center gap-2 p-2 cursor-pointer rounded-lg text-black dark:text-white',
                        active && 'bg-zinc-200 dark:bg-zinc-700'
                      )}
                    >
                      <FaKey className="shrink-0" />
                      <div className="flex flex-col gap-2">
                        <span className=" font-semibold">{cred.name}</span>
                      </div>
                    </div>
                  )}
                </Listbox.Option>
              ))}

              <div className="pt-2 border-t border-neutral-500/40">
                <NewCredentialsLink />
              </div>
            </div>
          </Listbox.Options>
        </>
      )}
    </Listbox>
  )
}
