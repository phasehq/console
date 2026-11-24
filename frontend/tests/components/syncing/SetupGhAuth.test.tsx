jest.mock('@/utils/appConfig', () => ({ isCloudHosted: () => false }))
jest.mock('@/apollo/client', () => ({ refreshCsrfToken: async () => 'csrf-token' }))
jest.mock('next/navigation', () => ({ usePathname: () => '/acme/integrations' }))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn() } }))
jest.mock('@/contexts/organisationContext', () => {
  const React = require('react')
  return {
    organisationContext: React.createContext({ activeOrganisation: { id: 'org-1' } }),
  }
})

import { parseGhesHostUrl } from '@/components/syncing/GitHub/SetupGhAuth'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const HOST_ENV = 'NEXT_PUBLIC_GITHUB_ENTERPRISE_INTEGRATION_HOST_URL'

// The host is read when the module loads, so load a fresh copy (with its
// own React) for each configuration and open the GitHub Enterprise Server tab.
const renderEnterpriseTab = async (hostUrl?: string) => {
  jest.resetModules()
  process.env.NEXT_PUBLIC_GITHUB_ENTERPRISE_INTEGRATION_CLIENT_ID = 'ent-cid'
  if (hostUrl === undefined) delete process.env[HOST_ENV]
  else process.env[HOST_ENV] = hostUrl

  const React = require('react')
  const { createRoot } = require('react-dom/client')
  const { SetupGhAuth } = require('@/components/syncing/GitHub/SetupGhAuth')

  const container = document.createElement('div')
  document.body.appendChild(container)
  await React.act(async () => {
    createRoot(container).render(React.createElement(SetupGhAuth))
  })

  const tab = Array.from(container.querySelectorAll('[role="tab"]')).find((el) =>
    el.textContent?.includes('Enterprise')
  ) as HTMLElement
  await React.act(async () => {
    tab.click()
  })
  return { container, act: React.act }
}

afterEach(() => {
  document.body.innerHTML = ''
  jest.restoreAllMocks()
})

describe('parseGhesHostUrl', () => {
  it.each([
    [' https://GHE.corp/ ', 'https://ghe.corp'],
    ['https://ghe.corp/api/v3', 'https://ghe.corp'],
    ['http://ghe.corp:8080', 'http://ghe.corp:8080'],
  ])('reads %p as %p', (value, expected) => {
    expect(parseGhesHostUrl(value)).toBe(expected)
  })

  it.each([
    undefined,
    '',
    'ghe.corp',
    'javascript:alert(1)',
    'BAKED_NEXT_PUBLIC_GITHUB_ENTERPRISE_INTEGRATION_HOST_URL',
  ])('returns null for %p', (value) => {
    expect(parseGhesHostUrl(value)).toBeNull()
  })
})

describe('SetupGhAuth (GitHub Enterprise Server)', () => {
  it('shows the configured host instead of host and API URL inputs', async () => {
    const { container } = await renderEnterpriseTab('https://ghe.corp')

    // Only the credential name is editable
    expect(container.querySelectorAll('input')).toHaveLength(1)
    expect(container.textContent).not.toContain('GitHub API URL')
    expect(container.textContent).toContain('https://ghe.corp')
  })

  it('never sends a host or API URL', async () => {
    const { container, act } = await renderEnterpriseTab('https://ghe.corp')

    const submitted: HTMLFormElement[] = []
    jest.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
      this: HTMLFormElement
    ) {
      submitted.push(this)
    })

    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(submitted).toHaveLength(1)
    const fields = Object.fromEntries(
      Array.from(submitted[0].querySelectorAll('input')).map((input) => [input.name, input.value])
    )
    expect(submitted[0].action).toMatch(/\/service\/oauth\/github\/authorize$/)
    expect(fields).toMatchObject({ isEnterprise: 'true' })
    expect(fields).not.toHaveProperty('hostUrl')
    expect(fields).not.toHaveProperty('apiUrl')
  })

  it('is disabled until the operator configures a host', async () => {
    const { container } = await renderEnterpriseTab(undefined)

    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(container.textContent).toContain('GITHUB_ENTERPRISE_INTEGRATION_HOST_URL')
  })
})
