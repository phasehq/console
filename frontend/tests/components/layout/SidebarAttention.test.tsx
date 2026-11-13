import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import Sidebar from '@/components/layout/Sidebar'
import { SidebarContext } from '@/contexts/sidebarContext'
import {
  useCanReadAgentRequests,
  usePendingAgentRequestCount,
} from '@/utils/agents/pendingRequests'

jest.mock('@/utils/agents/pendingRequests', () => ({
  useCanReadAgentRequests: jest.fn(),
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

  const render = async (
    pending: number,
    sidebarState: 'expanded' | 'collapsed',
    canRead = true
  ) => {
    ;(useCanReadAgentRequests as jest.Mock).mockReturnValue(canRead)
    ;(usePendingAgentRequestCount as jest.Mock).mockReturnValue(canRead ? pending : 0)
    await act(async () =>
      root.render(
        <SidebarContext.Provider value={{ sidebarState, setUserPreference: jest.fn() }}>
          <Sidebar />
        </SidebarContext.Provider>
      )
    )
  }

  const linksTo = (href: string) =>
    Array.from(container.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`))
  const agentsLinks = () => linksTo('/acme/agents')
  const requestsLinks = () => linksTo('/acme/requests')

  test('counts pending requests on the Requests item and names them', async () => {
    await render(2, 'expanded')

    const [desktop, mobile] = requestsLinks()
    expect(desktop.getAttribute('aria-label')).toBe('Requests (Beta), 2 pending requests')
    expect(desktop.textContent).toBe('RequestsBeta2')
    // The mobile tab bar has no room for a count, so it shows a dot.
    expect(mobile.getAttribute('aria-label')).toBe('Requests (Beta), 2 pending requests')
    expect(mobile.querySelector('.bg-amber-500')).not.toBeNull()
  })

  test('shows the count once: the AI Agents item no longer carries it', async () => {
    await render(2, 'expanded')

    const [desktop, mobile] = agentsLinks()
    expect(desktop.getAttribute('aria-label')).toBe('AI Agents (Beta)')
    expect(desktop.textContent).toBe('AI AgentsBeta')
    expect(desktop.querySelector('.bg-amber-500')).toBeNull()
    expect(mobile.querySelector('.bg-amber-500')).toBeNull()
    expect(container.querySelectorAll('nav')[0].querySelectorAll('.bg-amber-500')).toHaveLength(1)
  })

  test('sits right after AI Agents, with a stage badge and no stage in its name', async () => {
    await render(0, 'expanded')

    const desktop = Array.from(container.querySelectorAll('nav')[0].querySelectorAll('a')).map(
      (link) => link.getAttribute('href')
    )
    expect(desktop.indexOf('/acme/requests')).toBe(desktop.indexOf('/acme/agents') + 1)
    const [link] = requestsLinks()
    expect(link.textContent).toBe('RequestsBeta')
    expect(link.textContent).not.toContain('(Beta)')
  })

  test('shows a dot on the icon when the sidebar is collapsed', async () => {
    await render(1, 'collapsed')

    const [desktop] = requestsLinks()
    expect(desktop.getAttribute('aria-label')).toBe('Requests (Beta), 1 pending request')
    expect(desktop.querySelector('.text-lg .bg-amber-500')).not.toBeNull()
  })

  test('adds nothing without pending requests', async () => {
    await render(0, 'expanded')

    const [desktop, mobile] = requestsLinks()
    expect(desktop.getAttribute('aria-label')).toBe('Requests (Beta)')
    expect(desktop.textContent).toBe('RequestsBeta')
    expect(container.querySelector('.bg-amber-500')).toBeNull()
    expect(mobile.getAttribute('aria-label')).toBe('Requests (Beta)')
  })

  test('hides Requests from members who cannot read Agent requests', async () => {
    await render(3, 'expanded', false)

    expect(requestsLinks()).toHaveLength(0)
    expect(container.querySelector('.bg-amber-500')).toBeNull()
    // The mobile tab bar keeps its first four destinations.
    expect(linksTo('/acme/integrations')).toHaveLength(2)
  })
})
