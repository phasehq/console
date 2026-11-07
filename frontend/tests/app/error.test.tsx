import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import ErrorPage from '@/app/error'

jest.mock('@/components/layout/OnboardingNavbar', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/common/HeroPattern', () => ({ HeroPattern: () => null }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('app error page', () => {
  let container: HTMLDivElement
  let root: Root
  let consoleError: jest.SpyInstance

  const render = async (error: Error, reset: () => void) => {
    await act(async () => {
      root.render(<ErrorPage error={error} reset={reset} />)
    })
  }
  const button = () => container.querySelector('button')!

  beforeEach(() => {
    // The page logs the error, and jsdom reports a reload as a not-implemented navigation.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.restoreAllMocks()
  })

  it('re-renders the segment to retry other errors', async () => {
    const reset = jest.fn()
    await render(new Error('Something broke'), reset)

    expect(button().textContent).toBe('Try again')
    await act(async () => button().click())
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('reloads the page for a chunk load error', async () => {
    const reset = jest.fn()
    const error = new Error('Failed to load chunk /_next/static/chunks/a.js from module 1')
    error.name = 'ChunkLoadError'
    await render(error, reset)

    expect(button().textContent).toBe('Reload')
    await act(async () => button().click())
    expect(reset).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('navigation') })
    )
  })
})
