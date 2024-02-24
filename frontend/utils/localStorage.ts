// Utils to handle keyrings stored in local storage.

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
  const localKeyring = localKeyrings.find(
    (keyring) => keyring.email === email && keyring.org.id === orgId
  )
  if (localKeyring) return localKeyring as LocalKeyring
  else return undefined
}

/**
 * Encodes a given password in Base64 and stores or updates it along with the member ID
 * in the local storage array 'phaseDevicePasswords'.
 *
 * @param {string} memberId - Organisation member uuid.
 * @param {string} password - The plaintext password to be encoded and stored.
 */
export const setDevicePassword = (memberId: string, password: string): void => {
  // Check if the 'phaseDevicePasswords' exists in localStorage
  const existingPasswords = localStorage.getItem('phaseDevicePasswords')
  const passwordsArray = existingPasswords ? JSON.parse(existingPasswords) : []

  // Base64 encode the password
  const encodedPassword = btoa(password)

  // Find the index of the existing entry with the same memberId
  const index = passwordsArray.findIndex(
    (entry: { memberId: string; password: string }) => entry.memberId === memberId
  )

  if (index !== -1) {
    // If an existing entry is found, update the password
    passwordsArray[index].password = encodedPassword
  } else {
    // If no existing entry is found, add a new entry to the array
    passwordsArray.push({ memberId, password: encodedPassword })
  }

  // Save the updated array back to localStorage
  localStorage.setItem('phaseDevicePasswords', JSON.stringify(passwordsArray))
}

/**
 * Fetches and decodes a Base64-encoded password for a given memberId from
 * the local storage array 'phaseDevicePasswords'. If the memberId is not found,
 * or if there are any issues with retrieval or decoding, `null` is returned.
 *
 * @param {string} memberId - The unique identifier for the member whose password is to be fetched.
 * @returns {string | null} The decoded password if found, otherwise `null`.
 */
export const getDevicePassword = (memberId: string): string | null => {
  // Attempt to retrieve the 'phaseDevicePasswords' from localStorage
  const storedPasswords = localStorage.getItem('phaseDevicePasswords')
  if (!storedPasswords) {
    return null
  }

  // Parse the stored JSON string into an array
  const passwordsArray = JSON.parse(storedPasswords)

  // Find the object with the matching memberId
  const passwordObj = passwordsArray.find(
    (obj: { memberId: string; password: string }) => obj.memberId === memberId
  )

  if (!passwordObj) {
    // If no matching memberId is found, return null
    return null
  }

  // Decode the Base64-encoded password
  const decodedPassword = atob(passwordObj.password)

  return decodedPassword
}

/**
 * Deletes the stored password for a given memberId from the local storage array
 * 'phaseDevicePasswords'. If the memberId is found and the password is successfully
 * deleted, `true` is returned. If the memberId is not found, `false` is returned.
 *
 * @param {string} memberId - The unique identifier for the member whose password is to be deleted.
 * @returns {boolean} `true` if the password was successfully deleted, otherwise `false`.
 */
export const deleteDevicePassword = (memberId: string): boolean => {
  // Attempt to retrieve the 'phaseDevicePasswords' from localStorage
  const storedPasswords = localStorage.getItem('phaseDevicePasswords')
  if (!storedPasswords) {
    return false
  }

  // Parse the stored JSON string into an array
  const passwordsArray = JSON.parse(storedPasswords)

  // Find the index of the object with the matching memberId
  const index = passwordsArray.findIndex(
    (obj: { memberId: string; password: string }) => obj.memberId === memberId
  )

  // If the memberId is found, remove the object from the array
  if (index > -1) {
    passwordsArray.splice(index, 1)

    // Save the updated array back to localStorage
    localStorage.setItem('phaseDevicePasswords', JSON.stringify(passwordsArray))
    return true // Return true to indicate successful deletion
  }

  return false // Return false if the memberId was not found
}
