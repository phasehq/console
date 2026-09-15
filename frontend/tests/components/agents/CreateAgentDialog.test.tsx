import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import { CreateAgentDialog } from '@/components/agents/AgentDialogs'
import { CreateAgentOp, MintAgentTokenOp } from '@/graphql/mutations/agents/manageAgents.gql'
import { generateAgentName } from '@/utils/agents/names'

jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  CreateAgentOp: Symbol('CreateAgentOp'),
  MintAgentTokenOp: Symbol('MintAgentTokenOp'),
}))

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({}))

jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}))

jest.mock('@/utils/agents/names', () => ({
  generateAgentName: jest.fn(() => 'amber-cobalt-forest'),
}))

jest.mock('react-toastify', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}))

jest.mock('@/components/common/GenericDialog', () => {
  const ReactModule = jest.requireActual<typeof React>('react')

  return {
    __esModule: true,
    default: ReactModule.forwardRef(function MockGenericDialog(
      {
        children,
        title,
        dialogTitle,
        buttonContent,
        onClose,
      }: {
        children: React.ReactNode
        title: string
        dialogTitle?: React.ReactNode
        buttonContent?: React.ReactNode
        onClose?: () => void
      },
      ref: React.ForwardedRef<{ closeModal: () => void }>
    ) {
      ReactModule.useImperativeHandle(ref, () => ({ closeModal: jest.fn() }))
      return (
        <div>
          {buttonContent ? <button type="button">{buttonContent}</button> : null}
          {dialogTitle || <h2>{title}</h2>}
          <button type="button" aria-label="Close dialog" onClick={onClose}>
            Close
          </button>
          {children}
        </div>
      )
    }),
  }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('CreateAgentDialog', () => {
  let container: HTMLDivElement
  let root: Root
  let createAgent: jest.Mock
  let mintInitialToken: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    createAgent = jest.fn().mockResolvedValue({
      data: {
        createAgent: {
          agent: { id: 'agent-1', name: 'release-assistant' },
          defaultWorkflow: { id: 'workflow-1', name: 'Default' },
        },
      },
    })
    mintInitialToken = jest.fn().mockResolvedValue({
      data: { mintAgentToken: { minted: { fullToken: 'pss_agent:test' } } },
    })
    ;(useMutation as jest.Mock).mockImplementation((document) => {
      if (document === CreateAgentOp) return [createAgent, { loading: false }]
      if (document === MintAgentTokenOp) return [mintInitialToken, { loading: false }]
      throw new Error('Unexpected mutation in CreateAgentDialog test')
    })
    ;(useQuery as jest.Mock).mockReturnValue({ data: undefined, loading: false })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  test('prefills an editable name and keeps ownership and workflow setup hidden', async () => {
    await act(async () => {
      root.render(<CreateAgentDialog organisationId="org-1" />)
    })

    const form = container.querySelector('form')!
    expect(form.textContent).toContain('Harness')
    expect(form.textContent).toContain('Name')
    expect(form.textContent).not.toContain('Team')
    expect(form.textContent).not.toContain('First workflow')
    expect(form.querySelector<HTMLInputElement>('#agent-name')?.value).toBe('amber-cobalt-forest')
    expect(form.querySelector('#agent-team')).toBeNull()
    expect(form.querySelector('#workflow-name')).toBeNull()
    expect(
      form.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent?.trim()
    ).toBe('Create')
    expect(useQuery).not.toHaveBeenCalled()
  })

  test('preserves an unfinished draft when dismissed', async () => {
    await act(async () => {
      root.render(<CreateAgentDialog organisationId="org-1" />)
    })

    const name = container.querySelector<HTMLInputElement>('#agent-name')!
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )!.set!
    await act(async () => {
      setValue.call(name, 'my-agent-draft')
      name.dispatchEvent(new Event('input', { bubbles: true }))
      container.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click()
    })

    expect(container.querySelector<HTMLInputElement>('#agent-name')?.value).toBe('my-agent-draft')
    expect(generateAgentName).toHaveBeenCalledTimes(1)
  })

  test('creates an organisation-owned Agent with the edited name and Default workflow', async () => {
    await act(async () => {
      root.render(<CreateAgentDialog organisationId="org-1" />)
    })

    const name = container.querySelector<HTMLInputElement>('#agent-name')!
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )!.set!
    await act(async () => {
      setValue.call(name, 'release-assistant')
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const claudeCode = Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]')).find(
      (option) => option.textContent?.includes('Claude Code')
    )!
    await act(async () => claudeCode.click())

    expect(container.querySelector('[aria-label="Claude Code harness"]')).not.toBeNull()

    const submit = container.querySelector<HTMLButtonElement>('form button[type="submit"]')!
    await act(async () => {
      submit.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(generateAgentName).toHaveBeenCalledTimes(1)
    expect(createAgent).toHaveBeenCalledWith({
      variables: {
        organisationId: 'org-1',
        name: 'release-assistant',
        defaultWorkflowName: 'Default',
        harnessType: 'claude_code',
      },
      refetchQueries: ['GetAgents', 'GetAgentMesh'],
      awaitRefetchQueries: true,
    })
    expect(mintInitialToken).toHaveBeenCalledWith({
      variables: {
        agentId: 'agent-1',
        workflowId: 'workflow-1',
        name: 'Initial setup',
        expiresAt: null,
      },
      refetchQueries: ['GetAgentDetail'],
    })
    expect(container.textContent).toContain(
      "Agent identity for release-assistant's Default workflow"
    )
    expect(container.textContent).not.toContain('and its Default workflow are ready')
    expect(container.textContent).toContain("Don't share with AI")
    expect(container.textContent).toContain('Initial setup')
    expect(container.textContent).toContain('phase auth --mode token')
    expect(container.textContent).toContain("Don't paste it into your AI chat")
    expect(container.textContent).toContain('Install the Phase skill for Claude Code')
    expect(container.textContent).toContain('phase ai enable --harness claude-code')
    expect(
      container.querySelector<HTMLButtonElement>('button[title="Copy authentication command"]')
    ).not.toBeNull()
    const command = Array.from(container.querySelectorAll('code')).find(
      (element) => element.textContent === 'phase auth --mode token'
    )!
    const token = Array.from(container.querySelectorAll('code')).find(
      (element) => element.textContent === 'pss_agent:test'
    )!
    const enable = Array.from(container.querySelectorAll('code')).find(
      (element) => element.textContent === 'phase ai enable --harness claude-code'
    )!
    expect(command.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(token.compareDocumentPosition(enable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
