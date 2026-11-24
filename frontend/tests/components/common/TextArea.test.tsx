import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Textarea } from '@/components/common/TextArea'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('Textarea', () => {
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
  })

  test('handles value changes without forwarding setValue to the DOM', async () => {
    const setValue = jest.fn()
    await act(async () => {
      root.render(<Textarea id="description" value="hello" setValue={setValue} label="Details" />)
    })

    const textarea = container.querySelector('textarea')!
    expect(textarea.getAttribute('setValue')).toBeNull()
    expect(textarea.value).toBe('hello')

    await act(async () => {
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
    })
  })
})
