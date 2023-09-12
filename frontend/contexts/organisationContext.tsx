import { OrganisationType } from '@/apollo/graphql'
import { createContext, useEffect, useState } from 'react'
import GetOrganisations from '@/graphql/queries/getOrganisations.gql'
import { useQuery } from '@apollo/client'

interface OrganisationContextValue {
  activeOrganisation: OrganisationType | null
  organisations: OrganisationType[]
  setOrganisation: (organisation: OrganisationType) => void
}

export const organisationContext = createContext<OrganisationContextValue>({
  activeOrganisation: null,
  organisations: [],
  setOrganisation: () => {},
})

interface OrganisationProviderProps {
  children: React.ReactNode
}

export const OrganisationProvider: React.FC<OrganisationProviderProps> = ({ children }) => {
  const { data: orgsData } = useQuery(GetOrganisations)

  const [organisation, setOrganisation] = useState<OrganisationType | null>(null)

  useEffect(() => {
    if (organisation === null && orgsData) {
      setOrganisation(orgsData.organisations[0])
    }
  }, [organisation, orgsData])

  return (
    <organisationContext.Provider
      value={{
        activeOrganisation: organisation,
        organisations: orgsData?.organisations ?? [],
        setOrganisation,
      }}
    >
      {children}
    </organisationContext.Provider>
  )
}
