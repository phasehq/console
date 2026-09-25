import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  AgentAccessDenied,
  AgentEmpty,
  agentPrimaryAction,
} from '@/components/agents/AgentUI'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('agentPrimaryAction', () => {
  const action = 'create-button'

  test('puts the action top-right once the section has content', () => {
    expect(agentPrimaryAction(action, true)).toEqual({ header: action, empty: undefined })
  })

  test('moves the action into the empty state while the section is empty', () => {
    expect(agentPrimaryAction(action, false)).toEqual({ header: undefined, empty: action })
  })

  test('never renders the action in both slots', () => {
    for (const hasContent of [true, false]) {
      const placed = agentPrimaryAction(action, hasContent)
      expect([placed.header, placed.empty].filter(Boolean)).toHaveLength(1)
    }
  })

  test('places nothing when the viewer cannot perform the action', () => {
    expect(agentPrimaryAction(undefined, true)).toEqual({ header: undefined, empty: undefined })
    expect(agentPrimaryAction(undefined, false)).toEqual({ header: undefined, empty: undefined })
  })
})

describe('Agent section states', () => {
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

  test('an empty section offers its action exactly once, in the centre', async () => {
    const placed = agentPrimaryAction(
      <button type="button">Create an Agent</button>,
      false
    )
    await act(async () =>
      root.render(
        <AgentEmpty title="No Agents yet" subtitle="Set up your first Agent to get started.">
          {placed.empty ?? <></>}
        </AgentEmpty>
      )
    )

    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(container.textContent).toContain('No Agents yet')
    expect(container.textContent).toContain('Set up your first Agent to get started.')
    // "canvas" is an implementation detail of the Overview mesh, not user copy.
    expect(container.textContent?.toLowerCase()).not.toContain('canvas')
  })

  test('a viewer without permission gets the restricted screen and no action', async () => {
    await act(async () =>
      root.render(
        <AgentAccessDenied subtitle="You do not have permission to view Agents in this organisation." />
      )
    )

    expect(container.textContent).toContain('Access restricted')
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})
