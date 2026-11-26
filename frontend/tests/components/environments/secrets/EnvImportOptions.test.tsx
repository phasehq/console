import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import {
  EnvImportOptions,
  secretsForEnvs,
  useImportChoices,
} from '@/components/environments/secrets/import/EnvImportOptions'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// Parsing a .env file gives each secret an id; jsdom has no crypto.randomUUID
const originalCrypto = globalThis.crypto
let lastId = 0
beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `id-${(lastId += 1)}` },
    configurable: true,
  })
})
afterAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
})

const ENVS = [
  { id: 'dev', name: 'Development', color: '#22c55e' },
  { id: 'stg', name: 'Staging', color: '#eab308' },
  { id: 'prd', name: 'Production', color: '#ef4444' },
]
const FILE = '# Where payments go\nAPI_URL=https://api.example.test\nRETRIES=3 # be patient'

describe('secretsForEnvs', () => {
  const values = (secrets: { key: string; value: string; comment: string }[]) =>
    secrets.map(({ key, value, comment }) => [key, value, comment])

  it("gives each chosen environment the file's keys, with the values and comments it takes", () => {
    const result = secretsForEnvs(FILE, ENVS, ['prd', 'dev'], {
      dev: { withValues: true, withComments: false },
      prd: { withValues: false, withComments: true },
    })

    // In the environments' order, not the order they were chosen in
    expect(result.map(({ env }) => env.id)).toEqual(['dev', 'prd'])
    expect(values(result[0].secrets)).toEqual([
      ['API_URL', 'https://api.example.test', ''],
      ['RETRIES', '3', ''],
    ])
    expect(values(result[1].secrets)).toEqual([
      ['API_URL', '', 'Where payments go'],
      ['RETRIES', '', 'be patient'],
    ])
  })

  it('puts the secrets at the path given', () => {
    const [{ secrets }] = secretsForEnvs(FILE, ENVS, ['dev'], {}, '/backend')
    expect(secrets.every((secret) => secret.path === '/backend')).toBe(true)
  })

  it('refuses a file with a key twice', () => {
    expect(() => secretsForEnvs('A=1\na=2', ENVS, ['dev'], {})).toThrow(
      'File contains duplicate keys!'
    )
  })
})

describe('useImportChoices and EnvImportOptions', () => {
  let container: HTMLDivElement
  let root: Root
  let choices: ReturnType<typeof useImportChoices>

  const Harness = ({ envIds }: { envIds: string[] }) => {
    choices = useImportChoices(envIds)
    return (
      <EnvImportOptions
        environments={ENVS.filter((env) => envIds.includes(env.id))}
        selectedIds={choices.selectedIds}
        configs={choices.configs}
        onToggleEnv={choices.toggleEnv}
        onChangeConfig={choices.setConfig}
      />
    )
  }
  const render = (envIds: string[]) => act(async () => root.render(<Harness envIds={envIds} />))
  /** Per row: whether it takes the file, its values, its comments */
  const switches = () =>
    Array.from(container.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('[role="switch"]')).map((s) => s.getAttribute('aria-checked'))
    )
  const switchAt = (row: number, column: number) =>
    container
      .querySelectorAll('tbody tr')
      [row].querySelectorAll<HTMLButtonElement>('[role="switch"]')[column]

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('starts with every environment, values and comments in the first, keys alone in the rest', async () => {
    await render(['dev', 'stg', 'prd'])
    expect(switches()).toEqual([
      ['true', 'true', 'true'],
      ['true', 'false', 'false'],
      ['true', 'false', 'false'],
    ])
  })

  it("shows each environment's colour, faded while it's left out", async () => {
    await render(['dev', 'stg', 'prd'])
    const dots = () => Array.from(container.querySelectorAll<SVGElement>('tbody svg'))
    expect(dots().map((dot) => dot.style.color)).toEqual([
      'rgb(34, 197, 94)',
      'rgb(234, 179, 8)',
      'rgb(239, 68, 68)',
    ])

    await act(async () => switchAt(1, 0).click())
    expect(dots()[1].getAttribute('class')).toContain('opacity-50')
    expect(dots()[0].getAttribute('class')).not.toContain('opacity-50')
  })

  it('takes nothing from an environment left out, even once it is put back', async () => {
    await render(['dev', 'stg', 'prd'])
    await act(async () => switchAt(0, 0).click())
    expect(choices.selectedIds).toEqual(['stg', 'prd'])
    expect(switches()[0]).toEqual(['false', 'false', 'false'])
    // What it takes can't be changed while it's left out
    expect(switchAt(0, 1).disabled).toBe(true)

    await act(async () => switchAt(0, 0).click())
    expect(switches()[0]).toEqual(['true', 'false', 'false'])
  })

  it('starts over when the environments change, not when the same ones come again', async () => {
    await render(['dev', 'stg', 'prd'])
    await act(async () => switchAt(2, 1).click())
    expect(choices.configs.prd.withValues).toBe(true)

    // The same environments, as a refresh would hand them over
    await render(['dev', 'stg', 'prd'])
    expect(choices.configs.prd.withValues).toBe(true)

    await render(['stg', 'prd'])
    expect(choices.selectedIds).toEqual(['stg', 'prd'])
    expect(choices.configs).toEqual({
      stg: { withValues: true, withComments: true },
      prd: { withValues: false, withComments: false },
    })
  })
})
