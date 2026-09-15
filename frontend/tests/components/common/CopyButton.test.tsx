import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import CopyButton from '@/components/common/CopyButton'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('CopyButton', () => {
  let container: HTMLDivElement
  let root: Root
  const writeText = jest.fn<Promise<void>, [string]>()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    writeText.mockReset()
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  test('copies the exact value and exposes success to sighted and screen-reader users', async () => {
    const token = 'pss_agent:v1:line-wrap-safe-token'
    await act(async () => {
      root.render(<CopyButton value={token} title="Copy Agent token" />)
    })

    const button = container.querySelector<HTMLButtonElement>('button')!
    expect(button.type).toBe('button')
    expect(button.title).toBe('Copy Agent token')
    expect(button.getAttribute('aria-label')).toBe('Copy Agent token')

    await act(async () => button.click())

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(token)
    expect(button.getAttribute('aria-label')).toBe('Copy Agent token: copied')
    expect(button.textContent).toContain('Copied!')
    expect(button.textContent).toContain('Copied to clipboard')
  })

  test('shows a visible and accessible failure state when clipboard access is rejected', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard denied'))
    await act(async () => {
      root.render(<CopyButton value="token" title="Copy Agent token" />)
    })

    const button = container.querySelector<HTMLButtonElement>('button')!
    await act(async () => button.click())

    expect(button.textContent).toContain('Copy failed')
  })
})
