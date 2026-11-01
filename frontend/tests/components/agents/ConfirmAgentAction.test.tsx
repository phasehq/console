import React, { act, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FaTimes, FaTrash } from 'react-icons/fa'
import { ConfirmAgentAction } from '@/components/agents/AgentDialogs'

jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({}))
jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({}))
jest.mock('@headlessui/react', () => {
  const Dialog = Object.assign(({ children }: any) => <div>{children}</div>, {
    Panel: ({ children }: any) => <div>{children}</div>,
    Title: ({ children }: any) => <div>{children}</div>,
  })
  const Transition = Object.assign(({ children, show }: any) => (show ? <>{children}</> : null), {
    Child: ({ children }: any) => <>{children}</>,
  })
  return { Dialog, Transition }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('ConfirmAgentAction', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const markup = async (Icon: ComponentType) => {
    const element = document.createElement('div')
    const iconRoot = createRoot(element)
    await act(async () => iconRoot.render(<Icon />))
    const html = element.querySelector('svg')!.innerHTML
    await act(async () => iconRoot.unmount())
    return html
  }

  const deleteButtons = () =>
    Array.from(container.querySelectorAll('button')).filter(
      (button) => button.textContent === 'Delete'
    )

  const openDialog = async (props: Partial<React.ComponentProps<typeof ConfirmAgentAction>>) => {
    await act(async () =>
      root.render(
        <ConfirmAgentAction
          title="Delete Workflow"
          description="Its tokens will be revoked."
          actionLabel="Delete"
          onConfirm={async () => {}}
          {...props}
        />
      )
    )
    await act(async () => deleteButtons()[0].click())
    const [trigger, confirm] = deleteButtons()
    return { trigger, confirm }
  }

  test('shows the action icon on the trigger and on the confirm button', async () => {
    const { trigger, confirm } = await openDialog({})

    expect(trigger.querySelector('svg')!.innerHTML).toBe(await markup(FaTimes))
    expect(confirm.querySelector('svg')!.innerHTML).toBe(await markup(FaTimes))
  })

  test('a custom trigger icon is used on both buttons', async () => {
    const { trigger, confirm } = await openDialog({ triggerProps: { icon: FaTrash } })

    expect(trigger.querySelector('svg')!.innerHTML).toBe(await markup(FaTrash))
    expect(confirm.querySelector('svg')!.innerHTML).toBe(await markup(FaTrash))
  })

  test('swaps the confirm icon for a spinner while the action runs', async () => {
    let finish = () => {}
    const { confirm } = await openDialog({
      onConfirm: () => new Promise<void>((resolve) => (finish = resolve)),
    })

    await act(async () => confirm.click())
    expect(confirm.querySelector('[role="status"]')).not.toBeNull()
    expect(confirm.querySelector('svg')).toBeNull()

    await act(async () => finish())
  })
})
