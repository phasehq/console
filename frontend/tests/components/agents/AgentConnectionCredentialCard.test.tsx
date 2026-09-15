import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentConnectionCredentialCard } from '@/components/agents/AgentConnectionCredentialCard'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const credential = {
  id: 'postgres-dev',
  name: 'Development database',
  provider: { id: 'postgres', name: 'PostgreSQL' },
}

test('links credential readers to the highlighted inventory row', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(<AgentConnectionCredentialCard credential={credential} team="phase" canView />)
  })

  expect(container.querySelector('a')?.getAttribute('href')).toBe(
    '/phase/integrations/credentials?provider=postgres&credential=postgres-dev'
  )
  expect(container.textContent).toContain('View credential')

  await act(async () => root.unmount())
  container.remove()
})

test('keeps the credential summary non-interactive without read permission', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <AgentConnectionCredentialCard credential={credential} team="phase" canView={false} />
    )
  })

  expect(container.querySelector('a')).toBeNull()
  expect(container.textContent).toContain('Development database')
  expect(container.textContent).not.toContain('View credential')

  await act(async () => root.unmount())
  container.remove()
})
