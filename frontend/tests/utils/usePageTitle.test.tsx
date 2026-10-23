import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { usePageTitle } from '@/utils/usePageTitle'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const Titled = ({ title }: { title: string }) => {
  usePageTitle(title)
  return null
}

/** Stand in for Next committing a route's streamed metadata after our effect. */
const commitRouteMetadata = (title: string) => {
  const element = document.createElement('title')
  element.textContent = title
  document.head.querySelector('title')?.remove()
  document.head.appendChild(element)
  document.title = title
}

describe('usePageTitle', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    document.title = ''
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.head.querySelector('title')?.remove()
  })

  test('sets the title', async () => {
    await act(async () => root.render(<Titled title="Agents · phase | Phase Console" />))

    expect(document.title).toBe('Agents · phase | Phase Console')
  })

  test('reclaims the title when route metadata overwrites it later', async () => {
    await act(async () => root.render(<Titled title="Agents · phase | Phase Console" />))
    await act(async () => commitRouteMetadata('Phase Console'))

    expect(document.title).toBe('Agents · phase | Phase Console')
  })

  test('follows a navigation to a new title', async () => {
    await act(async () => root.render(<Titled title="Agents · phase | Phase Console" />))
    await act(async () => root.render(<Titled title="Apps · phase | Phase Console" />))
    await act(async () => commitRouteMetadata('Phase Console'))

    expect(document.title).toBe('Apps · phase | Phase Console')
  })

  test('stops defending the title once unmounted', async () => {
    await act(async () => root.render(<Titled title="Agents · phase | Phase Console" />))
    await act(async () => root.unmount())
    await act(async () => commitRouteMetadata('Phase Console'))

    expect(document.title).toBe('Phase Console')
    root = createRoot(container)
  })
})
