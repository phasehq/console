import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { Avatar } from '@/components/common/Avatar'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('Avatar', () => {
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

  test('keeps the avatar square inside a constrained flex layout', async () => {
    await act(async () => {
      root.render(<Avatar user={{ name: 'Phase Account', image: '/avatar.png' }} size="sm" />)
    })

    const avatar = container.firstElementChild!
    const image = container.querySelector('img')!

    expect(Array.from(avatar.classList)).toEqual(
      expect.arrayContaining(['h-5', 'w-5', 'shrink-0', 'overflow-hidden', 'rounded-full'])
    )
    expect(Array.from(image.classList)).toEqual(
      expect.arrayContaining(['size-full', 'object-cover', 'rounded-full'])
    )
  })

  test('keeps fallback initials compact inside a small avatar', async () => {
    await act(async () => {
      root.render(<Avatar user={{ name: 'Phase Agent Test' }} size="sm" />)
    })

    const initials = container.querySelector('span')!

    expect(initials.textContent).toBe('PT')
    expect(Array.from(initials.classList)).toContain('leading-none')
  })
})
