import { OrganisationType } from '@/apollo/graphql'
import { createContext, useEffect, useState } from 'react'
import GetOrganisations from '@/graphql/queries/getOrganisations.gql'
import UpdateWrappedSecrets from '@/graphql/mutations/organisation/updateUserWrappedSecrets.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useSession } from 'next-auth/react'
import { getLocalKeyring } from '@/utils/localStorage'
import posthog from 'posthog-js'

interface OrganisationContextValue {
  activeOrganisation: OrganisationType | null
  organisations: OrganisationType[] | null
  setActiveOrganisation: (organisation: OrganisationType) => void
  loading: boolean
}

export const organisationContext = createContext<OrganisationContextValue>({
  activeOrganisation: null,
  organisations: null,
  setActiveOrganisation: () => {},
  loading: true,
})

interface OrganisationProviderProps {
  children: React.ReactNode
}

export const OrganisationProvider: React.FC<OrganisationProviderProps> = ({ children }) => {
  const [getOrgs, { data: orgsData, loading: queryLoading }] = useLazyQuery(GetOrganisations)

  const [updateWrappedSecrets] = useMutation(UpdateWrappedSecrets)

  const { data: session } = useSession()

  const [organisation, setOrganisation] = useState<OrganisationType | null>(null)

  const [loading, setLoading] = useState<boolean>(true)

  const { organisations } = orgsData ?? { organisations: null }

  useEffect(() => {
    if (session && organisation) {
      if (session.user?.email)
        posthog.identify(organisation.memberId!, {
          email: session.user.email,
          name: session.user.name,
          organisation: organisation.name,
        })
    } else posthog.reset()
  }, [organisation, session])

  useEffect(() => {
    if (session?.user?.email) getOrgs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  useEffect(() => {
    if (organisation === null && orgsData) {
      if (orgsData.organisations.length === 1) setOrganisation(orgsData.organisations[0])

      orgsData.organisations.forEach((org: OrganisationType) => {
        // This exists to grandfather legacy accounts that relied exclusively on localstorage for encrypted keyrings to the new spec
        // Update wrapped secrets on the backend if they are blank
        if (org.keyring === '' || org.recovery === '') {
          const localKeyring = getLocalKeyring(session?.user?.email!, org.id)

          if (localKeyring?.keyring && localKeyring?.recovery) {
            updateWrappedSecrets({
              variables: {
                orgId: org.id,
                wrappedKeyring: localKeyring.keyring,
                wrappedRecovery: localKeyring.recovery,
              },
            })
          }
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisation, orgsData])

  useEffect(() => {
    setLoading(queryLoading)
  }, [queryLoading])

  return (
    <organisationContext.Provider
      value={{
        activeOrganisation: organisation,
        organisations,
        setActiveOrganisation: setOrganisation,
        loading,
      }}
    >
      {children}
    </organisationContext.Provider>
  )
}
