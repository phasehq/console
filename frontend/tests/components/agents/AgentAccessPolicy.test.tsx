import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import {
  ConnectionPolicyBlocks,
  EditConnectionPolicyDialog,
  PolicyEditor,
  PolicySummary,
} from '@/components/agents/AgentAccessPolicy'
import { draftFromPolicy, type PolicyDraft } from '@/utils/agents/accessPolicy'
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

  test('one row per class and Everything else; the secret guard is not part of the editor', async () => {
    await open(connection(null))

    for (const label of [
      'Read calls',
      'Create calls',
      'Update calls',
      'Delete calls',
      'Admin calls',
      'Everything else',
    ])
      expect(checked(label)).toBe('Allow')
    expect(
      Array.from(group('Read calls').querySelectorAll('button')).map((b) => b.textContent)
    ).toEqual(['Allow', 'Ask', 'Block'])
    // Managed rules are listed on the Connection, never offered as a choice.
    expect(container.textContent).not.toContain('Secret guard')
    expect(container.querySelector('[role="radiogroup"][aria-label*="Secret"]')).toBeNull()
  })

  test('Save stays disabled until something changes', async () => {
    await open(
      connection({ version: 1, default: 'allow', rules: [{ class: 'delete', effect: 'block' }] })
    )

    expect(checked('Delete calls')).toBe('Block')
    expect(saveButton().disabled).toBe(true)
    await choose('Create calls', 'Ask')
    expect(saveButton().disabled).toBe(false)
    await choose('Create calls', 'Allow')
    expect(saveButton().disabled).toBe(true)
  })

  test('saves the rules as one policy, class rules in a fixed order', async () => {
    await open(connection(null))
    await choose('Delete calls', 'Block')
    await choose('Create calls', 'Ask')
    await submit()

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          connectionId: 'connection-1',
          policy: {
            version: 1,
            default: 'allow',
            rules: [
              { class: 'create', effect: 'ask' },
              { class: 'delete', effect: 'block' },
            ],
          },
        },
      })
    )
  })

  test('putting every row back to the default saves the policy as cleared', async () => {
    await open(
      connection({ version: 1, default: 'allow', rules: [{ class: 'delete', effect: 'block' }] })
    )
    await choose('Delete calls', 'Allow')
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
    await choose('Admin calls', 'Ask')
    await submit()

    const sent = JSON.stringify(save.mock.calls[0][0].variables)
    expect(sent).not.toContain('credential_minting')
    expect(sent).toContain('"admin"')
  })

  test('rules by method and path: add, fill in, save, remove', async () => {
    await open(connection(null))
    await act(async () => buttonNamed(container, 'Advanced: rules by method and path')!.click())
    await act(async () => buttonNamed(container, 'Add rule')!.click())
    // An empty rule cannot be saved.
    expect(saveButton().disabled).toBe(true)
    expect(container.textContent).toContain('choose a method or enter a path')

    await act(async () =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>('[aria-label="Methods for rule 1"] button')
      )
        .find((button) => button.textContent === 'DELETE')!
        .click()
    )
    await type(
      container.querySelector<HTMLInputElement>('input[aria-label="Path for rule 1"]')!,
      '/v1/x/*'
    )
    expect(saveButton().disabled).toBe(false)
    await submit()
    expect(save.mock.calls[0][0].variables.policy).toEqual({
      version: 1,
      default: 'allow',
      rules: [{ match: { methods: ['DELETE'], path: '/v1/x/*' }, effect: 'block' }],
    })

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Remove rule 1"]')!.click()
    )
    expect(container.querySelector('input[aria-label="Path for rule 1"]')).toBeNull()
  })

  test('a path must begin with a slash', async () => {
    await open(connection(null))
    await act(async () => buttonNamed(container, 'Advanced: rules by method and path')!.click())
    await act(async () => buttonNamed(container, 'Add rule')!.click())
    await type(
      container.querySelector<HTMLInputElement>('input[aria-label="Path for rule 1"]')!,
      'v1'
    )
    expect(container.textContent).toContain('begins with "/"')
    expect(saveButton().disabled).toBe(true)
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Path for rule 1"]')!.maxLength
    ).toBe(1024)
  })

  test('rules by AWS action are offered only on an AWS Connection', async () => {
    await open(connection(null, 'github'))
    await act(async () => buttonNamed(container, 'Advanced: rules by method and path')!.click())
    expect(container.textContent).not.toContain('Rules by AWS action')
    expect(buttonNamed(container, 'Add AWS action rule')).toBeUndefined()

    await act(async () => root.render(<div />))
    await open(connection(null, 'aws'))
    await act(async () =>
      buttonNamed(container, 'Advanced: rules by method, path and AWS action')!.click()
    )
    expect(container.textContent).toContain('Rules by AWS action')
    expect(buttonNamed(container, 'Add AWS action rule')).toBeDefined()
  })

  test('an AWS action rule: validated, capped at 193 characters, saved as an operation', async () => {
    await open(connection(null, 'aws'))
    await act(async () =>
      buttonNamed(container, 'Advanced: rules by method, path and AWS action')!.click()
    )
    await act(async () => buttonNamed(container, 'Add AWS action rule')!.click())
    const input = () =>
      container.querySelector<HTMLInputElement>('input[aria-label="AWS action for rule 1"]')!
    expect(input().maxLength).toBe(193)
    expect(container.textContent).toContain('enter an AWS action')
    expect(saveButton().disabled).toBe(true)

    await type(input(), 'ec2:Terminate*')
    expect(container.textContent).toContain('one exact action as service:Action')
    expect(saveButton().disabled).toBe(true)

    await type(input(), 'ec2:TerminateInstances')
    expect(saveButton().disabled).toBe(false)
    expect(checked('Effect for AWS action rule 1')).toBe('Block')
    await choose('Effect for AWS action rule 1', 'Ask')
    await submit()

    expect(save.mock.calls[0][0].variables).toEqual({
      connectionId: 'connection-1',
      policy: {
        version: 1,
        default: 'allow',
        rules: [{ operation: 'ec2:TerminateInstances', effect: 'ask' }],
      },
    })

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Remove AWS action rule 1"]')!.click()
    )
    expect(input()).toBeNull()
  })

  test('saved AWS action rules come back into the editor', async () => {
    await open(
      connection(
        {
          version: 1,
          default: 'allow',
          rules: [{ operation: 's3:DeleteBucket', effect: 'block' }],
        },
        'aws'
      )
    )
    // Rules exist, so Advanced starts open.
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="AWS action for rule 1"]')!.value
    ).toBe('s3:DeleteBucket')
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

  test('changing Everything else moves the rows that follow it', async () => {
    let draft: PolicyDraft = draftFromPolicy(null)
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
      Array.from(
        container.querySelectorAll<HTMLButtonElement>('[aria-label="Everything else"] button')
      )
        .find((button) => button.textContent === 'Block')!
        .click()
    )
    expect(draft.default).toBe('block')
    expect(draft.classes.read).toBe('block')
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
    expect(headings).toEqual(['Managed by Phase', 'Access rules'])
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
        ...connection(
          {
            version: 1,
            default: 'ask',
            rules: [
              { class: 'read', effect: 'allow' },
              { class: 'delete', effect: 'block' },
              { match: { methods: ['POST'], path: '/v1/charges/*' }, effect: 'ask' },
              { operation: 'ec2:TerminateInstances', effect: 'block' },
            ],
          },
          'aws'
        ),
        takesPolicy: true,
        managedPolicies: MANAGED,
      },
    })
    const rules = container.querySelector('[aria-label="Access rules in force"]')!
    const row = (label: string) =>
      Array.from(rules.querySelectorAll('li')).find((item) => item.textContent!.includes(label))!
    expect(row('Read').textContent).toContain('Allow')
    expect(row('Delete').textContent).toContain('Block')
    // A class with no rule of its own follows Everything else.
    expect(row('Create').textContent).toContain('Ask')
    expect(row('Everything else').textContent).toContain('Ask')
    expect(row('POST /v1/charges/*').textContent).toContain('Ask')
    expect(row('AWS action ec2:TerminateInstances').textContent).toContain('Block')
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

  test('says how much is restricted, and nothing when nothing is', async () => {
    await act(async () =>
      root.render(
        <PolicySummary
          policy={{
            version: 1,
            default: 'allow',
            rules: [
              { class: 'delete', effect: 'block' },
              { operation: 'ec2:TerminateInstances', effect: 'ask' },
            ],
          }}
        />
      )
    )
    expect(container.textContent).toBe('1 blocked, 1 ask')
    await act(async () => root.render(<PolicySummary policy={{}} />))
    expect(container.textContent).toBe('')
  })
})
