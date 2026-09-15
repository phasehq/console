import React, { act, useState } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { AccessTemplateSelector } from '@/components/access/AccessTemplateSelector'
import { PermissionPolicy } from '@/utils/access/permissions'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
}

const AGENT_ACTIONS = ['create', 'read', 'update', 'delete']

const AgentAccessHarness = ({ initialActions = [] }: { initialActions?: string[] }) => {
  const [rolePolicy, setRolePolicy] = useState<PermissionPolicy | null>({
    permissions: { Agents: initialActions },
    app_permissions: {},
    global_access: false,
  })

  return (
    <>
      <AccessTemplateSelector
        resource="Agents"
        rolePolicy={rolePolicy!}
        setRolePolicy={setRolePolicy}
        allowedActions={AGENT_ACTIONS}
      />
      <output>{rolePolicy!.permissions.Agents.join(',')}</output>
    </>
  )
}

describe('AccessTemplateSelector', () => {
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

  test('uses standard CRUD when Full access is selected for Agents', async () => {
    await act(async () => root.render(<AgentAccessHarness />))

    const trigger = container.querySelector('[aria-haspopup="listbox"]')
    expect(trigger).not.toBeNull()

    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const fullAccess = Array.from(document.querySelectorAll('[role="option"]')).find(
      (option) => option.textContent?.trim() === 'Full access'
    )
    expect(fullAccess).toBeDefined()

    await act(async () => {
      fullAccess!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.querySelector('output')?.textContent).toBe('create,read,update,delete')
  })

  test('recognises the backend Agent action set as Full access', async () => {
    await act(async () => root.render(<AgentAccessHarness initialActions={AGENT_ACTIONS} />))

    expect(container.querySelector('[aria-haspopup="listbox"]')?.textContent).toContain(
      'Full access'
    )
  })
})
