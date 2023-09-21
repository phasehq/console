import { OrganisationType } from '@/apollo/graphql'

interface LocalOrganisation {
  email: string
  org: OrganisationType
  keyring: string
  recovery?: string
}

export const getLocalOrgs = () => {
  const localData = localStorage.getItem('phase-accounts')
  if (!localData) return undefined
  const orgs = JSON.parse(localData)
  return orgs as LocalOrganisation[]
}

export const setLocalKeyring = (org: LocalOrganisation) => {
  let localOrgs: LocalOrganisation[] = getLocalOrgs() || []
  // Org already exists locally
  if (localOrgs.find((orgData) => orgData.email === org.email)) return
  // Add Org to local storage
  else {
    localOrgs.push(org)
    localStorage.setItem('phase-accounts', JSON.stringify(localOrgs))
  }
}

export const getLocalKeyring = (email: string, orgId: string) => {
  const localOrgs: LocalOrganisation[] | undefined = getLocalOrgs()
  if (!localOrgs) return undefined
  const org = localOrgs.find((org) => org.email === email && org.org.id === orgId)
  if (org) return org.keyring
  else return undefined
}
