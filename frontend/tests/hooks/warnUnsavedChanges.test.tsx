import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { LeavePage, useWarnIfUnsavedChanges } from '@/hooks/warnUnsavedChanges'
import { installPopStateGuard, setPopStateGuard } from '@/utils/navigationGuard'

const push = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
const loader = { done: jest.fn() }
jest.mock('nextjs-toploader', () => ({ useTopLoader: () => loader }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// As in the app: the guard's listener goes in before the router's
installPopStateGuard()
const router = jest.fn()
window.addEventListener('popstate', router)

const Page = ({ unsaved, onLeave }: { unsaved: boolean; onLeave?: (leave: LeavePage) => void }) => {
  useWarnIfUnsavedChanges(unsaved, onLeave)
  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a plain anchor is what <Link> renders; the guard sees either */}
      <a href="/acme/apps/storefront/syncing">Syncing</a>
      <a href="#top">Top of this page</a>
      <a href="https://example.com/docs">Docs</a>
    </div>
  )
}

describe('useWarnIfUnsavedChanges', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.history.replaceState({ page: 'grid' }, '', '/acme/apps/storefront')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    jest.clearAllMocks()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    setPopStateGuard(null)
  })

  const render = async (props: React.ComponentProps<typeof Page>) => {
    await act(async () => root.render(<Page {...props} />))
  }
  /** True if the guard held it; jsdom never follows it (a hash's popstate would land in the next test) */
  const click = (text: string, init: MouseEventInit = {}) => {
    const link = [...container.querySelectorAll('a')].find((a) => a.textContent === text)!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
    let held: boolean | null = null
    const record = (e: Event) => {
      held = e.defaultPrevented
      e.preventDefault()
    }
    link.addEventListener('click', record)
    link.dispatchEvent(event)
    link.removeEventListener('click', record)
    // Not reached: the guard stopped the click on its way down
    return held ?? event.defaultPrevented
  }

  it('holds a link to another page and hands it to the app to ask', async () => {
    const onLeave = jest.fn()
    await render({ unsaved: true, onLeave })

    expect(click('Syncing')).toBe(true)
    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    // Carrying on goes where the link pointed
    act(() => (onLeave.mock.calls[0][0] as LeavePage)())
    expect(push).toHaveBeenCalledWith('/acme/apps/storefront/syncing')
  })

  it("leaves new tabs, other sites and this page's anchors alone", async () => {
    const onLeave = jest.fn()
    await render({ unsaved: true, onLeave })

    expect(click('Syncing', { ctrlKey: true })).toBe(false)
    expect(click('Syncing', { metaKey: true })).toBe(false)
    expect(click('Docs')).toBe(false)
    expect(click('Top of this page')).toBe(false)
    expect(onLeave).not.toHaveBeenCalled()
  })

  it('lets everything through with nothing to lose', async () => {
    const onLeave = jest.fn()
    await render({ unsaved: false, onLeave })

    expect(click('Syncing')).toBe(false)
    window.dispatchEvent(new PopStateEvent('popstate', { state: { page: 'syncing' } }))
    expect(onLeave).not.toHaveBeenCalled()
    expect(router).toHaveBeenCalledTimes(1)
  })

  it('holds back/forward before the router sees it and puts the page back', async () => {
    const onLeave = jest.fn()
    await render({ unsaved: true, onLeave })
    const pushState = jest.spyOn(window.history, 'pushState')
    const back = jest.spyOn(window.history, 'back').mockImplementation(() => {})

    // The browser has already moved the URL by the time popstate fires
    window.history.replaceState({ page: 'syncing' }, '', '/acme/apps/storefront/syncing')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { page: 'syncing' } }))

    expect(router).not.toHaveBeenCalled()
    expect(pushState).toHaveBeenCalledWith({ page: 'grid' }, '', 'http://localhost/acme/apps/storefront')
    expect(onLeave).toHaveBeenCalledTimes(1)

    // Carrying on steps back again, and that one reaches the router
    act(() => (onLeave.mock.calls[0][0] as LeavePage)())
    expect(back).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new PopStateEvent('popstate', { state: { page: 'syncing' } }))
    expect(router).toHaveBeenCalledTimes(1)
    expect(onLeave).toHaveBeenCalledTimes(1)

    pushState.mockRestore()
    back.mockRestore()
  })

  it("falls back to the browser's confirm without a handler", async () => {
    await render({ unsaved: true })
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false)

    expect(click('Syncing')).toBe(true)
    window.dispatchEvent(new PopStateEvent('popstate', { state: { page: 'syncing' } }))

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(router).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
})
