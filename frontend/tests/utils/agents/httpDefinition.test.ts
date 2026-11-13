import {
  agentVisibleTexts,
  boundHosts,
  describeHttpHost,
  describeHttpInjection,
  httpRequestPreview,
  isCustomConnection,
  parseHttpDefinition,
  secretFieldNames,
  secretValueProblem,
  utf8ByteLength,
  type HttpDefinition,
} from '@/utils/agents/httpDefinition'

const definition: HttpDefinition = {
  specVersion: 1,
  hosts: [{ match: 'exact', value: 'api.example.com', port: 443, path: '/v1/*' }],
  fields: [
    { name: 'token', kind: 'secret', source: { type: 'sealed' }, env: 'EXAMPLE_API_KEY' },
    { name: 'username', kind: 'identifier', value: 'alice' },
  ],
  injections: [
    { type: 'header', name: 'Authorization', prefix: 'Bearer ', field: 'token' },
    { type: 'query', name: 'api_key', field: 'token', whenAbsent: 'block' },
  ],
}

describe('custom Connection definitions', () => {
  test('only the http service type is a custom Connection', () => {
    expect(isCustomConnection('http')).toBe(true)
    expect(isCustomConnection(' HTTP ')).toBe(true)
    expect(isCustomConnection('aws')).toBe(false)
    expect(isCustomConnection(null)).toBe(false)
  })

  test('reads a definition and refuses anything shaped otherwise', () => {
    expect(parseHttpDefinition(definition)).toBe(definition)
    expect(parseHttpDefinition(null)).toBeNull()
    expect(parseHttpDefinition({})).toBeNull()
    expect(
      parseHttpDefinition({ ...definition, hosts: [{ match: 'glob', value: 'x' }] })
    ).toBeNull()
    expect(
      parseHttpDefinition({ ...definition, injections: [{ type: 'header', field: 'token' }] })
    ).toBeNull()
  })

  test('reduces hosts to match, value and port, deduplicated and sorted', () => {
    expect(
      boundHosts([
        { match: 'suffix', value: '.example.com' },
        { match: 'exact', value: 'b.example.com', port: 8443, path: '/v2/*' },
        { match: 'exact', value: 'B.Example.com.', port: 8443, path: '/v1/*' },
        { match: 'exact', value: 'b.example.com' },
        { match: 'exact', value: 'a.example.com', port: 443 },
        { match: 'exact', value: 'b.example.com', port: 80 },
      ])
    ).toEqual([
      { match: 'suffix', value: '.example.com' },
      { match: 'exact', value: 'a.example.com', port: 443 },
      // An unset port sorts before any port.
      { match: 'exact', value: 'b.example.com' },
      { match: 'exact', value: 'b.example.com', port: 80 },
      { match: 'exact', value: 'b.example.com', port: 8443 },
    ])
  })

  test('sorts the same host by match before port', () => {
    expect(
      boundHosts([
        { match: 'suffix', value: 'example.com', port: 1 },
        { match: 'exact', value: 'example.com', port: 2 },
      ]).map((rule) => rule.match)
    ).toEqual(['exact', 'suffix'])
  })

  test('names the secret fields and the text an Agent can read', () => {
    expect(secretFieldNames(definition)).toEqual(['token'])
    expect(
      agentVisibleTexts({
        ...definition,
        fields: [
          { name: 'token', kind: 'secret', source: { type: 'sealed' }, decoyPrefix: 'sk-' },
          { name: 'username', kind: 'identifier', value: 'alice' },
        ],
      })
    ).toEqual([
      { label: 'the decoy prefix of token', text: 'sk-' },
      { label: 'the value of username', text: 'alice' },
      { label: 'the prefix of the Authorization header', text: 'Bearer ' },
    ])
  })

  test('counts secret length in bytes, not characters', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('é')).toBe(2)
    expect(utf8ByteLength('€')).toBe(3)
    expect(utf8ByteLength('😀')).toBe(4)
  })

  test('refuses a secret that is too short, too long, or visible to the Agent', () => {
    expect(secretValueProblem('s3cr3t-value', definition)).toBe('')
    expect(secretValueProblem('short', definition)).toMatch(/at least 8 bytes/)
    expect(secretValueProblem('x'.repeat(16385), definition)).toMatch(/at most 16384 bytes/)
    expect(secretValueProblem('with\u0000nul-inside', definition)).toMatch(/cannot be stored/)
    const visible: HttpDefinition = {
      ...definition,
      fields: [
        { name: 'token', kind: 'secret', source: { type: 'sealed' } },
        { name: 'username', kind: 'identifier', value: 'user-hunter2hunter2' },
      ],
    }
    const problem = secretValueProblem('hunter2hunter2', visible)
    expect(problem).toBe(
      'The secret also appears in the value of username, which the Agent can read.'
    )
    // The message names the place, never the value.
    expect(problem).not.toContain('hunter2')
  })

  test('describes hosts and injections the way they are typed', () => {
    expect(describeHttpHost(definition.hosts[0])).toBe('api.example.com:443/v1/*')
    expect(describeHttpHost({ match: 'suffix', value: '.example.com' })).toBe('*.example.com')
    expect(describeHttpHost({ match: 'exact', value: '::1', port: 8080 })).toBe('[::1]:8080')
    expect(describeHttpInjection(definition.injections[0], definition)).toBe(
      'Authorization: Bearer <token>'
    )
    expect(describeHttpInjection(definition.injections[1], definition)).toBe(
      '?api_key=<token> (blocks a request without it)'
    )
    expect(
      describeHttpInjection(
        { type: 'basic', usernameField: 'username', field: 'token' },
        definition
      )
    ).toBe('Basic auth as alice with <token>')
  })

  test('previews a request with a placeholder where each secret goes', () => {
    expect(httpRequestPreview(definition)).toBe(
      "curl -H 'Authorization: Bearer <token>' 'https://api.example.com:443/v1/…?api_key=<token>'"
    )
    expect(
      httpRequestPreview({
        specVersion: 1,
        hosts: [{ match: 'suffix', value: '.example.com' }],
        fields: [
          { name: 'username', kind: 'identifier', value: 'alice' },
          { name: 'password', kind: 'secret', source: { type: 'sealed' } },
        ],
        injections: [{ type: 'basic', usernameField: 'username', field: 'password' }],
      })
    ).toBe("curl -u 'alice:<password>' 'https://api.example.com/'")
  })
})
