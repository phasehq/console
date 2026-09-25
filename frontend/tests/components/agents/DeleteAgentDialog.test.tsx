import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { DeleteAgentDialog } from '@/components/agents/AgentDialogs'
import { DeleteAgentOp } from '@/graphql/mutations/agents/manageAgents.gql'

jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  DeleteAgentOp: Symbol('DeleteAgentOp'),
}))

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({}))

jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: jest.fn(),
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
        buttonContent,
      }: {
        children: React.ReactNode
        title: string
        buttonContent?: React.ReactNode
      },
      ref: React.ForwardedRef<{ closeModal: () => void }>
    ) {
      ReactModule.useImperativeHandle(ref, () => ({ closeModal: jest.fn() }))
      return (
        <div>
          {buttonContent ? (
            <button type="button" data-dialog-trigger>
              {buttonContent}
            </button>
          ) : null}
          <h2>{title}</h2>
          {children}
        </div>
      )
    }),
  }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('DeleteAgentDialog', () => {
  let container: HTMLDivElement
  let root: Root
  let deleteAgent: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    deleteAgent = jest.fn()
    ;(useMutation as jest.Mock).mockImplementation((document) => {
      if (document === DeleteAgentOp) return [deleteAgent, { loading: false }]
      throw new Error('Unexpected mutation in DeleteAgentDialog test')
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const confirmDeletion = async () => {
    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => !button.hasAttribute('data-dialog-trigger')
    )!
    await act(async () => {
      confirm.click()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  test('deletes the Agent, refreshes Agent views, and reports success', async () => {
    deleteAgent.mockResolvedValue({ data: { deleteAgent: { ok: true } } })
    const onDeleted = jest.fn()

    await act(async () => {
      root.render(
        <DeleteAgentDialog agentId="agent-1" agentName="release-assistant" onDeleted={onDeleted} />
      )
    })
    await confirmDeletion()

    expect(deleteAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { agentId: 'agent-1' },
        refetchQueries: ['GetAgents', 'GetAgentMesh'],
      })
    )
    expect(toast.success).toHaveBeenCalledWith('Agent deleted')
    expect(onDeleted).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['nullable', { data: { deleteAgent: null } }],
    ['false', { data: { deleteAgent: { ok: false } } }],
  ])('does not report deletion for a %s mutation result', async (_label, result) => {
    deleteAgent.mockResolvedValue(result)
    const onDeleted = jest.fn()

    await act(async () => {
      root.render(
        <DeleteAgentDialog agentId="agent-1" agentName="release-assistant" onDeleted={onDeleted} />
      )
    })
    await confirmDeletion()

    expect(deleteAgent).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { agentId: 'agent-1' } })
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
