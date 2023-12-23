import { ProviderCredentialsType } from '@/apollo/graphql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import { useQuery } from '@apollo/client'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment } from 'react'
import { FaChevronDown, FaKey } from 'react-icons/fa'

export const ProviderCredentialPicker = (props: {
  credential: ProviderCredentialsType | null
  setCredential: (credential: ProviderCredentialsType) => void
  orgId: string
}) => {
  const { credential, setCredential, orgId } = props

  const { data: credentialsData } = useQuery(GetSavedCredentials, {
    variables: { orgId },
  })

  const credentials: ProviderCredentialsType[] = credentialsData?.savedCredentials ?? []

  return (
    <Listbox value={credential} onChange={setCredential}>
      {({ open }) => (
        <>
          <label className="block text-gray-700 text-sm font-bold mb-2">Authentication</label>
          <Listbox.Button as={Fragment} aria-required>
            <div className="p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 dark:bg-opacity-60 rounded-md text-zinc-800 dark:text-white border border-zinc-300 dark:border-none focus:outline outline-emerald-500">
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
            <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10 w-full">
              {credentials.map((cred: ProviderCredentialsType) => (
                <Listbox.Option key={cred.id} value={cred} as={Fragment}>
                  {({ active, selected }) => (
                    <div
                      className={clsx(
                        'flex items-center gap-2 p-2 cursor-pointer rounded-full',
                        active && 'bg-zinc-400 dark:bg-zinc-700'
                      )}
                    >
                      <FaKey className="shrink-0" />
                      <div className="flex flex-col gap-2">
                        <span className="text-black dark:text-white font-semibold">
                          {cred.name}
                        </span>
                      </div>
                    </div>
                  )}
                </Listbox.Option>
              ))}
            </div>
          </Listbox.Options>
        </>
      )}
    </Listbox>
  )
}