import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import Sidebar from '@/components/layout/Sidebar'
import { SidebarContext } from '@/contexts/sidebarContext'
import { usePendingAgentRequestCount } from '@/utils/agents/pendingRequests'

jest.mock('@/utils/agents/pendingRequests', () => ({
  usePendingAgentRequestCount: jest.fn(),
}))
jest.mock('next/navigation', () => ({ usePathname: () => '/acme/apps' }))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
jest.mock('@/contexts/organisationContext', () => {
  const activeOrganisation = { id: 'org-1', name: 'acme', plan: 'FR', role: { name: 'Owner' } }
  return {
    organisationContext: jest
      .requireActual<typeof React>('react')
      .createContext({ activeOrganisation, organisations: [activeOrganisation] }),
  }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('Sidebar attention', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    // Wide enough that the sidebar does not collapse itself.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const render = async (pending: number, sidebarState: 'expanded' | 'collapsed') => {
    ;(usePendingAgentRequestCount as jest.Mock).mockReturnValue(pending)
    await act(async () =>
      root.render(
        <SidebarContext.Provider value={{ sidebarState, setUserPreference: jest.fn() }}>
          <Sidebar />
        </SidebarContext.Provider>
      )
    )
  }

  const agentsLinks = () =>
    Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href="/acme/agents"]'))

  test('counts pending requests on the AI Agents item and names them', async () => {
    await render(2, 'expanded')

    const [desktop, mobile] = agentsLinks()
    expect(desktop.getAttribute('aria-label')).toBe('AI Agents (Beta), 2 pending requests')
    expect(desktop.textContent).toBe('AI AgentsBeta2')
    // The mobile tab bar has no room for a count, so it shows a dot.
    expect(mobile.getAttribute('aria-label')).toBe('AI Agents (Beta), 2 pending requests')
    expect(mobile.querySelector('.bg-amber-500')).not.toBeNull()
  })

  test('shows a dot on the icon when the sidebar is collapsed', async () => {
    await render(1, 'collapsed')

    const [desktop] = agentsLinks()
    expect(desktop.getAttribute('aria-label')).toBe('AI Agents (Beta), 1 pending request')
    expect(desktop.querySelector('.text-lg .bg-amber-500')).not.toBeNull()
  })

  test('adds nothing without pending requests', async () => {
    await render(0, 'expanded')

    const [desktop, mobile] = agentsLinks()
    expect(desktop.getAttribute('aria-label')).toBe('AI Agents (Beta)')
    expect(desktop.textContent).toBe('AI AgentsBeta')
    expect(container.querySelector('.bg-amber-500')).toBeNull()
    expect(mobile.getAttribute('aria-label')).toBe('AI Agents (Beta)')
  })
})
