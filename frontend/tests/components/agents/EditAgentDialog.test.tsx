import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import { EditAgentDialog } from '@/components/agents/AgentDialogs'

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
        buttonContent,
        onOpen,
        onClose,
      }: {
        children: React.ReactNode
        buttonContent?: React.ReactNode
        onOpen?: () => void
        onClose?: () => void
      },
      ref: React.ForwardedRef<{ closeModal: () => void }>
    ) {
      const [isOpen, setIsOpen] = ReactModule.useState(false)
      const close = () => {
        onClose?.()
        setIsOpen(false)
      }
      ReactModule.useImperativeHandle(ref, () => ({ closeModal: close }))

      return (
        <div>
          <button
            type="button"
            onClick={() => {
              onOpen?.()
              setIsOpen(true)
            }}
          >
            {buttonContent}
          </button>
          {isOpen ? (
            <div role="dialog">
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

describe('EditAgentDialog', () => {
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

  const renderDialog = async (name: string) => {
    await act(async () => {
      root.render(<EditAgentDialog agent={{ id: 'agent-1', name, harnessType: 'CODEX' }} />)
    })
  }

  const nameInput = () => container.querySelector<HTMLInputElement>('#agent-name-agent-1')!

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

  test('keeps an edit in progress when polling refreshes the Agent', async () => {
    await renderDialog('release-assistant')
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    await typeName('release-bot')

    await renderDialog('release-assistant')

    expect(nameInput().value).toBe('release-bot')
  })

  test('starts each opening from the current Agent', async () => {
    await renderDialog('release-assistant')
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    await typeName('discarded-draft')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click()
    })

    await renderDialog('renamed-elsewhere')
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())

    expect(nameInput().value).toBe('renamed-elsewhere')
  })
})
