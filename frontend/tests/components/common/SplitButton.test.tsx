import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SplitButton } from '@/components/common/SplitButton'
import { Button } from '@/components/common/Button'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: jest.fn(),
})

Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] })

const settle = () => new Promise((resolve) => setTimeout(resolve, 60))

describe('Split button menu accessibility', () => {
  let container: HTMLDivElement
  let root: Root
  let providers: jest.Mock
  let dynamic: jest.Mock
  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    providers = jest.fn()
    dynamic = jest.fn()
    await act(async () =>
      root.render(
        <SplitButton
          variant="primary"
          aria-label="New Secret"
          onClick={jest.fn()}
          menuContent={
            <div className="flex flex-col">
              <Button onClick={providers}>Providers</Button>
              <Button disabled>Unavailable action</Button>
              <Button onClick={dynamic}>Dynamic Secret</Button>
            </div>
          }
        >
          New Secret
        </SplitButton>
      )
    )
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })
  const trigger = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
  const press = async (element: Element, key: string) => {
    await act(async () => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    })
    await act(async () => {
      await settle()
    })
  }

  test('names the menu trigger and registers every action separately', async () => {
    expect(trigger().getAttribute('aria-label')).toBe('More options for New Secret')
    expect(trigger().type).toBe('button')
    await act(async () => {
      trigger().click()
      await settle()
    })
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    expect(items.map((item) => item.textContent)).toEqual([
      'Providers',
      'Unavailable action',
      'Dynamic Secret',
    ])
    expect(items.every((item) => item.tagName === 'BUTTON' && item.type === 'button')).toBe(true)
    expect(items[1].getAttribute('aria-disabled')).toBe('true')
  })

  test('ArrowDown and Enter activate the selected action while skipping disabled entries', async () => {
    await act(async () => trigger().focus())
    await press(trigger(), 'ArrowDown')
    const menu = container.querySelector<HTMLElement>('[role="menu"]')!
    const items = container.querySelectorAll<HTMLElement>('[role="menuitem"]')
    expect(menu.getAttribute('aria-activedescendant')).toBe(items[0].id)
    await press(menu, 'ArrowDown')
    expect(menu.getAttribute('aria-activedescendant')).toBe(items[2].id)
    await press(menu, 'Enter')
    expect(dynamic).toHaveBeenCalledTimes(1)
    expect(providers).not.toHaveBeenCalled()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
  })

  test('Escape closes the menu and restores trigger focus without invoking an action', async () => {
    await act(async () => trigger().focus())
    await press(trigger(), 'ArrowDown')
    await press(container.querySelector('[role="menu"]')!, 'Escape')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
    expect(providers).not.toHaveBeenCalled()
    expect(dynamic).not.toHaveBeenCalled()
  })
})
