import { isSafeRedirectPath } from '@/utils/auth'

// jsdom serves window.location.origin as http://localhost by default.
describe('isSafeRedirectPath', () => {
  test('accepts same-origin relative paths', () => {
    expect(isSafeRedirectPath('/team/apps')).toBe(true)
    expect(isSafeRedirectPath('/invite/abc?x=1')).toBe(true)
  })

  test('rejects protocol-relative URLs', () => {
    expect(isSafeRedirectPath('//evil.com')).toBe(false)
  })

  test('rejects backslash authority bypass (browser resolves \\ as /)', () => {
    expect(isSafeRedirectPath('/\\evil.com')).toBe(false)
    expect(isSafeRedirectPath('/\\/evil.com')).toBe(false)
    expect(isSafeRedirectPath('\\/evil.com')).toBe(false)
  })

  test('rejects absolute URLs and control chars', () => {
    expect(isSafeRedirectPath('https://evil.com')).toBe(false)
    expect(isSafeRedirectPath('/a\tb')).toBe(false)
  })

  test('rejects empty / nullish / non-path values', () => {
    expect(isSafeRedirectPath('')).toBe(false)
    expect(isSafeRedirectPath(null)).toBe(false)
    expect(isSafeRedirectPath(undefined)).toBe(false)
    expect(isSafeRedirectPath('relative')).toBe(false)
  })
})
