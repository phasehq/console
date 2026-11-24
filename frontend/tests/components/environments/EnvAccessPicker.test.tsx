import { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { OrganisationMemberType } from '@/apollo/graphql'
import { EnvAccessPicker } from '@/components/environments/EnvAccessPicker'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const NAMES = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ida', 'Jo']
const members = NAMES.map(
  (name, index) =>
    ({
      id: `m${index}`,
      fullName: `${name} ${index < 2 ? 'Backend' : 'Frontend'}`,
      email: `${name.toLowerCase()}@example.com`,
    }) as OrganisationMemberType
)

describe('EnvAccessPicker', () => {
  let container: HTMLDivElement
  let root: Root
  const onChange = jest.fn()

  const render = async (selectedIds: string[], locked: string[] = []) => {
    await act(async () =>
      root.render(
        <EnvAccessPicker
          members={members}
          serviceAccounts={[]}
          selectedIds={new Set(selectedIds)}
          lockedReasons={new Map(locked.map((id) => [id, 'Their role gives access']))}
          onChange={onChange}
        />
      )
    )
  }
  const search = async (text: string) => {
    const input = container.querySelector('input')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === label)
  const lastChange = () => [...(onChange.mock.calls.at(-1)![0] as Set<string>)].sort()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    jest.clearAllMocks()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('selects every account when nothing is filtered', async () => {
    await render([])
    await act(async () => button('Select all')!.click())
    expect(lastChange()).toHaveLength(NAMES.length)
  })

  it('selects only the accounts a search shows, keeping what was ticked before', async () => {
    await render(['m9'])
    await search('backend')
    expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(2)

    await act(async () => button('Select all')!.click())
    expect(lastChange()).toEqual(['m0', 'm1', 'm9'])
  })

  it('clears only the accounts a search shows', async () => {
    await render(['m0', 'm1', 'm5'])
    await search('backend')

    await act(async () => button('Clear all')!.click())
    expect(lastChange()).toEqual(['m5'])
  })

  it('leaves accounts whose access is not a choice out of it', async () => {
    await render([], ['m0'])
    await search('backend')
    // One open row left: nothing to select "all" of
    expect(button('Select all')).toBeUndefined()
  })
})
