import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import { AgentSettingsForm } from '@/components/agents/AgentSettingsDialog'
import { buttonNamed, settle, type } from './customConnectionTestKit'

jest.mock('@/graphql/mutations/agents/manageAgentSettings.gql', () => ({
  UpdateAgentSettingsOp: 'update-settings',
}))
jest.mock('@/graphql/queries/agents/getAgentSettings.gql', () => ({
  __esModule: true,
  default: Symbol('GetAgentSettings'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}))
jest.mock('@/components/common/GenericDialog', () =>
  jest.requireActual('./customConnectionTestKit').dialogMock()
)
jest.mock('@/components/agents/AgentSelect', () =>
  jest.requireActual('./customConnectionTestKit').selectMock()
)
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const settings = {
  maxRequestDurationSeconds: 86400,
  defaultRequestDurationSeconds: 3600,
  minDurationSeconds: 300,
  maxDurationSeconds: 2592000,
  updatedAt: null,
}

describe('Agent settings', () => {
  let container: HTMLDivElement
  let root: Root
  let update: jest.Mock
  let saved: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    update = jest.fn().mockResolvedValue({ data: {} })
    saved = jest.fn()
    ;(useMutation as jest.Mock).mockReturnValue([update, { loading: false }])
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const render = async () =>
    act(async () =>
      root.render(<AgentSettingsForm organisationId="org-1" settings={settings} onSaved={saved} />)
    )
  const input = (suffix: string) =>
    container.querySelector<HTMLInputElement>(`input[id$="${suffix}"]`)!
  const unit = (suffix: string) =>
    container.querySelector<HTMLSelectElement>(`select[id$="${suffix}"]`)!
  const choose = async (element: HTMLSelectElement, value: string) =>
    act(async () => {
      element.value = value
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
  const saveButton = () => buttonNamed(container, 'Save settings')!
  const submit = async () =>
    act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

  test('starts at the stored limits, in their own units', async () => {
    await render()
    expect(input('-max').value).toBe('1')
    expect(unit('-max-unit').value).toBe('days')
    expect(input('-default').value).toBe('1')
    expect(unit('-default-unit').value).toBe('hours')
    expect(saveButton().disabled).toBe(true)
    expect(container.textContent).toContain('Between 5 minutes and 30 days')
  })

  test('saves both limits in seconds', async () => {
    await render()
    await type(input('-max'), '2')
    await type(input('-default'), '4')
    expect(saveButton().disabled).toBe(false)
    await submit()
    await settle(() => update.mock.calls.length > 0)

    expect(update.mock.calls[0][0].variables).toEqual({
      organisationId: 'org-1',
      maxRequestDurationSeconds: 172800,
      defaultRequestDurationSeconds: 14400,
    })
    expect(saved).toHaveBeenCalled()
  })

  test('refuses a default longer than the maximum', async () => {
    await render()
    await type(input('-default'), '2')
    await choose(unit('-default-unit'), 'days')

    expect(container.textContent).toContain('The default cannot be longer than the maximum')
    expect(saveButton().disabled).toBe(true)
    await submit()
    expect(update).not.toHaveBeenCalled()
  })

  test('holds the maximum to the bounds the server gives', async () => {
    await render()
    await type(input('-max'), '31')
    expect(container.textContent).toContain('The maximum must be 5 minutes to 30 days')
    expect(saveButton().disabled).toBe(true)

    await type(input('-max'), '2')
    await choose(unit('-max-unit'), 'minutes')
    expect(container.textContent).toContain('The maximum must be 5 minutes to 30 days')
    expect(saveButton().disabled).toBe(true)
  })

  test('refuses an empty duration', async () => {
    await render()
    await type(input('-max'), '')
    expect(container.textContent).toContain('Enter a whole number for each duration')
    expect(saveButton().disabled).toBe(true)
  })

  test('says why a save failed and keeps the form', async () => {
    update.mockRejectedValueOnce(new Error('You do not have permission'))
    await render()
    await type(input('-max'), '3')
    await submit()
    await settle(() => container.textContent!.includes('You do not have permission'))
    expect(container.textContent).toContain('You do not have permission')
    expect(input('-max').value).toBe('3')
    expect(saved).not.toHaveBeenCalled()
  })

  describe('when the network settings arrive after the first read', () => {
    const fresh = { ...settings, maxRequestDurationSeconds: 172800 }
    const rerender = async () =>
      act(async () =>
        root.render(<AgentSettingsForm organisationId="org-1" settings={fresh} onSaved={saved} />)
      )

    test('an untouched form starts again from them', async () => {
      await render()
      await rerender()
      expect(input('-max').value).toBe('2')
      expect(unit('-max-unit').value).toBe('days')
      expect(saveButton().disabled).toBe(true)
    })

    test('edits already made are kept', async () => {
      await render()
      await type(input('-default'), '2')
      await rerender()
      expect(input('-default').value).toBe('2')
      expect(input('-max').value).toBe('1')
    })
  })
})
