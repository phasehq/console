import { OrganisationType } from '@/apollo/graphql'
import { createContext, useEffect, useState } from 'react'
import GetOrganisations from '@/graphql/queries/getOrganisations.gql'
import { useLazyQuery, useQuery } from '@apollo/client'
import { useSession } from 'next-auth/react'

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

  const { data: session } = useSession()

  const [organisation, setOrganisation] = useState<OrganisationType | null>(null)
  const [organisations, setOrganisations] = useState<OrganisationType[] | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    if (session?.user?.email) getOrgs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  useEffect(() => {
    if (organisation === null && orgsData?.organisations.length > 0) {
      setOrganisations(orgsData.organisations)
      setOrganisation(orgsData.organisations[0])
    }
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
