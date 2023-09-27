import { OrganisationType } from '@/apollo/graphql'

interface LocalKeyring {
  email: string
  org: OrganisationType
  keyring: string
  recovery?: string
}

export const getLocalKeyrings = () => {
  const localData = localStorage.getItem('phase-accounts')
  if (!localData) return undefined
  const orgs = JSON.parse(localData)
  return orgs as LocalKeyring[]
}

export const setLocalKeyring = (keyringData: LocalKeyring) => {
  let localKeyrings: LocalKeyring[] = getLocalKeyrings() || []

  const existingKeyringIndex = localKeyrings.findIndex(
    (orgData) => orgData.email === keyringData.email && orgData.org.id === keyringData.org.id
  )

  // Keyring for this org and user already exists locally, remove it
  if (existingKeyringIndex !== -1) {
    localKeyrings.splice(existingKeyringIndex, 1) // Remove the object from the array
  }

  // Add Keyring to local storage
  else {
    localKeyrings.push(keyringData)
    localStorage.setItem('phase-accounts', JSON.stringify(localKeyrings))
  }
}

export const getLocalKeyring = (email: string, orgId: string) => {
  const localKeyrings: LocalKeyring[] | undefined = getLocalKeyrings()
  if (!localKeyrings) return undefined
  const org = localKeyrings.find((keyring) => keyring.email === email && keyring.org.id === orgId)
  if (org) return org.keyring
  else return undefined
}
