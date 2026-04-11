import React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import axios from 'axios'

import { UserProvider, useUser } from '@/contexts/userContext'

jest.mock('axios')
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}))

const mockedAxios = axios as jest.Mocked<typeof axios>
const { usePathname } = jest.requireMock('next/navigation') as {
  usePathname: jest.Mock
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Consumer() {
  const { loading, error, user } = useUser()
  return React.createElement('div', {
    'data-loading': String(loading),
    'data-error': String(error),
    'data-email': user?.email ?? '',
  })
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('UserProvider', () => {
  let container: HTMLDivElement
  let root: Root
  let originalLocation: Location

  beforeEach(() => {
    process.env.NEXT_PUBLIC_BACKEND_API_BASE = 'https://app.phase.dev/service'
    usePathname.mockReturnValue('/acme/settings')
    mockedAxios.get.mockReset()
    mockedAxios.isAxiosError.mockReset()
    mockedAxios.isAxiosError.mockReturnValue(true)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/current' },
    })
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
    jest.clearAllMocks()
  })

  it('does not redirect to login on transient backend failures', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 500 } })

    await act(async () => {
      root.render(React.createElement(UserProvider, null, React.createElement(Consumer)))
    })
    await flushEffects()

    const content = container.firstElementChild as HTMLElement
    expect(content.dataset.loading).toBe('false')
    expect(content.dataset.error).toBe('true')
    expect(window.location.href).toBe('http://localhost/current')
  })

  it('redirects to login on 401 auth failures', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 401 } })

    await act(async () => {
      root.render(React.createElement(UserProvider, null, React.createElement(Consumer)))
    })
    await flushEffects()

    expect(window.location.href).toContain('/login?callbackUrl=')
  })
})
