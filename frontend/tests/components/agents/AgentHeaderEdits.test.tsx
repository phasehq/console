import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import { AgentHarnessDialog, AgentNameField } from '@/components/agents/AgentDialogs'

jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  UpdateAgentOp: Symbol('UpdateAgentOp'),
}))

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({}))

jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: jest.fn(() => ({ data: undefined, loading: false })),
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
        onOpen,
      }: {
        children: React.ReactNode
        onOpen?: () => void
      },
      ref: React.ForwardedRef<{ closeModal: () => void; openModal: () => void }>
    ) {
      const [isOpen, setIsOpen] = ReactModule.useState(false)
      ReactModule.useImperativeHandle(ref, () => ({
        closeModal: () => setIsOpen(false),
        openModal: () => {
          onOpen?.()
          setIsOpen(true)
        },
      }))
      return isOpen ? <div role="dialog">{children}</div> : null
    }),
  }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('Agent header edits', () => {
  let container: HTMLDivElement
  let root: Root
  let updateAgent: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    updateAgent = jest.fn().mockResolvedValue({ data: { updateAgent: { agent: {} } } })
    ;(useMutation as jest.Mock).mockReturnValue([updateAgent, { loading: false }])
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const nameInput = () =>
    container.querySelector<HTMLInputElement>('input[aria-label="Agent name"]')!
  const button = (label: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (element) => element.textContent === label
    )

  const typeName = async (value: string) => {
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )!.set!
    await act(async () => {
      setValue.call(nameInput(), value)
      nameInput().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  const renderName = async (name: string, canUpdate = true) => {
    await act(async () => {
      root.render(<AgentNameField agent={{ id: 'agent-1', name }} canUpdate={canUpdate} />)
    })
  }

  test('renames in place and saves the trimmed name', async () => {
    await renderName('release-assistant')
    expect(button('Save')).toBeUndefined()

    await typeName('  release-bot  ')
    await act(async () => button('Save')!.click())

    expect(updateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { agentId: 'agent-1', name: 'release-bot' } })
    )
  })

  test('keeps a rename in progress when polling refreshes the Agent', async () => {
    await renderName('release-assistant')
    await typeName('release-bot')

    await renderName('renamed-elsewhere')

    expect(nameInput().value).toBe('release-bot')
  })

  test('Escape discards the draft and shows the current name', async () => {
    await renderName('release-assistant')
    await typeName('discarded-draft')
    await renderName('renamed-elsewhere')

    await act(async () => {
      nameInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(nameInput().value).toBe('renamed-elsewhere')
    expect(button('Discard')).toBeUndefined()
  })

  test('cannot save an empty name', async () => {
    await renderName('release-assistant')
    await typeName('   ')

    expect(button('Save')!.disabled).toBe(true)
  })

  test('shows the name as text for members who cannot update the Agent', async () => {
    await renderName('release-assistant', false)

    expect(nameInput()).toBeNull()
    expect(container.querySelector('h2')!.textContent).toBe('release-assistant')
  })

  test('the harness dialog opens on the current harness and saves a new one', async () => {
    const renderHarness = (harnessType: string) =>
      act(async () => {
        root.render(
          <AgentHarnessDialog agent={{ id: 'agent-1', harnessType }}>
            {(open) => (
              <button type="button" onClick={open}>
                Change harness
              </button>
            )}
          </AgentHarnessDialog>
        )
      })
    const option = (label: string) =>
      Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]')).find((radio) =>
        radio.textContent?.includes(label)
      )!

    await renderHarness('CODEX')
    await act(async () => button('Change harness')!.click())
    expect(option('Codex').getAttribute('aria-checked')).toBe('true')
    expect(button('Save harness')!.disabled).toBe(true)

    await act(async () => option('Claude Code').click())
    await act(async () => {
      container.querySelector<HTMLFormElement>('form')!.requestSubmit()
    })

    expect(updateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { agentId: 'agent-1', harnessType: 'claude_code' } })
    )
  })
})
