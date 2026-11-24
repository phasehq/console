import {
  newCustomConnectionMaterial,
  sealCustomConnectionValue,
  sealedValuePlaintext,
  secretRequirement,
  secretsProblem,
} from '@/utils/agents/customConnectionSealing'
import { decryptAsymmetric, randomFormattedKeyPair } from '@/utils/crypto/general'
import type { HttpDefinition } from '@/utils/agents/httpDefinition'

const bearer: HttpDefinition = {
  specVersion: 1,
  hosts: [{ match: 'exact', value: 'api.example.com', port: 443, path: '/v1/*' }],
  fields: [{ name: 'token', kind: 'secret', source: { type: 'sealed' } }],
  injections: [{ type: 'header', name: 'Authorization', prefix: 'Bearer ', field: 'token' }],
}

describe('the sealed plaintext', () => {
  test('is exactly v, hosts and fields', () => {
    expect(sealedValuePlaintext(bearer, { token: 'real-secret' })).toBe(
      '{"v":1,"hosts":[{"match":"exact","value":"api.example.com","port":443}],"fields":{"token":"real-secret"}}'
    )
  })

  test('binds no path and omits an unset port', () => {
    const plaintext = sealedValuePlaintext(
      { ...bearer, hosts: [{ match: 'exact', value: 'api.example.com', path: '/v1/*' }] },
      { token: 'real-secret' }
    )
    expect(plaintext).toBe(
      '{"v":1,"hosts":[{"match":"exact","value":"api.example.com"}],"fields":{"token":"real-secret"}}'
    )
    expect(plaintext).not.toContain('path')
    expect(plaintext).not.toContain('port')
  })

  test('lower-cases hosts, drops a trailing dot, deduplicates and sorts', () => {
    const plaintext = sealedValuePlaintext(
      {
        ...bearer,
        hosts: [
          { match: 'suffix', value: '.Example.com.' },
          { match: 'exact', value: 'b.example.com', port: 8443, path: '/a' },
          { match: 'exact', value: 'b.example.com', port: 8443, path: '/b' },
          { match: 'exact', value: 'A.example.com' },
          { match: 'exact', value: 'b.example.com' },
        ],
      },
      { token: 'real-secret' }
    )
    expect(JSON.parse(plaintext).hosts).toEqual([
      { match: 'suffix', value: '.example.com' },
      { match: 'exact', value: 'a.example.com' },
      { match: 'exact', value: 'b.example.com' },
      { match: 'exact', value: 'b.example.com', port: 8443 },
    ])
    // Member order inside a host is match, value, port.
    expect(plaintext).toContain('{"match":"exact","value":"b.example.com","port":8443}')
  })

  test('holds exactly the secret fields, in definition order, and no identifier', () => {
    const definition: HttpDefinition = {
      specVersion: 1,
      hosts: [{ match: 'exact', value: 'api.example.com' }],
      fields: [
        { name: 'zeta', kind: 'secret', source: { type: 'sealed' } },
        { name: 'username', kind: 'identifier', value: 'alice' },
        { name: 'alpha', kind: 'secret', source: { type: 'sealed' } },
      ],
      injections: [
        { type: 'header', name: 'X-Zeta', field: 'zeta' },
        { type: 'header', name: 'X-Alpha', field: 'alpha' },
      ],
    }
    const plaintext = sealedValuePlaintext(definition, {
      alpha: 'alpha-secret',
      zeta: 'zeta-secret',
    })
    expect(plaintext).toBe(
      '{"v":1,"hosts":[{"match":"exact","value":"api.example.com"}],"fields":{"zeta":"zeta-secret","alpha":"alpha-secret"}}'
    )
    expect(Object.keys(JSON.parse(plaintext))).toEqual(['v', 'hosts', 'fields'])
  })

  test('refuses a missing secret or one for a field that does not exist', () => {
    expect(() => sealedValuePlaintext(bearer, {})).toThrow('Enter the secret for token.')
    expect(() => sealedValuePlaintext(bearer, { token: '' })).toThrow('Enter the secret for token.')
    expect(() => sealedValuePlaintext(bearer, { token: 'real-secret', other: 'x' })).toThrow(
      /field that does not exist/
    )
  })

  test('says what is wrong with the entered secrets without repeating them', () => {
    expect(secretsProblem(bearer, { token: 'real-secret' })).toBe('')
    expect(secretsProblem(bearer, {})).toBe('Enter the secret for token.')
    expect(secretsProblem(bearer, { token: 'short' })).toMatch(/at least 8 bytes/)
  })
})

describe('sealing', () => {
  test('a new Connection gets a keypair, a value only it opens, and a key wrapped to the server', async () => {
    const server = await randomFormattedKeyPair('hex')
    const material = await newCustomConnectionMaterial(
      bearer,
      { token: 'real-secret' },
      server.publicKey
    )

    expect(material.encryptionPublicKey).toMatch(/^[0-9a-f]{64}$/)
    expect(material.sealedValue.split(':').slice(0, 2)).toEqual(['ph', 'v1'])
    expect(material.sealedValue.split(':')).toHaveLength(4)
    expect(material.serverWrappedKey.split(':')).toHaveLength(4)
    expect(JSON.stringify(material)).not.toContain('real-secret')

    const privateKey = await decryptAsymmetric(
      material.serverWrappedKey,
      server.privateKey,
      server.publicKey
    )
    expect(privateKey).toMatch(/^[0-9a-f]{64}$/)
    expect(
      await decryptAsymmetric(material.sealedValue, privateKey, material.encryptionPublicKey)
    ).toBe(sealedValuePlaintext(bearer, { token: 'real-secret' }))
  })

  test('a new value is sealed to the stored public key', async () => {
    const connection = await randomFormattedKeyPair('hex')
    const sealed = await sealCustomConnectionValue(
      bearer,
      { token: 'next-secret' },
      connection.publicKey
    )
    expect(
      JSON.parse(await decryptAsymmetric(sealed, connection.privateKey, connection.publicKey))
    ).toEqual({
      v: 1,
      hosts: [{ match: 'exact', value: 'api.example.com', port: 443 }],
      fields: { token: 'next-secret' },
    })
  })

  test('refuses to seal without a usable key', async () => {
    await expect(sealCustomConnectionValue(bearer, { token: 'next-secret' }, '')).rejects.toThrow(
      /no encryption key/
    )
    await expect(newCustomConnectionMaterial(bearer, { token: 'next-secret' }, '')).rejects.toThrow(
      /server key/
    )
  })
})

describe('asking for the secret again', () => {
  const withHosts = (hosts: HttpDefinition['hosts']): HttpDefinition => ({ ...bearer, hosts })

  test('a new Connection always needs its secret', () => {
    expect(secretRequirement(null, bearer)).toMatchObject({ required: true, reason: '' })
  })

  test('a change of environment name or of what happens without the header does not', () => {
    const changed: HttpDefinition = {
      ...bearer,
      fields: [{ name: 'token', kind: 'secret', source: { type: 'sealed' }, env: 'EXAMPLE_KEY' }],
      injections: [
        {
          type: 'header',
          name: 'Authorization',
          prefix: 'Bearer ',
          field: 'token',
          whenAbsent: 'block',
        },
      ],
    }
    expect(secretRequirement(bearer, changed)).toEqual({
      required: false,
      hostsChanged: false,
      fieldsChanged: false,
      plainHttpEnabled: false,
      textAdded: false,
      reason: '',
    })
  })

  test('text the Agent reads that was not there does, and says why', () => {
    const withPath = (path: string): HttpDefinition => ({
      ...bearer,
      hosts: [{ match: 'exact', value: 'api.example.com', port: 443, path }],
    })
    const decoy: HttpDefinition = {
      ...bearer,
      fields: [{ name: 'token', kind: 'secret', source: { type: 'sealed' }, decoyPrefix: 'sk-' }],
    }
    const query: HttpDefinition = {
      ...bearer,
      injections: [{ type: 'query', name: 'key', field: 'token' }],
    }
    const prefix: HttpDefinition = {
      ...bearer,
      injections: [{ type: 'header', name: 'Authorization', prefix: 'Token ', field: 'token' }],
    }
    for (const changed of [withPath('/v2/*'), decoy, query, prefix]) {
      const requirement = secretRequirement(bearer, changed)
      expect(requirement).toEqual({
        required: true,
        hostsChanged: false,
        fieldsChanged: false,
        plainHttpEnabled: false,
        textAdded: true,
        reason: expect.stringMatching(/^Text the Agent can read changed/),
      })
    }
  })

  test('text taken away does not; putting it back does', () => {
    const noPath: HttpDefinition = {
      ...bearer,
      hosts: [{ match: 'exact', value: 'api.example.com', port: 443 }],
    }
    expect(secretRequirement(bearer, noPath).required).toBe(false)
    expect(secretRequirement(noPath, bearer).textAdded).toBe(true)
  })

  test('a new host does not add a second reason for its new text', () => {
    const moved: HttpDefinition = {
      ...bearer,
      hosts: [{ match: 'exact', value: 'api.example.org', port: 443, path: '/v1/*' }],
    }
    const requirement = secretRequirement(bearer, moved)
    expect(requirement).toMatchObject({ required: true, hostsChanged: true, textAdded: true })
    expect(requirement.reason).toMatch(/allowed hosts changed/)
    expect(requirement.reason).not.toMatch(/Text the Agent can read/)
  })

  test('a definition without its injections is read as having none', () => {
    const shape = { hosts: bearer.hosts, fields: bearer.fields }
    expect(secretRequirement(bearer, shape).required).toBe(false)
    expect(secretRequirement(shape, bearer).textAdded).toBe(true)
  })

  test('turning plain HTTP on does, and says why; turning it off or leaving it does not', () => {
    const plain: HttpDefinition = { ...bearer, allowPlainHttp: true }
    const turnedOn = secretRequirement(bearer, plain)
    expect(turnedOn).toMatchObject({
      required: true,
      hostsChanged: false,
      fieldsChanged: false,
      plainHttpEnabled: true,
    })
    expect(turnedOn.reason).toMatch(/Plain HTTP was turned on/)
    expect(secretRequirement({ ...bearer, allowPlainHttp: false }, plain).required).toBe(true)

    expect(secretRequirement(plain, bearer).required).toBe(false)
    expect(secretRequirement(plain, { ...bearer, allowPlainHttp: false }).required).toBe(false)
    expect(secretRequirement(plain, plain).required).toBe(false)
  })

  test('plain HTTP turned on beside a host change adds to the reason', () => {
    const moved = withHosts([{ match: 'exact', value: 'api.example.org', port: 443 }])
    const both = secretRequirement(bearer, { ...moved, allowPlainHttp: true })
    expect(both.reason.startsWith(secretRequirement(bearer, moved).reason)).toBe(true)
    expect(both.reason).toMatch(/Plain HTTP was turned on/)
  })

  test('the same hosts in another order or letter case are not a host change', () => {
    const before = withHosts([
      { match: 'exact', value: 'a.example.com' },
      { match: 'exact', value: 'b.example.com' },
    ])
    const after = withHosts([
      { match: 'exact', value: 'B.example.com', path: '/x' },
      { match: 'exact', value: 'a.example.com' },
    ])
    expect(secretRequirement(before, after).hostsChanged).toBe(false)
    // In another order alone they show the Agent nothing new either.
    expect(secretRequirement(before, withHosts([...before.hosts].reverse())).required).toBe(false)
  })

  test.each([
    ['another host', [{ match: 'exact', value: 'api.example.org', port: 443 }]],
    ['another port', [{ match: 'exact', value: 'api.example.com', port: 8443 }]],
    ['no port', [{ match: 'exact', value: 'api.example.com' }]],
    ['a suffix match', [{ match: 'suffix', value: '.example.com', port: 443 }]],
    [
      'an added host',
      [
        { match: 'exact', value: 'api.example.com', port: 443 },
        { match: 'exact', value: 'files.example.com' },
      ],
    ],
  ] as Array<[string, HttpDefinition['hosts']]>)('%s does, and says why', (_label, hosts) => {
    const requirement = secretRequirement(bearer, withHosts(hosts))
    expect(requirement).toMatchObject({ required: true, hostsChanged: true, fieldsChanged: false })
    expect(requirement.reason).toMatch(/allowed hosts changed/)
  })

  test('a change to the set of secret fields does, and says why', () => {
    const more: HttpDefinition = {
      ...bearer,
      fields: [...bearer.fields, { name: 'org', kind: 'secret', source: { type: 'sealed' } }],
      injections: [...bearer.injections, { type: 'header', name: 'X-Org', field: 'org' }],
    }
    expect(secretRequirement(bearer, more)).toMatchObject({
      required: true,
      hostsChanged: false,
      fieldsChanged: true,
    })
    expect(secretRequirement(bearer, more).reason).toMatch(/set of secrets changed/)

    const renamed: HttpDefinition = {
      ...bearer,
      fields: [{ name: 'apikey', kind: 'secret', source: { type: 'sealed' } }],
      injections: [{ type: 'header', name: 'Authorization', prefix: 'Bearer ', field: 'apikey' }],
    }
    expect(secretRequirement(bearer, renamed).fieldsChanged).toBe(true)
  })

  test('adding an identifier field keeps the secrets but shows the Agent its value', () => {
    const basic: HttpDefinition = {
      ...bearer,
      fields: [{ name: 'username', kind: 'identifier', value: 'alice' }, ...bearer.fields],
      injections: [{ type: 'basic', usernameField: 'username', field: 'token' }],
    }
    expect(secretRequirement(bearer, basic)).toMatchObject({
      required: true,
      hostsChanged: false,
      fieldsChanged: false,
      textAdded: true,
    })
  })
})
