import { readFileSync } from 'fs'
import { join } from 'path'

const source = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8')

test('AWS custom fields use stable label and input IDs', () => {
  const region = source('components', 'syncing', 'AWS', 'AWSRegionPicker.tsx')
  const setup = source('components', 'syncing', 'AWS', 'SetupAWSAuth.tsx')

  expect(region).toContain('htmlFor={inputId}')
  expect(region).toContain('id={inputId}')
  expect(setup).toContain('htmlFor={externalIdInputId}')
  expect(setup).toContain('id={externalIdInputId}')
})

test('icon-only dialog close controls have accessible names', () => {
  const genericDialog = source('components', 'common', 'GenericDialog.tsx')
  const createDialog = source('components', 'syncing', 'CreateProviderCredentialsDialog.tsx')

  expect(genericDialog).toContain('aria-label={`Close ${title}`}')
  expect(createDialog).toContain('aria-label="Close create service credentials dialog"')
})
