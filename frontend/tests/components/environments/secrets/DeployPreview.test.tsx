import { act, useRef } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { ApiSecretTypeChoices, SecretType } from '@/apollo/graphql'
import {
  ChangesDiff,
  ChangeSource,
  DeployPreviewDialog,
  DeployPreviewHandle,
  useSecretChanges,
} from '@/components/environments/secrets/DeployPreview'
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

/** The changes as the editor works them out, opened from a button showing their count */
const Preview = (props: ChangeSource) => {
  const changes = useSecretChanges(props)
  const previewRef = useRef<DeployPreviewHandle>(null)
  return (
    <>
      <button type="button" onClick={() => previewRef.current?.open()}>
        {changes.changes.length} undeployed
      </button>
      <DeployPreviewDialog ref={previewRef} changes={changes} />
    </>
  )
}

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
        <Preview serverSecrets={serverSecrets} clientSecrets={clientSecrets} secretsToDelete={[]} />
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

    expect(container.textContent).toContain('1 undeployed')

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

    expect(container.textContent).toContain('1 undeployed')

    const preview = await openPreview()
    expect(preview).toContain('TypeSecretSealed')
    expect(preview).toContain('Valuehttps://api.example.comhttps://api2.example.com')
  })

  it('shows a value change on a saved sealed secret without a type change', async () => {
    // Sealed values are never sent to the client, so the server copy holds an empty value
    const original = makeSecret({ type: ApiSecretTypeChoices.Sealed, value: '' })

    await renderPreview([original], [{ ...original, value: 'rotated' }])

    expect(container.textContent).toContain('1 undeployed')

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
        <Preview
          serverSecrets={[prodSecret, devSecret]}
          clientSecrets={[{ ...prodSecret, value: 'changed' }, devSecret, devNew]}
          secretsToDelete={['d1']}
          showEnvironment
        />
      )
    })

    expect(container.textContent).toContain('3 undeployed')
    const preview = await openPreview()
    expect(preview).toContain('3 changes across 2 environments')
    // Development first, its changes created → deleted; then Production
    expect(preview).toMatch(/Development2 changes.*CreatedNEW_KEY.*DeletedAPI_URL.*Production1 change.*UpdatedAPI_URL/)
  })

  describe('across several environments', () => {
    const envs = [
      { id: 'dev', name: 'Development', index: 0 },
      { id: 'stg', name: 'Staging', index: 1 },
      { id: 'prod', name: 'Production', index: 2 },
    ]
    const inEachEnv = (key: string, values: string[]) =>
      envs.map((environment, i) =>
        makeSecret({ id: `${key}-${environment.id}`, key, value: values[i], environment } as Partial<SecretType>)
      )
    const tab = (name: string) =>
      [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent?.includes(name))

    it('offers a By key tab once keys repeat across envs, reading a shared change once', async () => {
      const server = [
        ...inEachEnv('LOG_LEVEL', ['info', 'info', 'warn']),
        ...inEachEnv('REGION', ['eu', 'eu', 'eu']),
        ...inEachEnv('OLD_TOKEN', ['a', 'b', 'c']),
      ]
      const client = [
        ...inEachEnv('LOG_LEVEL', ['debug', 'debug', 'info']),
        ...inEachEnv('REGION', ['us', 'us', 'us']),
        ...inEachEnv('OLD_TOKEN', ['a', 'b', 'c']),
      ]
      await act(async () => {
        root.render(
          <Preview
            serverSecrets={server}
            clientSecrets={client}
            secretsToDelete={['OLD_TOKEN-dev', 'OLD_TOKEN-stg', 'OLD_TOKEN-prod']}
            showEnvironment
          />
        )
      })
      await openPreview()
      expect(tab('By environment')?.textContent).toContain('3')
      expect(tab('By key')?.textContent).toContain('3')

      await act(async () => {
        ;(tab('By key') as HTMLElement).click()
      })
      // The unselected panel leaves an empty placeholder behind
      const byKey = [...document.querySelectorAll('[role="tabpanel"]')]
        .map((panel) => panel.textContent)
        .join('')
      // Each key once: the same change with every env it's made in, differing ones side by side
      expect(byKey).toMatch(/UpdatedREGION3 environmentsDevelopmentStagingProductionValueeuus/)
      expect(byKey).toMatch(/UpdatedLOG_LEVEL3 environmentsDevelopmentStagingValueinfodebugProductionValuewarninfo/)
      expect(byKey).toMatch(/DeletedOLD_TOKEN3 environmentsDevelopmentStagingProduction/)
      expect(byKey.match(/REGION/g)).toHaveLength(1)
    })

    it('can open with every env but the first folded to its name and count', async () => {
      const server = inEachEnv('LOG_LEVEL', ['info', 'info', 'warn'])
      const client = inEachEnv('LOG_LEVEL', ['debug', 'trace', 'error'])
      const Folded = (props: ChangeSource) => (
        <ChangesDiff changes={useSecretChanges(props)} startCollapsed />
      )
      await act(async () => {
        root.render(
          <Folded serverSecrets={server} clientSecrets={client} secretsToDelete={[]} showEnvironment />
        )
      })
      const headers = () => [...container.querySelectorAll('button[aria-expanded]')]
      expect(headers().map((header) => header.getAttribute('aria-expanded'))).toEqual([
        'true',
        'false',
        'false',
      ])
      expect(container.textContent).toContain('Valueinfodebug')
      expect(container.textContent).not.toContain('trace')
      // A folded env says no more than its name and how many changes it has
      expect(container.querySelectorAll('section')[1].textContent).toBe('Staging1 change')

      await act(async () => {
        ;(headers()[1] as HTMLElement).click()
      })
      expect(container.textContent).toContain('Valueinfotrace')
    })

    it('offers no By key tab while each key changes in an env or two', async () => {
      const server = ['A', 'B', 'C', 'D'].flatMap((key) => inEachEnv(key, ['1', '1', '1']).slice(0, 2))
      const client = server.map((secret) => ({ ...secret, value: '2' }))
      await act(async () => {
        root.render(
          <Preview serverSecrets={server} clientSecrets={client} secretsToDelete={[]} showEnvironment />
        )
      })
      const preview = await openPreview()
      expect(preview).toContain('8 changes across 2 environments')
      expect(document.querySelector('[role="tab"]')).toBeNull()
    })
  })
})
