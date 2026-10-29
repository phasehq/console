import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import { CreateWorkflowDialog } from '@/components/agents/AgentDialogs'
import { organisationContext } from '@/contexts/organisationContext'

jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  CreateAgentWorkflowOp: Symbol('CreateAgentWorkflowOp'),
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

jest.mock('react-toastify', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}))

jest.mock('@/components/common/GenericDialog', () => {
  const ReactModule = jest.requireActual<typeof React>('react')

  return {
    __esModule: true,
    default: ReactModule.forwardRef(function MockGenericDialog(
      { children, buttonContent }: { children: React.ReactNode; buttonContent?: React.ReactNode },
      ref: React.ForwardedRef<{ closeModal: () => void }>
    ) {
      ReactModule.useImperativeHandle(ref, () => ({ closeModal: jest.fn() }))
      return (
        <div>
          <button type="button" data-testid="create">
            {buttonContent}
          </button>
          {children}
        </div>
      )
    }),
  }
})

describe('CreateWorkflowDialog', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(useMutation as jest.Mock).mockReturnValue([jest.fn(), { loading: false }])
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const render = async (
    plan: string,
    maxWorkflowsPerAgent: number | null,
    workflowCount: number
  ) => {
    await act(async () => {
      root.render(
        <organisationContext.Provider
          value={{ activeOrganisation: { plan, planDetail: { maxWorkflowsPerAgent } } } as any}
        >
          <CreateWorkflowDialog agentId="agent-1" workflowCount={workflowCount} />
        </organisationContext.Provider>
      )
    })
  }

  test.each([
    ['FR', 3, 'Pro'],
    ['PR', 10, 'Enterprise'],
  ])('offers an upgrade once a %s Agent has %i Workflows', async (plan, limit, target) => {
    await render(plan, limit, limit)

    expect(container.querySelector('[data-testid="create"]')).toBeNull()
    const upsell = container.querySelector('[data-testid="upsell"]')?.textContent
    expect(upsell).toContain('Workflow')
    expect(upsell).toContain(target)
  })

  test.each([
    ['FR', 3, 2],
    ['EN', null, 40],
  ])('creates Workflows on %s below the limit', async (plan, limit, count) => {
    await render(plan, limit, count)

    expect(container.querySelector('[data-testid="create"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="upsell"]')).toBeNull()
  })
})
