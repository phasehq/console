/**
 * Chunk load errors: a JS or CSS file under /_next/static/ that the server can't serve. Chunk
 * names are content hashes, so each build only has its own. A page from one build that asks a
 * server running another build for a chunk gets a 404, e.g. while a rolling deploy has old and
 * new containers behind the load balancer, or in a tab left open across a deploy. Reloading the
 * page fetches HTML from a running build, which references chunks that build has.
 */

/** True for the error the bundler runtime throws when a chunk fails to load. */
export const isChunkLoadError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ChunkLoadError'

/**
 * Shows a notice with a reload button when a script or stylesheet under /_next/static/ fails to
 * load. Runs as an inline script in the document head (see app/layout.tsx): a failed initial
 * chunk stops the app's own JS from ever running, so this has to work without it. Keep it
 * self-contained (it is serialized with toString) and style it inline, since the app's CSS may
 * be the file that failed.
 */
export function watchChunkLoadErrors() {
  let shown = false

  const isChunkUrl = (url: string) => url.indexOf('/_next/static/') !== -1

  const showNotice = () => {
    if (shown) return
    shown = true

    const notice = document.createElement('div')
    notice.id = 'chunk-load-error'
    notice.setAttribute('role', 'alert')
    notice.style.cssText =
      'position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);' +
      'bottom:calc(var(--mobile-tabbar-height, 0px) + 16px);box-sizing:border-box;' +
      'display:flex;align-items:center;gap:12px;width:max-content;max-width:calc(100% - 32px);' +
      'padding:8px 8px 8px 16px;border:1px solid #3f3f46;border-radius:8px;' +
      'background:#18181b;color:#f4f4f5;box-shadow:0 10px 30px rgba(0,0,0,0.3);' +
      'font:14px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif'

    const message = document.createElement('span')
    message.textContent = 'A new version of Phase Console may be available.'

    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Reload'
    button.style.cssText =
      'flex-shrink:0;cursor:pointer;border:0;border-radius:9999px;padding:4px 12px;' +
      'background:#10b981;color:#fff;font:inherit;font-size:12px;font-weight:600'
    button.onclick = () => window.location.reload()

    notice.append(message, button)

    const show = () => {
      document.body.appendChild(notice)
      // An error that reaches the root makes React re-render the whole document for Next's
      // error page, dropping nodes it didn't render, so put the notice back.
      new MutationObserver(() => {
        if (!notice.isConnected && document.body) document.body.appendChild(notice)
      }).observe(document.documentElement, { childList: true, subtree: true })
    }
    if (document.body) show()
    else document.addEventListener('DOMContentLoaded', show)
  }

  // Load errors don't bubble, so listen in the capture phase.
  window.addEventListener(
    'error',
    (event) => {
      const el = event.target
      const url =
        el instanceof HTMLScriptElement ? el.src : el instanceof HTMLLinkElement ? el.href : ''
      if (isChunkUrl(url)) showNotice()
    },
    true
  )

  // Catch loads that failed before this ran: the parser holds inline scripts until the
  // stylesheets above them load, while async chunks keep loading. Safari lacks responseStatus.
  performance.getEntriesByType('resource').forEach((entry) => {
    const { name, responseStatus } = entry as PerformanceResourceTiming & {
      responseStatus?: number
    }
    if (isChunkUrl(name) && responseStatus !== undefined && responseStatus >= 400) showNotice()
  })
}
