import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { ApiSecretTypeChoices, EnvironmentType, SecretType } from '@/apollo/graphql'

// The cell's dialogs load GraphQL documents; none of them opens here
jest.mock('@/components/environments/secrets/HistoryDialog', () => ({ HistoryDialog: () => null }))
jest.mock('@/components/environments/secrets/OverrideDialog', () => ({
  OverrideDialog: () => null,
}))
jest.mock('@/components/environments/secrets/ShareSecretDialog', () => ({
  ShareSecretDialog: () => null,
}))
const mockAutocompleteOptions = jest.fn()
jest.mock('@/hooks/useSecretReferenceAutocomplete', () => ({
  useSecretReferenceAutocomplete: (options: unknown) => {
    mockAutocompleteOptions(options)
    return {
      suggestions: [],
      activeIndex: 0,
      isOpen: false,
      handleChange: () => {},
      handleKeyDown: () => {},
      handleSelect: () => {},
      handleBlur: () => {},
      handleFocus: () => {},
      acceptSuggestion: () => {},
      navigateToSuggestion: () => {},
    }
  },
}))

import { EnvValueCell, EnvValueCellProps } from '@/app/[team]/apps/[app]/_components/EnvValueCell'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const env = { id: 'staging', name: 'Staging' } as EnvironmentType
const saved = (value: string, type = ApiSecretTypeChoices.Secret) =>
  ({
    id: 's1',
    key: 'TOKEN',
    value,
    comment: '',
    tags: [],
    path: '/',
    type,
  }) as unknown as SecretType

describe('EnvValueCell', () => {
  let container: HTMLDivElement
  let root: Root
  const logReads = jest.fn()

  /** The cell with `client` on screen and `server` as its saved copy */
  const cell = (
    client: SecretType | null,
    server: SecretType | null,
    props: Partial<EnvValueCellProps> = {}
  ) => (
    <EnvValueCell
      rowId="row-1"
      entry={{ env, secret: client }}
      serverEntry={{ env, secret: server }}
      rowKey="TOKEN"
      keyIsStagedForDelete={false}
      sameAsProd={null}
      inRotatingGroup={false}
      envRevealed={false}
      revealOnHover={false}
      highlighted={false}
      canUpdateSecrets
      canDeleteSecrets
      canCreateLockbox
      updateValue={() => {}}
      addValue={() => {}}
      deleteValue={() => {}}
      logReads={logReads}
      {...props}
    />
  )
  const render = (...args: Parameters<typeof cell>) => act(async () => root.render(cell(...args)))
  const field = () => container.querySelector('textarea')!
  const masked = () => field().classList.contains('text-security-disc')

  beforeEach(() => {
    logReads.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('tells the reference dropdown which environment and folder the value is in', async () => {
    const inFolder = { ...saved('s3cret'), path: '/Payments' } as SecretType
    await render(inFolder, inFolder)
    expect(mockAutocompleteOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentSecretKey: 'TOKEN', envId: 'staging', path: '/Payments' })
    )
  })

  describe('when a value saved elsewhere arrives', () => {
    it('masks it in a cell that had no value', async () => {
      await render(null, null)
      await render(saved('s3cret'), saved('s3cret'))

      expect(field().value).toBe('s3cret')
      expect(masked()).toBe(true)
      expect(logReads).not.toHaveBeenCalled()
    })

    it('has it masked by the time the browser can paint it', async () => {
      await render(null, null)
      // The first change to the page that puts the value in it, seen as the browser would see
      // it: after the commit, before anything scheduled for later (a passive effect)
      const firstSeen = new Promise<boolean>((resolve) => {
        const observer = new MutationObserver(() => {
          if (!container.querySelector('textarea')?.value) return
          observer.disconnect()
          resolve(masked())
        })
        observer.observe(container, { subtree: true, childList: true, attributes: true })
      })
      // Outside act, which would run every effect before this test could look
      const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
      environment.IS_REACT_ACT_ENVIRONMENT = false
      try {
        root.render(cell(saved('s3cret'), saved('s3cret')))
        expect(await firstSeen).toBe(true)
      } finally {
        environment.IS_REACT_ACT_ENVIRONMENT = true
      }
    })

    it('masks it in a cell whose saved value was blank', async () => {
      await render(saved(''), saved(''))
      expect(masked()).toBe(false)

      await render(saved('s3cret'), saved('s3cret'))
      expect(masked()).toBe(true)
      expect(logReads).not.toHaveBeenCalled()
    })

    it('shows it where the env is revealed, and logs that read', async () => {
      await render(null, null, { envRevealed: true })
      await render(saved('s3cret'), saved('s3cret'), { envRevealed: true })

      expect(masked()).toBe(false)
      expect(logReads).toHaveBeenCalledWith(['s1'])
    })

    it('shows a config value, as a fresh load would', async () => {
      await render(null, null)
      await render(
        saved('info', ApiSecretTypeChoices.Config),
        saved('info', ApiSecretTypeChoices.Config)
      )

      expect(masked()).toBe(false)
    })

    it('leaves an unsaved edit on screen, and masks once the saved value is what shows', async () => {
      await render(saved(''), saved(''))
      await render(saved('typed here'), saved(''))
      await render(saved('typed here'), saved('from a teammate'))
      expect(masked()).toBe(false)

      await render(saved('from a teammate'), saved('from a teammate'))
      expect(masked()).toBe(true)
    })
  })

  describe('when a value typed into a blank cell is deployed', () => {
    it('masks it, as a new value is masked', async () => {
      await render(saved(''), saved(''))
      await render(saved('typed here'), saved(''))
      expect(masked()).toBe(false)

      await render(saved('typed here'), saved('typed here'))
      expect(masked()).toBe(true)
    })

    it('keeps it on screen where the env is revealed, without logging a read of it', async () => {
      await render(saved(''), saved(''), { envRevealed: true })
      await render(saved('typed here'), saved(''), { envRevealed: true })
      await render(saved('typed here'), saved('typed here'), { envRevealed: true })

      expect(masked()).toBe(false)
      expect(logReads).not.toHaveBeenCalled()
    })
  })
})
