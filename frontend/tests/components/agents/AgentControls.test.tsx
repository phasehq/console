import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AgentSelect } from '@/components/agents/AgentSelect'
import { AgentRequestStatusFilter } from '@/components/agents/AgentRequestStatusFilter'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('Agent controls', () => {
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

  test('uses the Phase listbox surface and selects an enabled option', async () => {
    const onChange = jest.fn()
    await act(async () => {
      root.render(
        <AgentSelect
          id="test-agent-select"
          value="org"
          onChange={onChange}
          options={[
            { value: 'org', label: 'Organisation-owned' },
            { value: 'team', label: 'Platform Team' },
          ]}
        />
      )
    })

    expect(container.querySelector('select')).toBeNull()
    const trigger = container.querySelector<HTMLButtonElement>('#test-agent-select')!
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger.className).toContain('text-zinc-800')
    expect(trigger.className).toContain('dark:text-zinc-100')

    await act(async () => trigger.click())
    const teamOption = Array.from(container.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (option) => option.textContent?.includes('Platform Team')
    )!
    await act(async () => teamOption.click())

    expect(onChange).toHaveBeenCalledWith('team')
  })

  test('keeps disabled listbox options inert', async () => {
    const onChange = jest.fn()
    await act(async () => {
      root.render(
        <AgentSelect
          value="team"
          onChange={onChange}
          options={[
            { value: 'org', label: 'Organisation-owned', disabled: true },
            { value: 'team', label: 'Platform Team' },
          ]}
        />
      )
    })

    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    const organisationOption = Array.from(
      container.querySelectorAll<HTMLElement>('[role="option"]')
    ).find((option) => option.textContent?.includes('Organisation-owned'))!
    expect(organisationOption.getAttribute('aria-disabled')).toBe('true')
    await act(async () => organisationOption.click())

    expect(onChange).not.toHaveBeenCalled()
  })

  test('uses the log-style status menu with semantic colors', async () => {
    const onChange = jest.fn()
    await act(async () => {
      root.render(<AgentRequestStatusFilter value="pending" onChange={onChange} />)
    })

    const trigger = container.querySelector<HTMLButtonElement>(
      '[title="Filter Agent requests by status"]'
    )!
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.querySelector('.bg-emerald-500')).not.toBeNull()

    await act(async () => trigger.click())
    expect(container.querySelector('.text-amber-500')?.parentElement?.textContent).toContain(
      'Pending'
    )
    const approved = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    ).find((item) => item.textContent?.includes('Approved'))!
    await act(async () => approved.click())

    expect(onChange).toHaveBeenCalledWith('approved')
  })
})
