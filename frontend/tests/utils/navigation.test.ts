import { generateBreadcrumbs, generatePageTitle } from '@/utils/navigation'

describe('Agent breadcrumbs', () => {
  it('uses the canonical section label on the Agent index', () => {
    expect(generateBreadcrumbs({ team: 'phase', context: 'agents' })).toEqual([
      { label: 'phase', href: '/phase', isLink: true },
      { label: 'Agents', href: undefined, isLink: false },
    ])
  })

  it('links nested tabs back to the canonical Agent index', () => {
    expect(generateBreadcrumbs({ team: 'phase', context: 'agents', page: 'requests' })).toEqual([
      { label: 'phase', href: '/phase', isLink: true },
      { label: 'Agents', href: '/phase/agents', isLink: true },
      { label: 'requests', isLink: false },
    ])
  })

  it('does not expose an Agent UUID as a breadcrumb label', () => {
    expect(
      generateBreadcrumbs({
        team: 'phase',
        context: 'agents',
        page: '76dbefc3-3c62-4bb9-b926-c284c4f2288c',
      })
    ).toEqual([
      { label: 'phase', href: '/phase', isLink: true },
      { label: 'Agents', href: '/phase/agents', isLink: true },
      { label: 'Agent', isLink: false },
    ])
  })
})

describe('Agent page titles', () => {
  // The sidebar label carries a "Beta" stage badge. It is deliberately not part
  // of the link name, so it must never reach the document title either.
  test('titles the Agent section from the route, not the nav label', () => {
    expect(generatePageTitle({ team: 'phase', context: 'agents' })).toBe(
      'Agents \u00b7 phase | Phase Console'
    )
  })

  test('titles nested Agent tabs and detail pages', () => {
    expect(generatePageTitle({ team: 'phase', context: 'agents', page: 'connections' })).toBe(
      'Connections \u00b7 Agents \u00b7 phase | Phase Console'
    )
    expect(
      generatePageTitle({
        team: 'phase',
        context: 'agents',
        page: '76dbefc3-3c62-4bb9-b926-c284c4f2288c',
      })
    ).toBe('Agent \u00b7 Agents \u00b7 phase | Phase Console')
  })

  test('never leaks a stage suffix into the title', () => {
    expect(generatePageTitle({ team: 'phase', context: 'agents' })).not.toContain('Beta')
  })
})

describe('Integrations page title', () => {
  test('titles the Integrations index as Integrations', () => {
    expect(generatePageTitle({ team: 'phase', context: 'integrations' })).toBe(
      'Integrations \u00b7 phase | Phase Console'
    )
  })
})
