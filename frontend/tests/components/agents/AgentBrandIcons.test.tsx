import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AgentServiceTile, agentServiceMeta } from '@/components/agents/AgentBrandIcons'
import { meshServiceLabel } from '@/components/agents/AgentMeshUtils'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const PACKAGED = [
  ['github', 'GitHub'],
  ['gitlab', 'GitLab'],
  ['cloudflare', 'Cloudflare'],
  ['vercel', 'Vercel'],
  ['render', 'Render'],
  ['railway', 'Railway'],
  ['supabase', 'Supabase'],
] as const

describe('service marks and names', () => {
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

  test.each(PACKAGED)(
    '%s has its own mark and name, not the generic fallback',
    async (type, name) => {
      const fallback = agentServiceMeta('not-a-service')
      const meta = agentServiceMeta(type)
      expect(meta.label).toBe(name)
      expect(meta.Icon).not.toBe(fallback.Icon)
      expect(agentServiceMeta(type.toUpperCase()).label).toBe(name)

      await act(async () => root.render(<AgentServiceTile serviceType={type} />))
      const tile = container.querySelector('[role="img"]')!
      expect(tile.getAttribute('aria-label')).toBe(name)
      expect(tile.querySelector('svg')).not.toBeNull()
    }
  )

  test.each(PACKAGED)('%s reads by its proper name where only the type is known', (type, name) => {
    expect(meshServiceLabel(type)).toBe(name)
  })

  test('the earlier services keep theirs', () => {
    expect(agentServiceMeta('aws').label).toBe('AWS')
    expect(agentServiceMeta('postgres').label).toBe('PostgreSQL')
    expect(agentServiceMeta('http').label).toBe('Custom HTTP')
  })
})
