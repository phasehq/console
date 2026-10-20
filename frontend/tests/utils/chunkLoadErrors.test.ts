/**
 * @jest-environment node
 */
// Node environment: each watcher test builds its own page with jsdom.
import { JSDOM, VirtualConsole } from 'jsdom'
import { isChunkLoadError, watchChunkLoadErrors } from '@/utils/chunkLoadErrors'

describe('isChunkLoadError', () => {
  it('matches the error the bundler throws when a chunk fails to load', () => {
    const error = new Error('Failed to load chunk /_next/static/chunks/a.js from module 1')
    error.name = 'ChunkLoadError'
    expect(isChunkLoadError(error)).toBe(true)
  })

  it('ignores other errors', () => {
    expect(isChunkLoadError(new Error('Something broke'))).toBe(false)
    expect(isChunkLoadError(new TypeError('x is undefined'))).toBe(false)
    expect(isChunkLoadError('ChunkLoadError')).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})

describe('watchChunkLoadErrors', () => {
  type EarlierLoad = { name: string; responseStatus?: number }

  // A fresh page with the watcher inlined in <head> the way app/layout.tsx ships it, which also
  // checks that it still runs once serialized. `earlierLoads` are the Resource Timing entries
  // recorded before it ran.
  const loadPage = async (earlierLoads: EarlierLoad[] = []) => {
    const navigations: string[] = []
    const virtualConsole = new VirtualConsole()
    // jsdom can't navigate, so it reports a reload as a not-implemented navigation.
    virtualConsole.on('jsdomError', (error) => navigations.push(error.message))

    const { window } = new JSDOM(
      `<!doctype html><html><head><script>(${watchChunkLoadErrors.toString()})()</script></head><body></body></html>`,
      {
        url: 'https://console.phase.dev/',
        runScripts: 'dangerously',
        virtualConsole,
        beforeParse: (window) => {
          // jsdom has no Resource Timing
          window.performance.getEntriesByType = () =>
            earlierLoads as unknown as PerformanceEntryList
        },
      }
    )
    const { document } = window
    if (document.readyState !== 'complete') {
      await new Promise((resolve) => window.addEventListener('load', resolve))
    }

    const failToLoad = (el: HTMLScriptElement | HTMLLinkElement) => {
      document.head.appendChild(el)
      el.dispatchEvent(new window.Event('error'))
    }
    const script = (src: string) => Object.assign(document.createElement('script'), { src })
    const stylesheet = (href: string) =>
      Object.assign(document.createElement('link'), { rel: 'stylesheet', href })
    const notices = () => document.querySelectorAll('#chunk-load-error')

    return { window, document, failToLoad, script, stylesheet, notices, navigations }
  }

  it('shows a reload notice when a chunk script fails to load', async () => {
    const { failToLoad, script, notices, navigations } = await loadPage()
    expect(notices()).toHaveLength(0)

    failToLoad(script('/_next/static/chunks/0abc.js'))

    expect(notices()).toHaveLength(1)
    expect(notices()[0].textContent).toContain('A new version of Phase Console may be available.')
    const button = notices()[0].querySelector('button')!
    expect(button.textContent).toBe('Reload')
    button.click()
    expect(navigations).toEqual([expect.stringContaining('navigation')])
  })

  it('shows the notice when a chunk stylesheet fails to load', async () => {
    const { failToLoad, stylesheet, notices } = await loadPage()
    failToLoad(stylesheet('/_next/static/chunks/0abc.css'))
    expect(notices()).toHaveLength(1)
  })

  it('ignores resources outside /_next/static/', async () => {
    const { failToLoad, script, stylesheet, notices } = await loadPage()
    failToLoad(script('https://js.stripe.com/v3'))
    failToLoad(stylesheet('/assets/fonts.css'))
    expect(notices()).toHaveLength(0)
  })

  it('shows a single notice when several chunks fail', async () => {
    const { failToLoad, script, stylesheet, notices } = await loadPage()
    failToLoad(script('/_next/static/chunks/a.js'))
    failToLoad(script('/_next/static/chunks/b.js'))
    failToLoad(stylesheet('/_next/static/chunks/c.css'))
    expect(notices()).toHaveLength(1)
  })

  it('reports a chunk that failed before it started watching', async () => {
    const { notices } = await loadPage([
      { name: 'https://console.phase.dev/_next/static/chunks/ok.js', responseStatus: 200 },
      { name: 'https://console.phase.dev/_next/static/chunks/gone.js', responseStatus: 404 },
    ])
    expect(notices()).toHaveLength(1)
  })

  it('ignores earlier loads that succeeded, failed elsewhere or report no status', async () => {
    const { notices } = await loadPage([
      { name: 'https://console.phase.dev/_next/static/chunks/ok.js', responseStatus: 200 },
      // Safari doesn't report responseStatus
      { name: 'https://console.phase.dev/_next/static/chunks/unknown.js' },
      { name: 'https://console.phase.dev/service/graphql/', responseStatus: 500 },
    ])
    expect(notices()).toHaveLength(0)
  })

  it('puts the notice back when the document is re-rendered without it', async () => {
    const { document, failToLoad, script, notices } = await loadPage()
    failToLoad(script('/_next/static/chunks/a.js'))

    // What React does when it renders Next's error page in place of the root layout.
    document.body.innerHTML = '<main>This page couldn’t load</main>'
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(notices()).toHaveLength(1)
    expect(document.body.textContent).toContain('This page couldn’t load')
  })
})
