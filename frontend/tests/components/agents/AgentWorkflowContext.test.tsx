import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import { WorkflowContext } from '@/components/agents/AgentWorkflowContext'
import { buttonNamed, settle, type } from './customConnectionTestKit'

jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  SetAgentWorkflowContextOp: 'set-context',
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
}))
jest.mock('@/components/common/GenericDialog', () =>
  jest.requireActual('./customConnectionTestKit').dialogMock()
)
// The one component the context is rendered through, so a test can see it is used.
jest.mock('@/components/agents/HardenedRequestMarkdown', () => ({
  HardenedRequestMarkdown: ({ text }: { text: string }) => <div data-hardened>{text}</div>,
}))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const workflow = (contextMarkdown: string | null, extra = {}) => ({
  id: 'workflow-1',
  name: 'Default',
  contextMarkdown,
  contextUpdatedAt: null,
  contextUpdatedBy: null,
  ...extra,
})

describe('Workflow context', () => {
  let container: HTMLDivElement
  let root: Root
  let save: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    save = jest.fn().mockResolvedValue({ data: {} })
    ;(useMutation as jest.Mock).mockReturnValue([save, { loading: false }])
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const render = async (nextWorkflow: ReturnType<typeof workflow>, canEdit = true) =>
    act(async () => root.render(<WorkflowContext workflow={nextWorkflow} canEdit={canEdit} />))
  const textarea = () =>
    container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow context"]')!
  const saveButton = () => buttonNamed(container, 'Save context')!

  test('empty: one line on what context is for, and Edit', async () => {
    await render(workflow(''))
    expect(container.textContent).toContain('Context is saved notes')
    expect(buttonNamed(container, 'Edit')).toBeDefined()
    expect(container.querySelector('[data-hardened]')).toBeNull()
  })

  test('empty without permission: the line, no Edit', async () => {
    await render(workflow(''), false)
    expect(container.textContent).toContain('Context is saved notes')
    expect(buttonNamed(container, 'Edit')).toBeUndefined()
  })

  test('shows the notes only through the hardened markdown, with who updated them', async () => {
    await render(
      workflow('# Repo\n<img src=x onerror=alert(1)>', {
        contextUpdatedAt: '2026-11-14T09:00:00Z',
        contextUpdatedBy: { id: 'member-1', fullName: 'Rohan Verma', email: 'rohan@example.com' },
      })
    )
    const shown = container.querySelectorAll('[data-hardened]')
    expect(shown).toHaveLength(1)
    expect(shown[0].textContent).toContain('<img src=x onerror=alert(1)>')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('Updated')
    expect(container.textContent).toContain('Rohan Verma')
  })

  test('long notes start collapsed and open on request', async () => {
    await render(workflow('line\n'.repeat(40)))
    const toggle = buttonNamed(container, 'Show all')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await act(async () => toggle.click())
    expect(buttonNamed(container, 'Show less')!.getAttribute('aria-expanded')).toBe('true')
  })

  test('short notes have nothing to expand', async () => {
    await render(workflow('Use the staging repo.'))
    expect(buttonNamed(container, 'Show all')).toBeUndefined()
  })

  test('the editor caps at 16384 characters and counts them', async () => {
    await render(workflow('Use the staging repo.'))

    expect(textarea().maxLength).toBe(16384)
    expect(textarea().value).toBe('Use the staging repo.')
    expect(container.textContent).toContain('21 / 16,384')
    await type(textarea(), 'a'.repeat(16384))
    expect(container.textContent).toContain('16,384 / 16,384')
    expect(saveButton().disabled).toBe(false)
    // Past the cap, as a paste might manage, it cannot be saved.
    await type(textarea(), 'a'.repeat(16385))
    expect(saveButton().disabled).toBe(true)
  })

  test('saves the text, and clearing it saves an empty one', async () => {
    await render(workflow('Use the staging repo.'))
    expect(saveButton().disabled).toBe(true)
    await type(textarea(), 'Use the production repo.')
    await act(async () => saveButton().click())
    await settle(() => save.mock.calls.length > 0)
    expect(save.mock.calls[0][0].variables).toEqual({
      workflowId: 'workflow-1',
      markdown: 'Use the production repo.',
    })

    await type(textarea(), '')
    await act(async () => saveButton().click())
    await settle(() => save.mock.calls.length > 1)
    expect(save.mock.calls[1][0].variables.markdown).toBe('')
  })

  test('says when the server refuses the text', async () => {
    save.mockRejectedValueOnce(
      new Error('The Workflow context must not contain credential-shaped values.')
    )
    await render(workflow(''))
    await type(textarea(), 'token = abc')
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await settle(() => container.textContent!.includes('credential-shaped'))
    expect(container.textContent).toContain('credential-shaped values')
    // What was typed stays, so it can be fixed.
    expect(textarea().value).toBe('token = abc')
  })
})
