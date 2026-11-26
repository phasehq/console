import React, { act, useState } from 'react'
import { createRoot, Root } from 'react-dom/client'

jest.mock('@/components/common/Avatar', () => ({ Avatar: () => null }))
jest.mock('@/components/users/RoleLabel', () => ({
  RoleLabel: ({ role }: { role: { name: string } }) => <span>{role.name}</span>,
}))

import { OrganisationMemberType, ServiceAccountType } from '@/apollo/graphql'
import { AccessScope, AppAccessPicker } from '@/components/apps/AppAccessPicker'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const ROLE = { id: 'developer', name: 'Developer' }
const member = (id: string, fullName: string) =>
  ({ id, fullName, email: `${id}@acme.example`, role: ROLE }) as OrganisationMemberType
const MEMBERS = [
  member('owner', 'Olive Owner'),
  member('zed', 'Zed Zhang'),
  member('alice', 'Alice Adams'),
  member('pending', 'Pat Pending'),
  ...Array.from({ length: 8 }, (_, at) => member(`m${at}`, `Member ${at}`)),
]
const SERVICE_ACCOUNTS = [{ id: 'ci', name: 'ci-deployer', role: ROLE }] as ServiceAccountType[]
const ENVS = [
  { key: 'dev', name: 'Development', color: '#22c55e' },
  { key: 'stg', name: 'Staging', color: '#eab308' },
  { key: 'prd', name: 'Production', color: '#ef4444' },
]
const EVERYWHERE = new Map([['owner', 'Their role gives access to every Environment']])
const UNAVAILABLE = new Map([['pending', 'Can be given access once they have signed in']])

// What the picker last handed back, written as it changes rather than during a render
let latest: AccessScope = new Map()
const Harness = () => {
  const [scope, setScope] = useState<AccessScope>(new Map())
  return (
    <AppAccessPicker
      members={MEMBERS}
      serviceAccounts={SERVICE_ACCOUNTS}
      environments={ENVS}
      scope={scope}
      everywhere={EVERYWHERE}
      unavailable={UNAVAILABLE}
      onChange={(next) => {
        latest = next
        setScope(next)
      }}
    />
  )
}

describe('AppAccessPicker', () => {
  let container: HTMLDivElement
  let root: Root

  const rows = () =>
    Array.from(container.querySelectorAll('[role="row"]')).filter((row) =>
      row.querySelector('[role="rowheader"]')
    )
  const rowOf = (name: string) =>
    rows().find((row) => row.querySelector('[role="rowheader"]')!.textContent!.includes(name))!
  const boxes = (row: Element) =>
    Array.from(row.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'))
  const states = (row: Element) => boxes(row).map((box) => box.getAttribute('aria-checked'))
  const header = () => container.querySelector('[role="row"]')!
  const click = (element: HTMLElement) => act(async () => element.click())
  const given = () =>
    Object.fromEntries([...latest].map(([id, envs]) => [id, [...envs].sort().join(',')]))
  const search = async (text: string) => {
    const input = container.querySelector('input')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  beforeEach(async () => {
    latest = new Map()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('lists the accounts that reach everything first, then the rest by name', () => {
    const names = rows().map(
      (row) => row.querySelector('[role="rowheader"] span span')!.textContent
    )
    expect(names.slice(0, 4)).toEqual(['Olive Owner', 'Alice Adams', 'Member 0', 'Member 1'])
    expect(names.at(-1)).toBe('Zed Zhang')
  })

  it('shows an account that reaches everything as fixed on, and one without keys as fixed off', () => {
    expect(states(rowOf('Olive Owner'))).toEqual(['true', 'true', 'true', 'true'])
    expect(boxes(rowOf('Olive Owner')).every((box) => box.disabled)).toBe(true)
    expect(rowOf('Olive Owner').textContent).toContain(
      'Their role gives access to every Environment'
    )

    expect(states(rowOf('Pat Pending'))).toEqual(['false', 'false', 'false', 'false'])
    expect(boxes(rowOf('Pat Pending')).every((box) => box.disabled)).toBe(true)
  })

  it('gives one environment from its cell, and all of them from the row', async () => {
    await click(boxes(rowOf('Alice Adams'))[2])
    expect(given()).toEqual({ alice: 'stg' })
    expect(states(rowOf('Alice Adams'))[0]).toBe('mixed')

    await click(boxes(rowOf('Alice Adams'))[0])
    expect(given()).toEqual({ alice: 'dev,prd,stg' })
    expect(states(rowOf('Alice Adams'))).toEqual(['true', 'true', 'true', 'true'])

    await click(boxes(rowOf('Alice Adams'))[0])
    expect(given()).toEqual({})
  })

  it('gives a column to every account that can be chosen, and not to the fixed ones', async () => {
    const staging = boxes(header())[2]
    await click(staging)
    const ids = Object.keys(given())
    expect(ids).toHaveLength(MEMBERS.length - 2)
    expect(ids).not.toContain('owner')
    expect(ids).not.toContain('pending')
    expect(Object.values(given()).every((envs) => envs === 'stg')).toBe(true)
    expect(staging.getAttribute('aria-checked')).toBe('true')

    await click(staging)
    expect(given()).toEqual({})
  })

  it('acts on the accounts shown while searching', async () => {
    await search('alice')
    expect(rows()).toHaveLength(1)
    await click(boxes(header())[0])
    expect(given()).toEqual({ alice: 'dev,prd,stg' })
  })

  it('counts who has access on each tab, and lists service accounts on theirs', async () => {
    await click(boxes(rowOf('Zed Zhang'))[1])
    const tabs = () =>
      Array.from(container.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)
    // The owner, who has everything, and Zed
    expect(tabs()).toEqual([`Members2/${MEMBERS.length}`, 'Service Accounts0/1'])

    await click(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1])
    expect(rows().map((row) => row.querySelector('[role="rowheader"]')!.textContent)).toEqual([
      'ci-deployerDeveloper',
    ])
    await click(boxes(rowOf('ci-deployer'))[3])
    expect(given()).toEqual({ zed: 'dev', ci: 'prd' })
    expect(tabs()).toEqual([`Members2/${MEMBERS.length}`, 'Service Accounts1/1'])
  })
})
