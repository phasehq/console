import {
  buildCustomConnectionDefinition,
  customConnectionFormFromDefinition,
  emptyCustomConnectionForm,
  environmentNameProblem,
  newHostRow,
  parseHostInput,
  presetCredential,
  sameDefinition,
  secretsByField,
  withPreset,
  type CustomConnectionForm,
} from '@/utils/agents/customConnectionForm'
import { secretRequirement } from '@/utils/agents/customConnectionSealing'
import type { HttpDefinition } from '@/utils/agents/httpDefinition'

const formWith = (
  patch: Partial<CustomConnectionForm>,
  host: Partial<CustomConnectionForm['hosts'][number]> = { host: 'api.example.com' }
): CustomConnectionForm => {
  const form = emptyCustomConnectionForm('Example API')
  return { ...form, hosts: [{ ...form.hosts[0], ...host }], ...patch }
}

const issuesOf = (form: CustomConnectionForm) =>
  buildCustomConnectionDefinition(form).issues.map((issue) => issue.message)

describe('the form builds a definition for each preset', () => {
  test('bearer token: the common case is a name, one host and one token', () => {
    const { definition, issues, secretFields } = buildCustomConnectionDefinition(formWith({}))

    expect(issues).toEqual([])
    expect(definition).toEqual({
      specVersion: 1,
      hosts: [{ match: 'exact', value: 'api.example.com' }],
      fields: [{ name: 'token', kind: 'secret', source: { type: 'sealed' } }],
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
    })
    expect(Object.values(secretFields)).toEqual(['token'])
  })

  test('basic auth: an identifier username and a secret password', () => {
    const form = withPreset(formWith({}), 'basic')
    form.credentials[0] = {
      ...form.credentials[0],
      username: 'alice',
      usernameEnv: 'EXAMPLE_USER',
      env: 'EXAMPLE_PASSWORD',
    }

    expect(buildCustomConnectionDefinition(form).definition).toEqual({
      specVersion: 1,
      hosts: [{ match: 'exact', value: 'api.example.com' }],
      fields: [
        { name: 'username', kind: 'identifier', value: 'alice', env: 'EXAMPLE_USER' },
        { name: 'password', kind: 'secret', source: { type: 'sealed' }, env: 'EXAMPLE_PASSWORD' },
      ],
      injections: [
        { type: 'basic', usernameField: 'username', field: 'password', whenAbsent: 'attach' },
      ],
      preset: 'basic',
    })
  })

  test('custom headers: one secret per header, named after it', () => {
    const base = withPreset(formWith({}), 'headers')
    const form: CustomConnectionForm = {
      ...base,
      credentials: [
        { ...base.credentials[0], headerName: 'X-Api-Key', decoyPrefix: 'sk-' },
        { ...presetCredential('headers'), headerName: 'X-Org-Id', prefix: 'org ' },
      ],
      blockWhenAbsent: true,
    }

    const { definition, secretFields } = buildCustomConnectionDefinition(form)
    expect(definition).toEqual({
      specVersion: 1,
      hosts: [{ match: 'exact', value: 'api.example.com' }],
      fields: [
        { name: 'xapikey', kind: 'secret', source: { type: 'sealed' }, decoyPrefix: 'sk-' },
        { name: 'xorgid', kind: 'secret', source: { type: 'sealed' } },
      ],
      injections: [
        { type: 'header', name: 'X-Api-Key', field: 'xapikey', whenAbsent: 'block' },
        { type: 'header', name: 'X-Org-Id', prefix: 'org ', field: 'xorgid', whenAbsent: 'block' },
      ],
      preset: 'headers',
    })
    expect(secretFields).toEqual({
      [form.credentials[0].id]: 'xapikey',
      [form.credentials[1].id]: 'xorgid',
    })
  })

  test('query parameter', () => {
    const form = withPreset(formWith({ allowPlainHttp: true }), 'query')
    form.credentials[0] = { ...form.credentials[0], queryName: 'key' }

    expect(buildCustomConnectionDefinition(form).definition).toEqual({
      specVersion: 1,
      hosts: [{ match: 'exact', value: 'api.example.com' }],
      fields: [{ name: 'token', kind: 'secret', source: { type: 'sealed' } }],
      injections: [{ type: 'query', name: 'key', field: 'token', whenAbsent: 'attach' }],
      preset: 'query',
      allowPlainHttp: true,
    })
  })

  test('hosts: a leading *. is a suffix match, with an optional port and path', () => {
    const form = formWith({})
    form.hosts = [
      { ...newHostRow(), host: '*.Example.com', port: '8443', path: '/v1/*' },
      { ...newHostRow(), host: 'files.example.com.' },
      // A row left blank is ignored.
      newHostRow(),
    ]

    expect(buildCustomConnectionDefinition(form).definition?.hosts).toEqual([
      { match: 'suffix', value: '.example.com', port: 8443, path: '/v1/*' },
      { match: 'exact', value: 'files.example.com' },
    ])
  })

  test('derived field names are valid and unique', () => {
    const base = withPreset(formWith({}), 'headers')
    const form: CustomConnectionForm = {
      ...base,
      credentials: [
        { ...base.credentials[0], headerName: 'X-Key' },
        { ...presetCredential('headers'), headerName: 'X_Key' },
        { ...presetCredential('headers'), headerName: '2FA-Token' },
      ],
    }
    expect(
      buildCustomConnectionDefinition(form).definition?.fields.map((field) => field.name)
    ).toEqual(['xkey', 'xkey2', 'h2fatoken'])
  })

  test('maps typed secrets from rows to field names', () => {
    expect(
      secretsByField({ 'row-a': 'token', 'row-b': 'org' }, { 'row-a': 'one', 'row-c': 'x' })
    ).toEqual({ token: 'one' })
  })
})

describe('the form mirrors the server validation', () => {
  test('an empty form is incomplete, not wrong', () => {
    const { definition, issues } = buildCustomConnectionDefinition(emptyCustomConnectionForm())
    expect(definition).toBeNull()
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((issue) => issue.missing)).toBe(true)
  })

  test.each([
    ['https://api.example.com', /without a scheme or a path/],
    ['api.example.com/v1', /without a scheme or a path/],
    ['api.*.example.com', /only allowed as a leading/],
    ['.example.com', /Use \*\.example\.com/],
    ['*.com', /below a top-level domain/],
    ['*.10.0.0.1', /cannot match subdomains/],
    ['api.example.com:8443', /port in its own field/],
    ['api_.example.com', /letters, digits, hyphens and dots/],
    ['host.123', /cannot end in a number/],
  ])('refuses the host %s', (host, message) => {
    expect(parseHostInput(host)).toEqual({ error: expect.stringMatching(message) })
  })

  test('accepts names, subdomain matches and IP addresses', () => {
    expect(parseHostInput(' API.Example.com. ')).toEqual({
      match: 'exact',
      value: 'api.example.com',
    })
    expect(parseHostInput('*.example.com')).toEqual({ match: 'suffix', value: '.example.com' })
    expect(parseHostInput('10.0.0.1')).toEqual({ match: 'exact', value: '10.0.0.1' })
    expect(parseHostInput('[::1]')).toEqual({ match: 'exact', value: '::1' })
    expect(parseHostInput('localhost')).toEqual({ match: 'exact', value: 'localhost' })
  })

  test('refuses a bad port, path or duplicate host', () => {
    expect(issuesOf(formWith({}, { host: 'api.example.com', port: '70000' }))).toEqual([
      'Enter a port from 1 to 65535.',
    ])
    expect(issuesOf(formWith({}, { host: 'api.example.com', path: 'v1' }))).toEqual([
      'A path starts with /.',
    ])
    const twice = formWith({})
    twice.hosts = [
      { ...newHostRow(), host: 'api.example.com' },
      { ...newHostRow(), host: 'API.example.com' },
    ]
    expect(issuesOf(twice)).toEqual(['This host is listed twice.'])
  })

  test.each([
    ['lower', /upper-case letters/],
    ['1ABC', /upper-case letters/],
    ['PHASE_TOKEN', /PHASE_TOKEN is reserved/],
    ['PATH', /PATH is reserved/],
    ['HTTPS_PROXY', /HTTPS_PROXY is reserved/],
    ['GIT_TOKEN', /GIT_TOKEN is reserved/],
    ['LD_PRELOAD', /LD_PRELOAD is reserved/],
    ['AWS_SECRET_ACCESS_KEY', /AWS_SECRET_ACCESS_KEY is reserved/],
    ['PGPASSWORD', /PGPASSWORD is reserved/],
    ['API_2KEY', /digit cannot directly follow an underscore/],
    ['A'.repeat(65), /upper-case letters/],
  ])('refuses the environment name %s', (name, message) => {
    expect(environmentNameProblem(name)).toMatch(message)
  })

  test('accepts an ordinary environment name and refuses a duplicate', () => {
    expect(environmentNameProblem('EXAMPLE_API_KEY')).toBe('')
    expect(environmentNameProblem('API2_KEY')).toBe('')
    const basic = withPreset(formWith({}), 'basic')
    basic.credentials[0] = {
      ...basic.credentials[0],
      username: 'alice',
      usernameEnv: 'EXAMPLE',
      env: 'EXAMPLE',
    }
    expect(issuesOf(basic)).toEqual(['EXAMPLE is already used by another field.'])
  })

  test('refuses headers the proxy will not set, bad names and duplicates', () => {
    const headers = (names: string[]) => {
      const base = withPreset(formWith({}), 'headers')
      return {
        ...base,
        credentials: names.map((headerName) => ({ ...presetCredential('headers'), headerName })),
      }
    }
    expect(issuesOf(headers(['Host']))).toEqual(['The Host header cannot be set.'])
    expect(issuesOf(headers(['Proxy-Authorization']))).toEqual([
      'The Proxy-Authorization header cannot be set.',
    ])
    expect(issuesOf(headers(['X Api Key']))).toEqual(['Enter a valid HTTP header name.'])
    expect(issuesOf(headers(['X-Key', 'x-key']))).toEqual([
      'The x-key header is already set by another row.',
    ])
    expect(issuesOf(headers(Array.from({ length: 11 }, (_, index) => `X-Key-${index}`)))).toEqual([
      'Use at most 10 headers.',
      'Use at most 10 fields.',
    ])
  })

  test('refuses a prefix with braces, a bad decoy prefix and a bad query name', () => {
    const header = withPreset(formWith({}), 'headers')
    header.credentials[0] = {
      ...header.credentials[0],
      headerName: 'X-Key',
      prefix: 'Token {x}',
      decoyPrefix: 'has space',
    }
    expect(issuesOf(header)).toEqual([
      'Use at most 64 characters without braces or control characters.',
      'Use at most 16 letters, digits, underscores or hyphens.',
    ])

    const query = withPreset(formWith({}), 'query')
    query.credentials[0] = { ...query.credentials[0], queryName: 'a=b' }
    expect(issuesOf(query)).toEqual(['A parameter name cannot contain & or =.'])
  })
})

describe('reading a definition back into the form', () => {
  const stored: HttpDefinition = {
    specVersion: 1,
    hosts: [{ match: 'suffix', value: '.example.com', port: 8443, path: '/v1/*' }],
    fields: [
      { name: 'apikey', kind: 'secret', source: { type: 'sealed' }, env: 'EXAMPLE_KEY' },
      { name: 'login', kind: 'identifier', value: 'alice' },
    ],
    injections: [{ type: 'basic', usernameField: 'login', field: 'apikey', whenAbsent: 'block' }],
    preset: 'basic',
    allowPlainHttp: true,
  }

  test('an untouched form builds back the stored definition, field names and order included', () => {
    const form = customConnectionFormFromDefinition('Example', stored)!
    expect(form).toMatchObject({
      name: 'Example',
      preset: 'basic',
      blockWhenAbsent: true,
      allowPlainHttp: true,
    })
    expect(form.hosts[0]).toMatchObject({ host: '*.example.com', port: '8443', path: '/v1/*' })
    expect(buildCustomConnectionDefinition(form).definition).toEqual(stored)
  })

  test('infers the preset when the definition names none', () => {
    const bearer: HttpDefinition = {
      specVersion: 1,
      hosts: [{ match: 'exact', value: 'api.example.com' }],
      fields: [{ name: 'key', kind: 'secret', source: { type: 'sealed' } }],
      injections: [{ type: 'header', name: 'Authorization', prefix: 'Bearer ', field: 'key' }],
    }
    expect(customConnectionFormFromDefinition('A', bearer)?.preset).toBe('bearer')
    expect(
      customConnectionFormFromDefinition('A', {
        ...bearer,
        injections: [{ type: 'header', name: 'X-Key', field: 'key' }],
      })?.preset
    ).toBe('headers')
    expect(
      customConnectionFormFromDefinition('A', {
        ...bearer,
        injections: [{ type: 'query', name: 'k', field: 'key' }],
      })?.preset
    ).toBe('query')
  })

  test('returns null for a shape the form cannot express', () => {
    const base: HttpDefinition = {
      specVersion: 1,
      hosts: [{ match: 'exact', value: 'api.example.com' }],
      fields: [{ name: 'key', kind: 'secret', source: { type: 'sealed' } }],
      injections: [{ type: 'header', name: 'X-Key', field: 'key' }],
    }
    // One secret in two places.
    expect(
      customConnectionFormFromDefinition('A', {
        ...base,
        injections: [...base.injections, { type: 'header', name: 'X-Other', field: 'key' }],
      })
    ).toBeNull()
    // A header and a query parameter together.
    expect(
      customConnectionFormFromDefinition('A', {
        ...base,
        fields: [...base.fields, { name: 'other', kind: 'secret', source: { type: 'sealed' } }],
        injections: [...base.injections, { type: 'query', name: 'k', field: 'other' }],
      })
    ).toBeNull()
    // An identifier no injection uses.
    expect(
      customConnectionFormFromDefinition('A', {
        ...base,
        fields: [...base.fields, { name: 'account', kind: 'identifier', value: 'acme' }],
      })
    ).toBeNull()
    // Injections that disagree on what to do without a credential.
    expect(
      customConnectionFormFromDefinition('A', {
        ...base,
        fields: [...base.fields, { name: 'other', kind: 'secret', source: { type: 'sealed' } }],
        injections: [
          { type: 'header', name: 'X-Key', field: 'key', whenAbsent: 'block' },
          { type: 'header', name: 'X-Other', field: 'other', whenAbsent: 'attach' },
        ],
      })
    ).toBeNull()
  })

  test('the preset is only a hint when comparing definitions', () => {
    expect(sameDefinition(stored, { ...stored, preset: undefined })).toBe(true)
    expect(sameDefinition(stored, { ...stored, allowPlainHttp: false })).toBe(false)
  })
})

describe('whether an edit asks for the secret again', () => {
  const stored: HttpDefinition = {
    specVersion: 1,
    hosts: [{ match: 'exact', value: 'api.example.com' }],
    fields: [{ name: 'apikey', kind: 'secret', source: { type: 'sealed' } }],
    injections: [{ type: 'header', name: 'Authorization', prefix: 'Bearer ', field: 'apikey' }],
    preset: 'bearer',
  }
  const edit = (change: (form: CustomConnectionForm) => CustomConnectionForm) => {
    const form = change(customConnectionFormFromDefinition('Example', stored)!)
    return secretRequirement(stored, buildCustomConnectionDefinition(form).definition)
  }

  test('not for a rename, an environment name or advanced settings', () => {
    expect(
      edit((form) => ({
        ...form,
        name: 'Renamed',
        credentials: [{ ...form.credentials[0], env: 'EXAMPLE_KEY' }],
        blockWhenAbsent: true,
      })).required
    ).toBe(false)
  })

  test('for a new path or decoy prefix, which the Agent reads, with a reason', () => {
    for (const changed of [
      edit((form) => ({ ...form, hosts: [{ ...form.hosts[0], path: '/v2/*' }] })),
      edit((form) => ({
        ...form,
        credentials: [{ ...form.credentials[0], decoyPrefix: 'sk-' }],
      })),
    ]) {
      expect(changed).toMatchObject({ required: true, hostsChanged: false, textAdded: true })
      expect(changed.reason).toMatch(/Text the Agent can read changed/)
    }
  })

  test('for turning plain HTTP on, with a reason, but not for turning it off', () => {
    const turnedOn = edit((form) => ({ ...form, allowPlainHttp: true }))
    expect(turnedOn).toMatchObject({ required: true, plainHttpEnabled: true })
    expect(turnedOn.reason).toMatch(/Plain HTTP was turned on/)

    const plain = customConnectionFormFromDefinition('Example', {
      ...stored,
      allowPlainHttp: true,
    })!
    expect(
      secretRequirement(
        { ...stored, allowPlainHttp: true },
        buildCustomConnectionDefinition({ ...plain, allowPlainHttp: false }).definition
      ).required
    ).toBe(false)
  })

  test('for moving the same secret to another place only by the new text it shows', () => {
    // The secret keeps its field name across presets; the query parameter name and the
    // username are new text the Agent reads.
    const query = edit((form) => withPreset(form, 'query'))
    const basic = edit((form) => {
      const next = withPreset(form, 'basic')
      next.credentials[0] = { ...next.credentials[0], username: 'alice' }
      return next
    })
    for (const moved of [query, basic])
      expect(moved).toMatchObject({
        required: true,
        hostsChanged: false,
        fieldsChanged: false,
        textAdded: true,
      })
  })

  test('for a changed host, port or match', () => {
    expect(
      edit((form) => ({ ...form, hosts: [{ ...form.hosts[0], host: 'api.example.org' }] }))
    ).toMatchObject({ required: true, hostsChanged: true })
    expect(
      edit((form) => ({ ...form, hosts: [{ ...form.hosts[0], port: '8443' }] }))
    ).toMatchObject({
      required: true,
      hostsChanged: true,
    })
    expect(
      edit((form) => ({ ...form, hosts: [{ ...form.hosts[0], host: '*.example.com' }] }))
    ).toMatchObject({ required: true, hostsChanged: true })
    expect(
      edit((form) => ({
        ...form,
        hosts: [...form.hosts, { ...newHostRow(), host: 'b.example.com' }],
      }))
    ).toMatchObject({ required: true, hostsChanged: true })
  })

  test('for an added or removed secret', () => {
    const added = edit((form) => {
      const next = withPreset(form, 'headers')
      return {
        ...next,
        credentials: [
          { ...next.credentials[0], headerName: 'X-Key' },
          { ...presetCredential('headers'), headerName: 'X-Org' },
        ],
      }
    })
    expect(added).toMatchObject({ required: true, hostsChanged: false, fieldsChanged: true })
  })

  test('not while the form is incomplete', () => {
    expect(edit((form) => ({ ...form, hosts: [{ ...form.hosts[0], host: '' }] })).required).toBe(
      false
    )
  })
})
