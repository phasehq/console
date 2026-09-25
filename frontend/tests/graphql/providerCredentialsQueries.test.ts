import { readFileSync } from 'fs'
import { join } from 'path'

const query = (name: string) =>
  readFileSync(join(process.cwd(), 'graphql', 'queries', 'syncing', name), 'utf8')

test('the credential inventory query never requests secret material', () => {
  const inventory = query('getSavedCredentials.gql')

  expect(inventory).toContain('savedCredentials')
  expect(inventory).not.toMatch(/^\s+credentials\s*$/m)
})

test('credential secret material is requested only by the single-record detail query', () => {
  const detail = query('getSavedCredential.gql')

  expect(detail).toContain('providerCredential(credentialId: $credentialId)')
  expect(detail).toMatch(/^\s+credentials\s*$/m)
})
