import React, { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { redirect } from 'next/navigation'
import AgentRequestsRedirect from '@/app/[team]/agents/requests/page'

let search = ''
jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
  useSearchParams: () => new URLSearchParams(search),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// The page only redirects, so it renders nothing.
const Page = AgentRequestsRedirect as unknown as React.FC<{ params: Promise<{ team: string }> }>

describe('the old Agents Requests page', () => {
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
    jest.clearAllMocks()
  })

  const visit = async (team: string, query: string) => {
    search = query
    await act(async () => {
      root.render(
        <Suspense fallback={null}>
          <Page params={Promise.resolve({ team })} />
        </Suspense>
      )
      await Promise.resolve()
    })
  }

  test('sends an approval link to the Requests section with its query string', async () => {
    await visit('phase', 'request=request-1&action=setup')

    expect(redirect).toHaveBeenCalledWith('/phase/requests?request=request-1&action=setup')
  })

  test('redirects a bare visit too', async () => {
    await visit('acme', '')

    expect(redirect).toHaveBeenCalledWith('/acme/requests')
  })
})
