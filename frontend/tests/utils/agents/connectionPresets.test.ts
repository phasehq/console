import {
  groupPresets,
  presetForm,
  presetLocksHosts,
  readPresets,
  searchPresets,
} from '@/utils/agents/connectionPresets'
import { buildCustomConnectionDefinition } from '@/utils/agents/customConnectionForm'

const github = {
  id: 'github',
  name: 'GitHub',
  description: 'The GitHub REST API.',
  docsUrl: 'https://docs.github.com/rest',
  category: 'source-control',
  hosts: [{ match: 'exact', value: 'api.github.com', port: 443 }],
  hostsEditable: true,
  labels: { token: 'Access token' },
  definition: {
    specVersion: 1,
    hosts: [{ match: 'exact', value: 'api.github.com', port: 443 }],
    fields: [{ name: 'token', kind: 'secret', source: { type: 'sealed' }, env: 'GITHUB_TOKEN' }],
    injections: [
      {
        type: 'header',
        name: 'Authorization',
        prefix: 'Bearer ',
        field: 'token',
        whenAbsent: 'attach',
      },
    ],
    preset: 'bearer',
  },
}
const stripe = {
  ...github,
  id: 'stripe',
  name: 'Stripe',
  description: 'Payments.',
  category: 'payments',
  hostsEditable: false,
  labels: { token: 'Secret or restricted key' },
  hosts: [{ match: 'exact', value: 'api.stripe.com', port: 443 }],
  definition: {
    ...github.definition,
    hosts: [{ match: 'exact', value: 'api.stripe.com', port: 443 }],
  },
}
const datadog = {
  ...github,
  id: 'datadog',
  name: 'Datadog',
  description: 'Metrics and logs.',
  category: 'observability',
  labels: { apikey: 'API key', appkey: 'Application key' },
  definition: {
    specVersion: 1,
    hosts: [{ match: 'exact', value: 'api.datadoghq.com', port: 443, path: '/api/*' }],
    fields: [
      { name: 'apikey', kind: 'secret', source: { type: 'sealed' }, env: 'DD_API_KEY' },
      { name: 'appkey', kind: 'secret', source: { type: 'sealed' }, env: 'DD_APP_KEY' },
    ],
    injections: [
      { type: 'header', name: 'DD-API-KEY', field: 'apikey', whenAbsent: 'attach' },
      { type: 'header', name: 'DD-APPLICATION-KEY', field: 'appkey', whenAbsent: 'attach' },
    ],
    preset: 'headers',
  },
}
const mcp = {
  ...github,
  id: 'mcp-server',
  name: 'MCP server',
  description: 'Any MCP server.',
  category: 'mcp',
  hosts: [],
  hostsEditable: true,
  definition: { ...github.definition, hosts: [] },
}

describe('provider presets', () => {
  const presets = readPresets([github, stripe, datadog, mcp, { nonsense: true }, null])

  test('reads the presets from the query and drops what is not one', () => {
    expect(presets.map((preset) => preset.id)).toEqual([
      'github',
      'stripe',
      'datadog',
      'mcp-server',
    ])
    expect(readPresets(undefined)).toEqual([])
  })

  test('searches by name, description and category, and groups by category', () => {
    expect(searchPresets(presets, 'git').map((preset) => preset.id)).toEqual(['github'])
    expect(searchPresets(presets, 'payments').map((preset) => preset.id)).toEqual(['stripe'])
    expect(searchPresets(presets, 'metrics logs').map((preset) => preset.id)).toEqual(['datadog'])
    expect(searchPresets(presets, '  ')).toHaveLength(4)
    expect(searchPresets(presets, 'nothing like it')).toEqual([])
    expect(groupPresets(presets).map((group) => group.label)).toEqual([
      'MCP',
      'Observability',
      'Payments',
      'Source control',
    ])
  })

  test('pre-fills the form from the definition, leaving the name and secrets to the member', () => {
    const form = presetForm(presets[0], 'my-github')!
    expect(form.name).toBe('my-github')
    expect(form.hosts).toMatchObject([{ host: 'api.github.com', port: '443' }])
    expect(form.credentials[0]).toMatchObject({
      field: 'token',
      headerName: 'Authorization',
      prefix: 'Bearer ',
      env: 'GITHUB_TOKEN',
    })
    const built = buildCustomConnectionDefinition(form)
    expect(built.issues).toEqual([])
    expect(built.definition?.hosts).toEqual([
      { match: 'exact', value: 'api.github.com', port: 443 },
    ])
    expect(JSON.stringify(built.definition)).not.toMatch(/secret value/i)
  })

  test('a preset with two secrets gives each its own row and label', () => {
    const form = presetForm(presets[2], 'metrics')!
    expect(form.preset).toBe('headers')
    expect(form.credentials.map((row) => row.field)).toEqual(['apikey', 'appkey'])
    expect(presets[2].labels).toEqual({ apikey: 'API key', appkey: 'Application key' })
  })

  test('locks the hosts unless the preset says the member enters them', () => {
    expect(presetLocksHosts(presets[1])).toBe(true)
    expect(presetLocksHosts(presets[0])).toBe(false)
    expect(presetLocksHosts(presets[3])).toBe(false)
    expect(presetLocksHosts(null)).toBe(false)
  })

  test('a preset with no host starts with one empty host row', () => {
    const form = presetForm(presets[3], 'my-mcp')!
    expect(form.hosts).toHaveLength(1)
    expect(form.hosts[0]).toMatchObject({ host: '', port: '', path: '' })
    expect(buildCustomConnectionDefinition(form).definition).toBeNull()
  })
})
