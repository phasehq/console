import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import { CreateAgentDialog } from '@/components/agents/AgentDialogs'
import { CreateAgentOp, MintAgentTokenOp } from '@/graphql/mutations/agents/manageAgents.gql'
import { generateAgentName } from '@/utils/agents/names'
import { GetOrganisationPlan } from '@/graphql/queries/organisation/getOrganisationPlan.gql'

jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  CreateAgentOp: Symbol('CreateAgentOp'),
  MintAgentTokenOp: Symbol('MintAgentTokenOp'),
}))

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({}))

jest.mock('@/graphql/queries/organisation/getOrganisationPlan.gql', () => ({
  GetOrganisationPlan: Symbol('GetOrganisationPlan'),
}))

jest.mock('@/contexts/organisationContext', () => ({
  organisationContext: jest
    .requireActual<typeof import('react')>('react')
    .createContext({ activeOrganisation: undefined }),
}))

jest.mock('@/components/settings/organisation/UpsellDialog', () => ({
  UpsellDialog: ({ buttonLabel }: { buttonLabel?: React.ReactNode }) => (
    <button type="button" data-testid="upsell">
      {buttonLabel}
    </button>
  ),
}))

jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useApolloClient: jest.fn(),
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
  let refetchQueries: jest.Mock

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
    refetchQueries = jest.fn().mockResolvedValue(undefined)
    ;(useApolloClient as jest.Mock).mockReturnValue({ refetchQueries })
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
    // Only the plan is queried, to check the Agent limit.
    expect(
      (useQuery as jest.Mock).mock.calls.every(([document]) => document === GetOrganisationPlan)
    ).toBe(true)
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

    // The inventory refresh waits until the reveal is dismissed: refetching
    // earlier swaps the page out of its empty state and unmounts the dialog
    // with the one-time token still unread.
    expect(refetchQueries).not.toHaveBeenCalled()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click()
    })
    expect(refetchQueries).toHaveBeenCalledTimes(1)
    expect(refetchQueries).toHaveBeenCalledWith({
      include: ['GetAgents', 'GetAgentMesh', 'GetOrganisationPlan'],
    })
    expect(container.querySelector('form')).not.toBeNull()
  })

  test('does not refresh the inventory when a draft is dismissed before creation', async () => {
    await act(async () => {
      root.render(<CreateAgentDialog organisationId="org-1" />)
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click()
    })
    expect(refetchQueries).not.toHaveBeenCalled()
  })

  test('offers an upgrade instead of the form once the plan limit is reached', async () => {
    ;(useQuery as jest.Mock).mockReturnValue({
      data: { organisationPlan: { maxAgents: 3, agentCount: 3 } },
      loading: false,
    })

    await act(async () => {
      root.render(<CreateAgentDialog organisationId="org-1" />)
    })

    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('[data-testid="upsell"]')?.textContent).toContain('Create Agent')
  })

  test('shows the form below the limit and when the plan has none', async () => {
    for (const organisationPlan of [
      { maxAgents: 3, agentCount: 2 },
      { maxAgents: null, agentCount: 40 },
    ]) {
      ;(useQuery as jest.Mock).mockReturnValue({ data: { organisationPlan }, loading: false })
      await act(async () => {
        root.render(
          <CreateAgentDialog key={String(organisationPlan.maxAgents)} organisationId="org-1" />
        )
      })
      expect(container.querySelector('form')).not.toBeNull()
      expect(container.querySelector('[data-testid="upsell"]')).toBeNull()
    }
  })

  test('keeps the one-time token on screen when the new Agent used the last slot', async () => {
    ;(useQuery as jest.Mock).mockReturnValue({
      data: { organisationPlan: { maxAgents: 3, agentCount: 2 } },
      loading: false,
    })
    await act(async () => {
      root.render(<CreateAgentDialog organisationId="org-1" />)
    })
    const claudeCode = Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]')).find(
      (option) => option.textContent?.includes('Claude Code')
    )!
    await act(async () => claudeCode.click())
    await act(async () => {
      container.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    ;(useQuery as jest.Mock).mockReturnValue({
      data: { organisationPlan: { maxAgents: 3, agentCount: 3 } },
      loading: false,
    })
    await act(async () => {
      root.render(<CreateAgentDialog organisationId="org-1" />)
    })

    expect(container.textContent).toContain('pss_agent:test')
    expect(container.querySelector('[data-testid="upsell"]')).toBeNull()
  })
})
