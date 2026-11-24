import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import {
  AgentRequestReviewers,
  MAX_REQUEST_REVIEWERS,
  type AgentRequestReviewer,
} from '@/components/agents/AgentRequestReviewers'

jest.mock('@/graphql/queries/agents/getAgentRequestReviewerCandidates.gql', () => ({
  GetAgentRequestReviewerCandidates: Symbol('GetAgentRequestReviewerCandidates'),
}))
jest.mock('@/graphql/mutations/agents/setAgentRequestReviewers.gql', () => ({
  SetAgentRequestReviewersOp: Symbol('SetAgentRequestReviewersOp'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@headlessui/react', () => {
  const Dialog = Object.assign(({ children }: any) => <div>{children}</div>, {
    Panel: ({ children }: any) => <div>{children}</div>,
    Title: ({ children }: any) => <div>{children}</div>,
  })
  const Transition = Object.assign(({ children, show }: any) => (show ? <>{children}</> : null), {
    Child: ({ children }: any) => <>{children}</>,
  })
  return { Dialog, Transition }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const person = (id: string, email: string, role = 'Manager') => ({
  id,
  fullName: null,
  email,
  avatarUrl: null,
  role: { id: `role-${role}`, name: role, description: '', permissions: '{}', color: '' },
})
const asked = (member: ReturnType<typeof person>): AgentRequestReviewer => ({
  id: `reviewer-${member.id}`,
  member,
})

describe('AgentRequestReviewers', () => {
  let container: HTMLDivElement
  let root: Root
  let setReviewers: jest.Mock
  let candidates: ReturnType<typeof person>[]

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    candidates = [person('m-1', 'ada@example.com', 'Owner'), person('m-2', 'bo@example.com')]
    setReviewers = jest.fn().mockResolvedValue({})
    ;(useMutation as jest.Mock).mockReturnValue([setReviewers, { loading: false }])
    ;(useQuery as jest.Mock).mockImplementation((_query: unknown, options: any) => ({
      data: options?.skip ? undefined : { agentRequestReviewerCandidates: candidates },
      loading: false,
      error: undefined,
    }))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const render = async (reviewers: AgentRequestReviewer[], pending = true) =>
    act(async () =>
      root.render(
        <AgentRequestReviewers
          requestId="request-1"
          organisationId="org-1"
          reviewers={reviewers}
          pending={pending}
        />
      )
    )
  const button = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === label
    )
  const row = (email: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')).find((element) =>
      element.textContent?.includes(email)
    )!
  const open = async (label: string) => act(async () => button(label)!.click())

  test('says when no one was asked, and offers to ask while the request is pending', async () => {
    await render([])

    expect(container.textContent).toContain('No one asked')
    expect(button('Ask for review')).toBeDefined()
    // The candidates are read only once the dialog opens.
    expect((useQuery as jest.Mock).mock.calls.at(-1)[1]).toMatchObject({
      variables: { organisationId: 'org-1', requestId: 'request-1' },
      skip: true,
    })
  })

  test('lists who was asked; a resolved request keeps the list with nothing to change', async () => {
    await render([asked(candidates[1])], false)

    expect(container.querySelector('[aria-label="Reviewers"]')!.textContent).toContain(
      'bo@example.com'
    )
    expect(button('Edit')).toBeUndefined()
    expect(button('Ask for review')).toBeUndefined()
  })

  test('asks the members ticked among those who could approve', async () => {
    await render([])
    await open('Ask for review')

    expect((useQuery as jest.Mock).mock.calls.at(-1)[1].skip).toBe(false)
    expect(row('ada@example.com').getAttribute('aria-checked')).toBe('false')
    expect(button('Save')!.disabled).toBe(true)

    await act(async () => row('ada@example.com').click())
    await act(async () => button('Save')!.click())

    expect(setReviewers).toHaveBeenCalledWith({
      variables: { requestId: 'request-1', memberIds: ['m-1'] },
    })
    expect(toast.success).toHaveBeenCalledWith('Reviewers saved')
  })

  test('starts from who was asked, and keeps someone who can no longer approve until unticked', async () => {
    const former = person('m-9', 'former@example.com')
    await render([asked(candidates[1]), asked(former)])
    await open('Edit')

    expect(row('bo@example.com').getAttribute('aria-checked')).toBe('true')
    expect(row('former@example.com').getAttribute('aria-checked')).toBe('true')

    await act(async () => row('former@example.com').click())
    await act(async () => button('Save')!.click())

    expect(setReviewers).toHaveBeenCalledWith({
      variables: { requestId: 'request-1', memberIds: ['m-2'] },
    })
  })

  test('says so when nobody can approve the request', async () => {
    candidates = []
    await render([])
    await open('Ask for review')

    expect(container.textContent).toContain('No member can approve this request.')
    expect(button('Save')!.disabled).toBe(true)
  })

  test(`refuses more than ${MAX_REQUEST_REVIEWERS} reviewers before saving`, async () => {
    candidates = Array.from({ length: MAX_REQUEST_REVIEWERS + 1 }, (_, index) =>
      person(`m-${index}`, `member-${index}@example.com`)
    )
    await render([])
    await open('Ask for review')

    await act(async () => button('Select all')!.click())

    expect(container.querySelector('[role="alert"]')!.textContent).toBe(
      `Ask at most ${MAX_REQUEST_REVIEWERS} members.`
    )
    expect(button('Save')!.disabled).toBe(true)
    expect(setReviewers).not.toHaveBeenCalled()
  })

  test('a failed save says so and leaves the dialog open', async () => {
    setReviewers.mockRejectedValue(new Error("bo can't approve this request"))
    await render([])
    await open('Ask for review')
    await act(async () => row('bo@example.com').click())
    await act(async () => button('Save')!.click())

    expect(toast.success).not.toHaveBeenCalled()
    expect(button('Save')).toBeDefined()
  })
})
