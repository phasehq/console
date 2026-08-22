import _sodium from 'libsodium-wrappers-sumo'

export namespace UrlUtils {
  export const makeUrl = (...endpoints: string[]) => {
    let url = endpoints.reduce((prevUrl, currentPath) => {
      if (prevUrl.length === 0) {
        return prevUrl + currentPath
      }

      return prevUrl.endsWith('/') ? prevUrl + currentPath + '/' : prevUrl + '/' + currentPath + '/'
    }, '')
    return url
  }
}

/**
 * True only for a same-origin relative path safe to navigate to after
 * login. A leading-slash prefix check is not enough: browsers resolve a
 * backslash as a slash, so `/\evil.com` parses to an external authority
 * despite passing `startsWith('/') && !startsWith('//')`. Resolve against
 * the current origin and require the result to stay same-origin (also
 * rejecting backslashes and control characters up front).
 */
export const isSafeRedirectPath = (value: string | null | undefined): value is string => {
  if (!value || value[0] !== '/' || value.startsWith('//')) return false
  if (/[\\\x00-\x1f]/.test(value)) return false
  try {
    return new URL(value, window.location.origin).origin === window.location.origin
  } catch {
    return false
  }
}
