import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import {
  ConnectionPolicyBlocks,
  EditConnectionPolicyDialog,
  PolicyEditor,
  PolicySummary,
} from '@/components/agents/AgentAccessPolicy'
import { draftFromPolicy, rowEffect, type PolicyDraft } from '@/utils/agents/accessPolicy'
import { buttonNamed, settle, type } from './customConnectionTestKit'

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  SetAgentConnectionPolicyOp: 'set-policy',
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
}))
jest.mock('@/components/common/GenericDialog', () =>
  jest.requireActual('./customConnectionTestKit').dialogMock()
)
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const connection = (policy: unknown, serviceType = 'github') => ({
  id: 'connection-1',
  name: 'GitHub',
  serviceType,
  policy,
})

const MANAGED = [
  { id: 'secret_guard', locked: true, rules: [{ class: 'credential_minting', effect: 'block' }] },
]

describe('editing the access rules of a Connection', () => {
  let container: HTMLDivElement
  let root: Root
  let save: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    save = jest.fn().mockResolvedValue({ data: {} })
    ;(useMutation as jest.Mock).mockReturnValue([save, { loading: false }])
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const open = async (next: ReturnType<typeof connection>) => {
    await act(async () => root.render(<EditConnectionPolicyDialog connection={next} />))
    await act(async () => buttonNamed(container, 'Edit')!.click())
  }
  const group = (label: string) =>
    container.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="${label}"]`)!
  const choose = async (label: string, effect: string) =>
    act(async () =>
      Array.from(group(label).querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === effect)!
        .click()
    )
  const checked = (label: string) =>
    group(label).querySelector('[aria-checked="true"]')!.textContent
  const saveButton = () => buttonNamed(container, 'Save rules')!
  const submit = async () =>
    act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

  const options = (label: string) =>
    Array.from(group(label).querySelectorAll('button')).map((button) => button.textContent)
  const groups = () =>
    Array.from(container.querySelectorAll('[role="radiogroup"]')).map((element) =>
      element.getAttribute('aria-label')
    )
  const rows = ['Read calls', 'Create calls', 'Update calls', 'Delete calls']
  const addRule = async () => act(async () => buttonNamed(container, 'Add HTTP rule')!.click())
  const toggleMethod = async (rule: number, method: string) =>
    act(async () =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          `[aria-label="Methods for rule ${rule}"] button`
        )
      )
        .find((button) => button.textContent === method)!
        .click()
    )
  const path = (rule: number) =>
    container.querySelector<HTMLInputElement>(`input[aria-label="Path for rule ${rule}"]`)!

  test('a Default switch above four rows on Default, each saying what it covers', async () => {
    await open(connection(null))

    // The switch comes first, then one row per class; no Admin, no Everything else.
    expect(groups()).toEqual(['Default', ...rows])
    expect(checked('Default')).toBe('Allow')
    expect(options('Default')).toEqual(['Allow', 'Ask', 'Block'])
    for (const label of rows) {
      expect(checked(label)).toBe('Default · Allow')
      expect(options(label)).toEqual(['Default · Allow', 'Allow', 'Ask', 'Block'])
    }
    const text = container.textContent!
    for (const covers of ['GET, HEAD, OPTIONS', 'POST', 'PUT, PATCH and other methods', 'DELETE'])
      expect(text).toContain(covers)
    expect(text).not.toContain('Admin')
    expect(text).not.toContain('Everything else')
    // Managed rules are listed on the Connection, never offered as a choice.
    expect(text).not.toContain('Secret guard')
    expect(container.querySelector('[role="radiogroup"][aria-label*="Secret"]')).toBeNull()
  })

  test('rows follow Default until set, keep their own effect, and follow again on Default', async () => {
    await open(connection(null))
    const selected = (label: string) =>
      group(label).querySelector<HTMLElement>('[aria-checked="true"]')!

    await choose('Delete calls', 'Block')
    await choose('Default', 'Ask')
    // Rows on Default move with it and show it in its colour; a set row stays.
    for (const label of ['Read calls', 'Create calls', 'Update calls']) {
      expect(checked(label)).toBe('Default · Ask')
      expect(selected(label).className).toContain('amber')
    }
    expect(checked('Delete calls')).toBe('Block')

    // Set to the same effect as Default, a row no longer follows it.
    await choose('Read calls', 'Ask')
    await choose('Default', 'Block')
    expect(checked('Read calls')).toBe('Ask')
    expect(checked('Create calls')).toBe('Default · Block')
    expect(selected('Create calls').className).toContain('red')

    // Default makes it follow again.
    await choose('Read calls', 'Default · Block')
    await choose('Default', 'Allow')
    expect(checked('Read calls')).toBe('Default · Allow')
    expect(checked('Update calls')).toBe('Default · Allow')
    expect(checked('Delete calls')).toBe('Block')

    await submit()
    expect(save.mock.calls[0][0].variables.policy).toEqual({
      version: 1,
      default: 'allow',
      rules: [{ class: 'delete', effect: 'block' }],
    })
  })

  test('Save stays disabled until something changes', async () => {
    await open(
      connection({ version: 1, default: 'allow', rules: [{ class: 'delete', effect: 'block' }] })
    )

    expect(checked('Delete calls')).toBe('Block')
    expect(saveButton().disabled).toBe(true)
    await choose('Create calls', 'Ask')
    expect(saveButton().disabled).toBe(false)
    await choose('Create calls', 'Default · Allow')
    expect(saveButton().disabled).toBe(true)
  })

  test('saves the rules as one policy, class rules in a fixed order', async () => {
    await open(connection(null))
    await choose('Delete calls', 'Block')
    await choose('Create calls', 'Ask')
    await choose('Default', 'Ask')
    await submit()

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          connectionId: 'connection-1',
          policy: {
            version: 1,
            default: 'ask',
            rules: [
              { class: 'create', effect: 'ask' },
              { class: 'delete', effect: 'block' },
            ],
          },
        },
      })
    )
  })

  test('every row back on Default, with Default at Allow, saves the policy as cleared', async () => {
    await open(
      connection({ version: 1, default: 'allow', rules: [{ class: 'delete', effect: 'block' }] })
    )
    await choose('Delete calls', 'Default · Allow')
    await submit()

    expect(save.mock.calls[0][0].variables).toEqual({ connectionId: 'connection-1', policy: null })
  })

  test('a policy that names credential_minting is never sent back with it', async () => {
    await open(
      connection({
        version: 1,
        default: 'allow',
        rules: [
          { class: 'credential_minting', effect: 'allow' },
          { class: 'delete', effect: 'block' },
        ],
      })
    )
    await choose('Update calls', 'Ask')
    await submit()

    const sent = JSON.stringify(save.mock.calls[0][0].variables)
    expect(sent).not.toContain('credential_minting')
    expect(sent).toContain('"update"')
  })

  test('HTTP rules: add, fill in, save, remove', async () => {
    await open(connection(null))
    expect(container.textContent).toContain(
      'A call that matches a rule gets the stricter of the rule and its row.'
    )
    await addRule()
    // An empty rule cannot be saved.
    expect(saveButton().disabled).toBe(true)
    expect(container.textContent).toContain('choose a method or enter a path')
    expect(path(1).placeholder).toBe('/repos/*/*/issues')

    await toggleMethod(1, 'POST')
    await toggleMethod(1, 'DELETE')
    await type(path(1), '/repos/*/*/issues')
    // Allow is not offered: the stricter of rule and row wins, so it would change nothing.
    expect(options('Effect for rule 1')).toEqual(['Ask', 'Block'])
    expect(checked('Effect for rule 1')).toBe('Block')
    expect(saveButton().disabled).toBe(false)
    await submit()
    expect(save.mock.calls[0][0].variables.policy).toEqual({
      version: 1,
      default: 'allow',
      rules: [
        { match: { methods: ['POST', 'DELETE'], path: '/repos/*/*/issues' }, effect: 'block' },
      ],
    })

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Remove rule 1"]')!.click()
    )
    expect(path(1)).toBeNull()
  })

  test('a path must begin with a slash', async () => {
    await open(connection(null))
    await addRule()
    await type(path(1), 'v1')
    expect(container.textContent).toContain('begins with "/"')
    expect(saveButton().disabled).toBe(true)
    expect(path(1).maxLength).toBe(1024)
  })

  test('a rule that can never change an answer says so, and does not show its effect in colour', async () => {
    await open(
      connection({ version: 1, default: 'allow', rules: [{ class: 'delete', effect: 'block' }] })
    )
    await addRule()
    await toggleMethod(1, 'DELETE')
    await type(path(1), '/repos/*')
    const effect = () =>
      group('Effect for rule 1').querySelector<HTMLElement>('[aria-checked="true"]')!

    expect(container.textContent).toContain('No effect: Delete is already Block.')
    expect(effect().className).not.toContain('red')

    // GET falls under Read, which allows: now the rule blocks something.
    await toggleMethod(1, 'GET')
    expect(container.textContent).not.toContain('No effect')
    expect(effect().className).toContain('red')

    await choose('Effect for rule 1', 'Ask')
    expect(container.textContent).not.toContain('No effect')
    await choose('Read calls', 'Block')
    expect(container.textContent).toContain('No effect: Read and Delete are already Block.')
  })

  test('a stored Allow rule shows with its note and can be changed or removed, never chosen', async () => {
    await open(
      connection({
        version: 1,
        default: 'allow',
        rules: [
          { class: 'delete', effect: 'block' },
          { match: { methods: ['GET'], path: '/repos/*' }, effect: 'allow' },
        ],
      })
    )
    const effect = () =>
      group('Effect for rule 1').querySelector<HTMLElement>('[aria-checked="true"]')!
    expect(path(1).value).toBe('/repos/*')
    expect(options('Effect for rule 1')).toEqual(['Allow', 'Ask', 'Block'])
    expect(checked('Effect for rule 1')).toBe('Allow')
    expect(effect().className).toContain('bg-neutral-500/20')
    expect(container.textContent).toContain(
      'No effect: a rule can only make calls stricter. Choose Ask or Block, or remove it.'
    )

    // Once changed, Allow is no longer offered.
    await choose('Effect for rule 1', 'Ask')
    expect(options('Effect for rule 1')).toEqual(['Ask', 'Block'])
    expect(container.textContent).not.toContain('No effect')

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Remove rule 1"]')!.click()
    )
    expect(path(1)).toBeNull()
    await submit()
    expect(save.mock.calls[0][0].variables.policy).toEqual({
      version: 1,
      default: 'allow',
      rules: [{ class: 'delete', effect: 'block' }],
    })
  })

  test('a saved policy opens again just as it was shown', async () => {
    await open(connection(null))
    await choose('Default', 'Block')
    await choose('Read calls', 'Allow')
    await choose('Delete calls', 'Block')
    await addRule()
    await toggleMethod(1, 'GET')
    await type(path(1), '/repos/*/*/issues')
    await choose('Effect for rule 1', 'Ask')
    await submit()
    const policy = save.mock.calls[0][0].variables.policy
    // The Ask rule is weaker than Default, so the rows on Default are saved as rules.
    expect(policy).toEqual({
      version: 1,
      default: 'block',
      rules: [
        { class: 'read', effect: 'allow' },
        { class: 'create', effect: 'block' },
        { class: 'update', effect: 'block' },
        { class: 'delete', effect: 'block' },
        { match: { methods: ['GET'], path: '/repos/*/*/issues' }, effect: 'ask' },
      ],
    })

    await act(async () => root.render(<div />))
    await open(connection(policy))
    expect(checked('Default')).toBe('Block')
    expect(rows.map((label) => checked(label))).toEqual([
      'Allow',
      'Default · Block',
      'Default · Block',
      // Set to the effect Default has, it reads back on Default.
      'Default · Block',
    ])
    expect(path(1).value).toBe('/repos/*/*/issues')
    expect(checked('Effect for rule 1')).toBe('Ask')
    expect(saveButton().disabled).toBe(true)
  })

  test('a failed save keeps the editor and says why', async () => {
    save.mockRejectedValueOnce(new Error('policy.rules[0]: no good'))
    await open(connection(null))
    await choose('Read calls', 'Block')
    await submit()
    await settle(() => container.textContent!.includes('no good'))
    expect(container.textContent).toContain('policy.rules[0]: no good')
    expect(checked('Read calls')).toBe('Block')
  })
})

describe('the editor on its own', () => {
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

  test('changing Default moves the rows on Default and leaves the HTTP rules alone', async () => {
    let draft: PolicyDraft = draftFromPolicy({
      version: 1,
      default: 'allow',
      rules: [
        { class: 'delete', effect: 'block' },
        { match: { path: '/x' }, effect: 'ask' },
      ],
    })
    const render = () => (
      <PolicyEditor
        draft={draft}
        onChange={(next) => {
          draft = next
        }}
      />
    )
    await act(async () => root.render(render()))
    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="Default"] button'))
        .find((button) => button.textContent === 'Block')!
        .click()
    )
    expect(draft.default).toBe('block')
    expect(draft.classes.read).toBe('default')
    expect(rowEffect(draft, 'read')).toBe('block')
    expect(draft.classes.delete).toBe('block')
    expect(draft.advanced).toHaveLength(1)
  })
})

describe('the access blocks in the details of a Connection', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(useMutation as jest.Mock).mockReturnValue([jest.fn(), { loading: false }])
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const render = async (props: Partial<React.ComponentProps<typeof ConnectionPolicyBlocks>> = {}) =>
    act(async () =>
      root.render(
        <ConnectionPolicyBlocks
          connection={{
            ...connection(null),
            takesPolicy: true,
            managedPolicies: MANAGED,
          }}
          canEdit
          {...props}
        />
      )
    )

  test('Managed by Phase comes first: a locked Secret guard row that cannot be changed', async () => {
    await render()
    const headings = Array.from(container.querySelectorAll('h4')).map((h) => h.textContent)
    // The editor's own headings follow, inside the Edit dialog.
    expect(headings.slice(0, 2)).toEqual(['Managed by Phase', 'Access rules'])
    const guard = container.querySelector('[data-managed-policy="secret_guard"]')!
    expect(guard.textContent).toContain('Secret guard')
    expect(guard.textContent).toContain('mint new credentials or assume another identity')
    expect(guard.textContent).toContain('cannot be turned off')
    expect(guard.querySelector('button, input, [role="radiogroup"]')).toBeNull()
  })

  test('says credential-minting calls are blocked only when the server lists that rule', async () => {
    await render({
      connection: {
        ...connection(null),
        takesPolicy: true,
        managedPolicies: [{ id: 'secret_guard', locked: true, rules: [] }],
      },
    })
    const guard = container.querySelector('[data-managed-policy="secret_guard"]')!
    expect(guard.textContent).toContain('Secret guard')
    expect(guard.textContent).not.toContain('mint')

    await render({ connection: { ...connection(null), takesPolicy: true, managedPolicies: [] } })
    expect(container.textContent).not.toContain('mint')
    expect(container.textContent).not.toContain('Managed by Phase')
  })

  test('a Connection that takes no rules shows neither block', async () => {
    await render({
      connection: { ...connection(null), takesPolicy: false, managedPolicies: [] },
    })
    expect(container.textContent).toBe('')
  })

  test('the Connection own rules read in compact form', async () => {
    await render({
      connection: {
        ...connection({
          version: 1,
          default: 'ask',
          rules: [
            { class: 'read', effect: 'allow' },
            { class: 'delete', effect: 'block' },
            { match: { methods: ['POST'], path: '/v1/charges/*' }, effect: 'block' },
            { match: { methods: ['DELETE'], path: '/v1/charges/*' }, effect: 'block' },
          ],
        }),
        takesPolicy: true,
        managedPolicies: MANAGED,
      },
    })
    const rules = container.querySelector('[aria-label="Access rules in force"]')!
    expect(Array.from(rules.querySelectorAll('li')).map((item) => item.textContent)).toEqual([
      'DefaultAsk',
      'Read GET, HEAD, OPTIONSAllow',
      'Create POSTDefault · Ask',
      'Update PUT, PATCH and other methodsDefault · Ask',
      'Delete DELETEBlock',
      'POST /v1/charges/*Block',
      // Delete already blocks every DELETE.
      'DELETE /v1/charges/*Block · No effect',
    ])
  })

  test('Edit is for members who can update Connections', async () => {
    await render()
    expect(buttonNamed(container, 'Edit')).toBeDefined()
    await render({ canEdit: false })
    expect(buttonNamed(container, 'Edit')).toBeUndefined()
    expect(container.querySelector('[aria-label="Access rules in force"]')).not.toBeNull()
  })
})

describe('the summary on a collapsed row', () => {
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

  test('reads in the words an app Connection uses, and says nothing when nothing is stopped', async () => {
    await act(async () =>
      root.render(
        <PolicySummary
          policy={{
            version: 1,
            default: 'allow',
            rules: [
              { class: 'delete', effect: 'block' },
              { match: { methods: ['POST'], path: '/v1/charges/*' }, effect: 'ask' },
            ],
          }}
        />
      )
    )
    expect(container.textContent).toBe(
      'Reads, create and update allowed, delete blocked · 1 HTTP rule'
    )
    await act(async () =>
      root.render(
        <PolicySummary
          policy={{ version: 1, default: 'ask', rules: [{ class: 'read', effect: 'allow' }] }}
        />
      )
    )
    expect(container.textContent).toBe('Reads allowed, writes ask')
    for (const policy of [
      {},
      { version: 1, default: 'allow', rules: [{ class: 'read', effect: 'allow' }] },
    ]) {
      await act(async () => root.render(<PolicySummary policy={policy} />))
      expect(container.textContent).toBe('')
    }
  })
})
