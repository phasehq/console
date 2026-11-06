import { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { ApiSecretTypeChoices, SecretType } from '@/apollo/graphql'
import { DeployPreview } from '@/components/environments/secrets/DeployPreview'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const makeSecret = (overrides: Partial<SecretType>): SecretType =>
  ({
    id: 'secret-1',
    key: 'API_URL',
    value: 'https://api.example.com',
    comment: '',
    tags: [],
    path: '/',
    type: ApiSecretTypeChoices.Secret,
    version: 1,
    updatedAt: null,
    ...overrides,
  }) as SecretType

describe('DeployPreview', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  const renderPreview = async (serverSecrets: SecretType[], clientSecrets: SecretType[]) => {
    await act(async () => {
      root.render(
        <DeployPreview
          serverSecrets={serverSecrets}
          clientSecrets={clientSecrets}
          secretsToDelete={[]}
        />
      )
    })
  }

  const openPreview = async () => {
    await act(async () => {
      container.querySelector('button')!.click()
    })
    return document.body.textContent ?? ''
  }

  it('counts and lists a type-only change', async () => {
    const unchanged = makeSecret({ id: 'secret-2', key: 'LOG_LEVEL', value: 'info' })
    const original = makeSecret({})

    await renderPreview(
      [original, unchanged],
      [{ ...original, type: ApiSecretTypeChoices.Config }, unchanged]
    )

    expect(container.textContent).toContain('1 undeployed change.')

    const preview = await openPreview()
    expect(preview).toContain('UpdatedAPI_URL')
    expect(preview).toContain('TypeSecretConfig')
    expect(preview).not.toContain('Value')
    expect(preview).not.toContain('LOG_LEVEL')
  })

  it('lists the type alongside a value change on the same secret', async () => {
    const original = makeSecret({})

    await renderPreview(
      [original],
      [{ ...original, type: ApiSecretTypeChoices.Sealed, value: 'https://api2.example.com' }]
    )

    expect(container.textContent).toContain('1 undeployed change.')

    const preview = await openPreview()
    expect(preview).toContain('TypeSecretSealed')
    expect(preview).toContain('Valuehttps://api.example.comhttps://api2.example.com')
  })

  it('shows a value change on a saved sealed secret without a type change', async () => {
    // Sealed values are never sent to the client, so the server copy holds an empty value
    const original = makeSecret({ type: ApiSecretTypeChoices.Sealed, value: '' })

    await renderPreview([original], [{ ...original, value: 'rotated' }])

    expect(container.textContent).toContain('1 undeployed change.')

    const preview = await openPreview()
    // The old sealed value is unknown, so only the new one shows (never "empty")
    expect(preview).toContain('Valuerotated')
    expect(preview).not.toContain('Type')
  })

  it('groups changes by environment, in env order, when asked to', async () => {
    const dev = { id: 'dev', name: 'Development', index: 0, color: '#10b981' }
    const prod = { id: 'prod', name: 'Production', index: 2, color: '#f59e0b' }
    const prodSecret = makeSecret({ id: 'p1', environment: prod } as Partial<SecretType>)
    const devSecret = makeSecret({ id: 'd1', environment: dev } as Partial<SecretType>)
    const devNew = makeSecret({ id: 'd2', key: 'NEW_KEY', value: 'v', environment: dev } as Partial<SecretType>)

    await act(async () => {
      root.render(
        <DeployPreview
          serverSecrets={[prodSecret, devSecret]}
          clientSecrets={[{ ...prodSecret, value: 'changed' }, devSecret, devNew]}
          secretsToDelete={['d1']}
          showEnvironment
        />
      )
    })

    expect(container.textContent).toContain('3 undeployed changes.')
    const preview = await openPreview()
    expect(preview).toContain('3 changes across 2 environments')
    // Development first, its changes created → deleted; then Production
    expect(preview).toMatch(/Development2 changes.*CreatedNEW_KEY.*DeletedAPI_URL.*Production1 change.*UpdatedAPI_URL/)
  })
})
