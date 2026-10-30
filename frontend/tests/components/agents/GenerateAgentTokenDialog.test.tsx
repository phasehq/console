import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import { MintAgentTokenDialog } from '@/components/agents/AgentDialogs'
import { MintAgentTokenOp } from '@/graphql/mutations/agents/manageAgents.gql'
import { generateAgentName } from '@/utils/agents/names'

jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  MintAgentTokenOp: Symbol('MintAgentTokenOp'),
}))

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({}))

jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: jest.fn(() => ({ data: undefined, loading: false })),
}))

jest.mock('@/utils/agents/names', () => ({
  generateAgentName: jest.fn(),
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
        size,
        dismissible = true,
      }: {
        children: React.ReactNode
        title: string
        dialogTitle?: React.ReactNode
        buttonContent?: React.ReactNode
        onClose?: () => void
        size?: string
        dismissible?: boolean
      },
      ref: React.ForwardedRef<{ closeModal: () => void; openModal: () => void }>
    ) {
      const [isOpen, setIsOpen] = ReactModule.useState(false)
      const close = () => {
        onClose?.()
        setIsOpen(false)
      }

      ReactModule.useImperativeHandle(ref, () => ({
        closeModal: close,
        openModal: () => setIsOpen(true),
      }))

      return (
        <div>
          {buttonContent ? (
            <button type="button" onClick={() => setIsOpen(true)}>
              {buttonContent}
            </button>
          ) : null}
          {isOpen ? (
            <div role="dialog" data-size={size} data-dismissible={String(dismissible)}>
              {dialogTitle || <h2>{title}</h2>}
              <button type="button" aria-label="Close dialog" onClick={close}>
                Close
              </button>
              {children}
            </div>
          ) : null}
        </div>
      )
    }),
  }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('MintAgentTokenDialog', () => {
  let container: HTMLDivElement
  let root: Root
  let generateToken: jest.Mock
  let resetMint: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    generateToken = jest.fn().mockResolvedValue({
      data: { mintAgentToken: { minted: { fullToken: 'pss_agent:test' } } },
    })
    resetMint = jest.fn()
    ;(useMutation as jest.Mock).mockImplementation((document) => {
      if (document === MintAgentTokenOp)
        return [generateToken, { loading: false, reset: resetMint }]
      throw new Error('Unexpected mutation in GenerateAgentTokenDialog test')
    })
    ;(generateAgentName as jest.Mock)
      .mockReset()
      .mockReturnValueOnce('steady-cobalt-forest')
      .mockReturnValue('fresh-amber-signal')
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const renderDialog = async () => {
    await act(async () => {
      root.render(
        <MintAgentTokenDialog
          agentId="agent-1"
          workflows={[{ id: 'workflow-1', name: 'Default' }]}
          harnessType="codex"
        />
      )
    })
  }

  const openDialog = async () => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')!.click()
    })
  }

  test('uses generate language, places the safety subtitle in the heading, and preserves a draft', async () => {
    await renderDialog()
    await openDialog()

    expect(container.textContent).toContain('Generate agent token')
    expect(container.textContent).not.toContain('Mint token')
    const safetySubtitle = Array.from(container.querySelectorAll('p')).find((element) =>
      element.textContent?.includes('Agent tokens only authorize the Phase AI runtime')
    )!
    const nameInput = container.querySelector<HTMLInputElement>('#token-name')!
    expect(safetySubtitle.querySelector('svg')).toBeNull()
    expect(
      safetySubtitle.compareDocumentPosition(nameInput) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )!.set!
    await act(async () => {
      setValue.call(nameInput, 'my-token-draft')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click()
    })
    await openDialog()

    expect(container.querySelector<HTMLInputElement>('#token-name')?.value).toBe('my-token-draft')
    expect(generateAgentName).toHaveBeenCalledTimes(1)
  })

  test('generates a new default only after completing a token', async () => {
    await renderDialog()
    await openDialog()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(generateToken).toHaveBeenCalledWith({
      variables: {
        agentId: 'agent-1',
        workflowId: 'workflow-1',
        name: 'steady-cobalt-forest',
        expiresAt: null,
      },
      refetchQueries: ['GetAgentDetail'],
    })
    expect(container.textContent).toContain('Install the Phase skill for Codex')
    expect(container.textContent).toContain('phase ai enable --harness codex')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click()
    })
    // The revealed token does not stay in the mutation result after dismissal.
    expect(resetMint).toHaveBeenCalled()
    await openDialog()

    expect(container.querySelector<HTMLInputElement>('#token-name')?.value).toBe(
      'fresh-amber-signal'
    )
    expect(generateAgentName).toHaveBeenCalledTimes(2)
  })

  test('does not offer past dates for a custom expiry', async () => {
    await renderDialog()
    await openDialog()
    const expiry = container.querySelector<HTMLElement>('[role="radiogroup"]')!
    expect(expiry.textContent).toContain('Expires')
    const custom = Array.from(expiry.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (button) => /custom/i.test(button.textContent || '')
    )!
    expect(custom.getAttribute('aria-checked')).toBe('false')
    await act(async () => custom.click())
    expect(custom.getAttribute('aria-checked')).toBe('true')

    const date = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom expiry date"]'
    )!
    expect(date.min).toBe(new Date().toLocaleDateString('en-CA'))
  })

  test('matches the Create Agent dialog width', async () => {
    await renderDialog()
    await openDialog()

    expect(container.querySelector<HTMLElement>('[role="dialog"]')!.dataset.size).toBe('md')
  })

  test('keeps the token on screen until it is copied', async () => {
    await renderDialog()
    await openDialog()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]')
    const done = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'Done'
      )!

    expect(done().disabled).toBe(true)
    expect(dialog()!.dataset.dismissible).toBe('false')
    expect(container.textContent).toContain('Copy the token to finish.')

    // Selecting the token and copying it counts, as well as the Copy button
    await act(async () => {
      container
        .querySelector('code.select-all')!
        .dispatchEvent(new Event('copy', { bubbles: true }))
    })

    expect(done().disabled).toBe(false)
    expect(dialog()!.dataset.dismissible).toBe('true')
    await act(async () => done().click())
    expect(dialog()).toBeNull()
  })
})
