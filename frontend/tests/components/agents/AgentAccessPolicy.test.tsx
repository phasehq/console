import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import { GrantPolicyDialog, PolicyEditor } from '@/components/agents/AgentAccessPolicy'
import { draftFromPolicy, type PolicyDraft } from '@/utils/agents/accessPolicy'
import { buttonNamed, settle, type } from './customConnectionTestKit'

jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  SetAgentWorkflowGrantPolicyOp: 'set-policy',
  RemoveAgentWorkflowGrantAllowOp: 'remove-allow',
}))
jest.mock('@/components/agents/AgentDialogs', () => ({
  ConfirmAgentAction: ({ title, description, triggerProps, onConfirm }: any) => (
    <div data-confirm={title}>
      <button type="button" aria-label={triggerProps['aria-label']} data-variant="trigger" />
      <p>{description}</p>
      <button type="button" aria-label={`Confirm ${title}`} onClick={() => onConfirm()} />
    </div>
  ),
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

const grant = (policy: unknown, temporaryAllows: unknown = []) => ({
  id: 'grant-1',
  policy,
  temporaryAllows,
  connection: { name: 'GitHub' },
})

describe('access rules on a grant', () => {
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

  const open = async (nextGrant: ReturnType<typeof grant>) => {
    await act(async () => root.render(<GrantPolicyDialog grant={nextGrant} />))
    await act(async () => buttonNamed(container, 'Access rules')!.click())
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

  test('one row per class, Everything else, and the secret guard locked on', async () => {
    await open(grant(null))

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
    expect(container.textContent).toContain('Secret guard')
    expect(container.textContent).toContain('always blocked')
    expect(container.textContent).toContain('cannot be turned off')
    // The guard is shown, not a choice: it has no group of buttons.
    expect(container.querySelector('[role="radiogroup"][aria-label*="Secret"]')).toBeNull()
  })

  test('Save stays disabled until something changes', async () => {
    await open(
      grant({ version: 1, default: 'allow', rules: [{ class: 'delete', effect: 'block' }] })
    )

    expect(checked('Delete calls')).toBe('Block')
    expect(saveButton().disabled).toBe(true)
    await choose('Create calls', 'Ask')
    expect(saveButton().disabled).toBe(false)
    await choose('Create calls', 'Allow')
    expect(saveButton().disabled).toBe(true)
  })

  test('saves the rules as one policy, class rules in a fixed order', async () => {
    await open(grant(null))
    await choose('Delete calls', 'Block')
    await choose('Create calls', 'Ask')
    await submit()

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          grantId: 'grant-1',
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
      grant({ version: 1, default: 'allow', rules: [{ class: 'delete', effect: 'block' }] })
    )
    await choose('Delete calls', 'Allow')
    await submit()

    expect(save.mock.calls[0][0].variables).toEqual({ grantId: 'grant-1', policy: null })
  })

  test('a policy that names credential_minting is never sent back with it', async () => {
    await open(
      grant({
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
    await open(grant(null))
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
    await open(grant(null))
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

  test('shows temporary allows read-only with when each ends', async () => {
    const soon = new Date(Date.now() + 3 * 3600_000 + 60_000).toISOString()
    const past = new Date(Date.now() - 3600_000).toISOString()
    await open(
      grant(null, [
        { id: 'a', match: { methods: ['DELETE'], path: '/repos/acme/x' }, expiresAt: soon },
        { id: 'b', class: 'read', expiresAt: past },
      ])
    )

    const list = container.querySelector('[aria-label="Temporary allows"]')!
    expect(list.textContent).toContain('DELETE /repos/acme/x')
    expect(list.textContent).toContain('ends in 3 hours')
    // Expired ones are not shown, and none can be edited here.
    expect(list.textContent).not.toContain('Read calls')
    // Expired ones are not removable either.
    expect(list.querySelectorAll('[data-confirm]')).toHaveLength(1)
  })

  test('each temporary allow can be removed early, after a confirmation', async () => {
    const soon = new Date(Date.now() + 3600_000).toISOString()
    const remove = jest.fn().mockResolvedValue({ data: {} })
    ;(useMutation as jest.Mock).mockImplementation((document: string) => [
      document === 'remove-allow' ? remove : save,
      { loading: false },
    ])
    await open(
      grant(null, [
        { id: 'allow-1', match: { methods: ['DELETE'], path: '/repos/acme/x' }, expiresAt: soon },
      ])
    )

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove temporary allow for DELETE /repos/acme/x"]'
    )
    expect(trigger).not.toBeNull()
    expect(remove).not.toHaveBeenCalled()

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Confirm Remove temporary allow"]')!
        .click()
    )

    expect(remove).toHaveBeenCalledWith({
      variables: { grantId: 'grant-1', allowId: 'allow-1' },
      refetchQueries: ['GetAgentDetail'],
      awaitRefetchQueries: true,
    })
  })

  test('the editor shows allows without a remove control unless given a way to remove them', async () => {
    const soon = new Date(Date.now() + 3600_000).toISOString()
    const allows = [{ id: 'a', class: 'read' as const, expiresAt: soon, requestId: null }]
    await act(async () =>
      root.render(
        <PolicyEditor draft={draftFromPolicy(null)} onChange={() => {}} temporaryAllows={allows} />
      )
    )
    expect(container.textContent).toContain('Read calls')
    expect(container.querySelector('[data-confirm]')).toBeNull()
  })

  test('no temporary allows, no section', async () => {
    await open(grant(null))
    expect(container.querySelector('[aria-label="Temporary allows"]')).toBeNull()
  })

  test('a failed save keeps the editor and says why', async () => {
    save.mockRejectedValueOnce(new Error('policy.rules[0]: no good'))
    await open(grant(null))
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
