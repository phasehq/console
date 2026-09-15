import { generateBreadcrumbs } from '@/utils/navigation'

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
