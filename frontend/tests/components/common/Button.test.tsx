import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@/components/common/Button'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('Button', () => {
  test('textWarning is the text link in amber', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <>
          <Button variant="text">Emerald</Button>
          <Button variant="textWarning">Amber</Button>
        </>
      )
    )

    const [text, warning] = Array.from(container.querySelectorAll('button'))
    expect(text.className).toContain('text-emerald-500')
    expect(warning.className).toContain('text-amber-700')
    expect(warning.className).toContain('dark:text-amber-400')
    // Like the emerald link: no pill and no padding.
    expect(warning.className).not.toMatch(/rounded-full|px-3/)

    await act(async () => root.unmount())
  })
})
