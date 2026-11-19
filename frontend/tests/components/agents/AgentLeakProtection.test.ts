import { agentHarnessMeta } from '@/components/agents/AgentBrandIcons'
import type { AgentEventRow } from '@/components/agents/AgentEventLogUtils'
import { describeLeakProtection, leakSecretPath } from '@/components/agents/AgentLeakProtection'

const event = (
  changes: Partial<AgentEventRow> = {},
  detail: Record<string, unknown> | null = {}
): AgentEventRow => ({
  ingestSeq: '1',
  eventId: 'event-1',
  proxyCreatedAt: '2026-11-19T10:00:00Z',
  ingestedAt: '2026-11-19T10:00:01Z',
  eventType: 'leak_protection',
  protocol: 'http',
  method: 'POST',
  host: 'api.anthropic.com',
  port: 443,
  path: '/v1/messages',
  provider: 'proxy',
  proxyDecision: 'ALLOW',
  outcome: 'censored',
  reason: 'secret_in_request',
  detail,
  ...changes,
})

const described = (
  changes: Partial<AgentEventRow> = {},
  detail: Record<string, unknown> | null = {}
) => describeLeakProtection(event(changes, detail))!

const headline = (changes: Partial<AgentEventRow> = {}, detail: Record<string, unknown> = {}) =>
  described(changes, detail).headline

const row = (label: string, changes: Partial<AgentEventRow>, detail: Record<string, unknown>) =>
  described(changes, detail).rows.find((candidate) => candidate.label === label)?.lines

const BLOCKED = { proxyDecision: 'BLOCK', outcome: 'denied', statusCode: 403 }
const BYPASS = {
  method: 'CONNECT',
  host: 'chatgpt.com',
  path: '/',
  outcome: 'bypass',
  reason: 'tls_refused',
}

describe('leak protection headlines', () => {
  test('a censored request says how many secret values were removed, and where it was going', () => {
    expect(headline({}, { placeholderCount: 3 })).toBe(
      'Removed 3 secret values from a request to api.anthropic.com'
    )
    expect(headline({}, { placeholderCount: 1 })).toBe(
      'Removed 1 secret value from a request to api.anthropic.com'
    )
  })

  test('counts distinct secrets, or what was found when the event does not count them', () => {
    expect(headline({}, { placeholderCount: 2, inventoryHits: 9, ruleRedactions: 4 })).toBe(
      'Removed 2 secret values from a request to api.anthropic.com'
    )
    expect(headline({}, { inventoryHits: 2, ruleRedactions: 1 })).toBe(
      'Removed 3 secret values from a request to api.anthropic.com'
    )
    expect(headline({}, { ruleRedactions: 1 })).toBe(
      'Removed 1 secret value from a request to api.anthropic.com'
    )
  })

  test('an observed request says nothing was changed', () => {
    expect(headline({ outcome: 'observed' }, { mode: 'observe', placeholderCount: 1 })).toBe(
      'Saw 1 secret value in a request to api.anthropic.com (observe mode, nothing changed)'
    )
    expect(headline({ outcome: 'observed' }, { mode: 'observe', placeholderCount: 4 })).toBe(
      'Saw 4 secret values in a request to api.anthropic.com (observe mode, nothing changed)'
    )
  })

  test('a blocked request says where the secret sat', () => {
    expect(headline(BLOCKED, { where: 'url', inventoryHits: 1, placeholderCount: 1 })).toBe(
      'Blocked a request to api.anthropic.com with a secret in its URL'
    )
    expect(headline(BLOCKED, { where: 'url', placeholderCount: 2 })).toBe(
      'Blocked a request to api.anthropic.com with 2 secrets in its URL'
    )
    expect(headline(BLOCKED, { where: 'body,url' })).toBe(
      'Blocked a request to api.anthropic.com with a secret in its body and its URL'
    )
    expect(headline(BLOCKED, { where: 'trailer' })).toBe(
      'Blocked a request to api.anthropic.com with a secret in its trailer'
    )
    expect(headline(BLOCKED)).toBe('Blocked a request to api.anthropic.com with a secret in it')
    // A block is a block whatever outcome came with it.
    expect(headline({ proxyDecision: 'block', outcome: '' }, { where: 'url' })).toBe(
      'Blocked a request to api.anthropic.com with a secret in its URL'
    )
  })

  test('a reported finding says where it was left', () => {
    const reported = { outcome: 'reported' }
    expect(headline(reported, { where: 'body', signedFindings: 1 })).toBe(
      'Found a secret in signed text sent to api.anthropic.com and left it'
    )
    expect(headline(reported, { where: 'body', signedFindings: 3 })).toBe(
      'Found 3 secrets in signed text sent to api.anthropic.com and left them'
    )
    expect(headline(reported, { where: 'header', inventoryHits: 1, placeholderCount: 1 })).toBe(
      'Found a secret in a header sent to api.anthropic.com and left it'
    )
    expect(
      headline(reported, {
        where: 'body,header',
        inventoryHits: 1,
        placeholderCount: 1,
        signedFindings: 1,
      })
    ).toBe(
      'Found 2 secrets in the body, a header and signed text sent to api.anthropic.com and left them'
    )
    expect(headline(reported)).toBe('Found a secret in a request to api.anthropic.com and left it')
    expect(headline({ ...reported, host: '' }, { signedFindings: 1 })).toBe(
      'Found a secret in signed text and left it'
    )
  })

  test.each([
    [
      'body_over_limit',
      'Did not read a request to api.anthropic.com: the body was over the size limit',
    ],
    [
      'body_undecodable',
      'Did not read a request to api.anthropic.com: the body could not be decoded',
    ],
    ['message_not_json', 'Did not read a message to api.anthropic.com: it was not JSON'],
    ['message_compressed', 'Did not read a message to api.anthropic.com: it was compressed'],
    ['message_binary', 'Did not read a message to api.anthropic.com: it was binary'],
    [
      'tls_refused',
      "Did not read a connection to api.anthropic.com: the tool refused Phase's certificate",
    ],
    [
      'hello_unreadable',
      "Did not read a connection to api.anthropic.com: the tool's TLS hello could not be read",
    ],
    [
      'hello_resumption',
      'Did not read a connection to api.anthropic.com: the tool resumed an earlier TLS session',
    ],
    [
      'hello_not_mirrored',
      "Did not read a connection to api.anthropic.com: the tool's TLS hello could not be copied",
    ],
    [
      'upstream_handshake_failed',
      "Did not read a connection to api.anthropic.com: Phase's own connection to the provider failed",
    ],
    [
      'upstream_not_http1',
      'Did not read a connection to api.anthropic.com: the provider chose a protocol other than HTTP/1.1',
    ],
  ])('an unread %s says what was not read and why', (reason, expected) => {
    expect(headline({ outcome: 'unread', reason })).toBe(expected)
  })

  test('a WebSocket message over the limit is a message, not a body', () => {
    expect(
      headline({
        outcome: 'unread',
        reason: 'body_over_limit',
        protocol: 'websocket',
        method: 'GET',
        host: 'chatgpt.com',
      })
    ).toBe('Did not read a message to chatgpt.com: it was over the size limit')
  })

  test('a reason not known here still reads as words', () => {
    expect(headline({ outcome: 'unread', reason: 'stream_reset_by_peer' })).toBe(
      'Did not read a request to api.anthropic.com: stream reset by peer'
    )
    expect(headline({ outcome: 'unread', reason: 'bodyTooDeep' })).toBe(
      'Did not read a request to api.anthropic.com: body too deep'
    )
    expect(headline({ outcome: 'unread', reason: '' })).toBe(
      'Did not read a request to api.anthropic.com'
    )
    expect(headline({ outcome: 'unread', reason: null })).toBe(
      'Did not read a request to api.anthropic.com'
    )
    expect(headline({ ...BYPASS, reason: 'pinned_certificate' }, { windowSeconds: 40 })).toBe(
      'Not reading chatgpt.com for 40 seconds: pinned certificate'
    )
    // On an outcome whose headline has no room for it, it gets a row of its own.
    expect(row('Reason', { reason: 'secret_in_header' }, {})).toEqual(['Secret in header'])
    expect(row('Reason', {}, {})).toBeUndefined()
    expect(row('Reason', { outcome: 'unread', reason: 'body_over_limit' }, {})).toBeUndefined()
  })

  test('a bypass names the host and how long it is not read', () => {
    expect(headline(BYPASS, { windowSeconds: 40 })).toBe(
      "Not reading chatgpt.com for 40 seconds: the tool refused Phase's certificate"
    )
    expect(headline(BYPASS, { windowSeconds: 1 })).toBe(
      "Not reading chatgpt.com for 1 second: the tool refused Phase's certificate"
    )
    expect(headline(BYPASS, { windowSeconds: 600 })).toBe(
      "Not reading chatgpt.com for 10 minutes: the tool refused Phase's certificate"
    )
    expect(headline({ ...BYPASS, reason: '' })).toBe(
      "Not reading chatgpt.com for a while: the tool refused Phase's certificate"
    )
    expect(row('Not reading for', BYPASS, { windowSeconds: 40 })).toEqual(['40 seconds'])
  })

  test('an outcome not known here is still shown, in words', () => {
    expect(headline({ outcome: 'quarantined' })).toBe(
      'Leak protection on a request to api.anthropic.com: quarantined'
    )
    expect(headline({ outcome: 'held_back', reason: 'review_pending' })).toBe(
      'Leak protection on a request to api.anthropic.com: held back, review pending'
    )
    expect(headline({ outcome: '', reason: '' })).toBe(
      'Leak protection checked a request to api.anthropic.com'
    )
    expect(described({ outcome: 'quarantined' }).outcome).toBe('Quarantined')
    expect(described({ outcome: null }).outcome).toBe('Unknown')
  })

  test('an event without a host or any detail still has a headline', () => {
    expect(headline({ host: '' })).toBe('Removed secret values from a request')
    expect(headline({ host: null, outcome: 'observed' })).toBe(
      'Saw secret values in a request (observe mode, nothing changed)'
    )
    expect(headline({ ...BYPASS, host: '' })).toBe(
      "Not reading this host for a while: the tool refused Phase's certificate"
    )
    for (const detail of [null, undefined, {}])
      expect(describeLeakProtection(event({ detail }))).toMatchObject({
        headline: 'Removed secret values from a request to api.anthropic.com',
        tone: 'neutral',
        severity: null,
        outcome: 'Censored',
        tool: '',
        capture: '',
        rows: [],
        placeholders: [],
        unlistedPlaceholders: 0,
        other: {},
      })
  })
})

describe('leak protection tone and severity', () => {
  test('a block and a high severity are danger; unread and bypass are warnings', () => {
    expect(described(BLOCKED).tone).toBe('danger')
    expect(described({}, { severity: 'high' }).tone).toBe('danger')
    expect(described({ outcome: 'unread' }, { severity: 'high' }).tone).toBe('danger')
    expect(described({ outcome: 'unread', reason: 'body_over_limit' }).tone).toBe('warning')
    expect(described(BYPASS).tone).toBe('warning')
    for (const outcome of ['censored', 'observed', 'reported'])
      expect(described({ outcome }, { severity: 'medium' }).tone).toBe('neutral')
    expect(described().tone).toBe('neutral')
  })

  test('the severity marker is there only when the event carries one', () => {
    expect(described({}, { severity: 'high' }).severity).toEqual({
      label: 'High severity',
      tone: 'danger',
    })
    expect(described({}, { severity: 'Medium' }).severity).toEqual({
      label: 'Medium severity',
      tone: 'warning',
    })
    expect(described({}, { severity: 'low' }).severity).toEqual({
      label: 'Low severity',
      tone: 'neutral',
    })
    expect(described({}, { severity: 'critical' }).severity).toEqual({
      label: 'Critical severity',
      tone: 'neutral',
    })
    expect(described().severity).toBeNull()
    expect(described({}, { severity: 3 }).severity).toBeNull()
  })

  test('the Status column gets the outcome in a word or two', () => {
    expect(
      ['censored', 'observed', 'reported', 'denied', 'unread', 'bypass'].map(
        (outcome) => described({ outcome }).outcome
      )
    ).toEqual(['Censored', 'Observed', 'Reported', 'Blocked', 'Not read', 'Reading paused'])
    expect(described({ proxyDecision: 'BLOCK', outcome: 'censored' }).outcome).toBe('Blocked')
  })
})

describe('leak protection detail rows', () => {
  test('names the tool and how its request reached Phase', () => {
    const tools = ['claude', 'codex', 'opencode', 'cursor'].map(
      (harness) => described({}, { harness }).tool
    )
    expect(tools).toEqual(['Claude Code', 'Codex', 'OpenCode', 'Cursor'])
    // The same names the Agents screens use.
    expect(tools).toEqual(
      ['claude_code', 'codex', 'opencode', 'cursor'].map((type) => agentHarnessMeta(type).label)
    )
    expect(described({}, { capture: 'proxy' }).capture).toBe('Phase AI proxy')
    expect(described({}, { capture: 'tunnel' }).capture).toBe('phase up')
  })

  test('a tool or a capture not known here reads as words', () => {
    expect(described({}, { harness: 'gemini_cli' }).tool).toBe('Gemini CLI')
    expect(described({}, { harness: 'Windsurf' }).tool).toBe('Windsurf')
    expect(described({}, { capture: 'browser_extension' }).capture).toBe('Browser extension')
    expect(row('Tool', {}, { harness: 'gemini_cli' })).toEqual(['Gemini CLI'])
    expect(row('Tool', {}, {})).toBeUndefined()
    expect(row('Captured by', {}, { harness: 'claude' })).toBeUndefined()
  })

  test('lays out a whole event in order, with the counts in words', () => {
    expect(
      described(
        {},
        {
          mode: 'censor',
          harness: 'claude',
          capture: 'proxy',
          severity: 'high',
          where: 'body,url',
          inventoryHits: 3,
          ruleRedactions: 1,
          ruleAlerts: 2,
          signedFindings: 1,
          placeholderCount: 3,
          labels: 'aws_access_key_id,github_token,phase_agent_token',
        }
      ).rows
    ).toEqual([
      { label: 'Tool', lines: ['Claude Code'] },
      { label: 'Captured by', lines: ['Phase AI proxy'] },
      { label: 'Mode', lines: ['Censor'] },
      { label: 'Severity', lines: ['High'] },
      { label: 'Found in', lines: ['Body and URL'] },
      {
        label: 'Found',
        lines: [
          '3 known secret values',
          '1 token format replaced',
          '2 token-shaped strings noted, not replaced',
          '1 found in signed text, left alone',
          '3 distinct secrets in the request',
        ],
      },
      { label: 'Token formats', lines: ['AWS access key ID, GitHub token, Phase Agent token'] },
    ])
  })

  test('gets singular and plural right, and leaves out a count of zero', () => {
    expect(
      row(
        'Found',
        {},
        {
          inventoryHits: 1,
          ruleRedactions: 2,
          ruleAlerts: 1,
          signedFindings: 2,
          placeholderCount: 1,
        }
      )
    ).toEqual([
      '1 known secret value',
      '2 token formats replaced',
      '1 token-shaped string noted, not replaced',
      '2 found in signed text, left alone',
      '1 distinct secret in the request',
    ])
    expect(
      row('Found', {}, { inventoryHits: 2, ruleRedactions: 0, ruleAlerts: 0, signedFindings: 0 })
    ).toEqual(['2 known secret values'])
    expect(row('Found', {}, { inventoryHits: 0, ruleRedactions: 0 })).toBeUndefined()
    expect(row('Found', {}, { inventoryHits: -1, ruleAlerts: 'many' })).toBeUndefined()
  })

  test('says a token format was replaced only when the request was censored', () => {
    expect(row('Found', { outcome: 'observed' }, { ruleRedactions: 2 })).toEqual([
      '2 token formats found',
    ])
    expect(row('Found', BLOCKED, { ruleRedactions: 1 })).toEqual(['1 token format found'])
    expect(row('Found', { protocol: 'websocket', method: 'GET' }, { placeholderCount: 2 })).toEqual(
      ['2 distinct secrets in the message']
    )
  })

  test('reads the snake case keys the Console stores as well as the camel case ones', () => {
    const camel = {
      inventoryHits: 3,
      ruleRedactions: 1,
      ruleAlerts: 2,
      signedFindings: 1,
      placeholderCount: 2,
      windowSeconds: 40,
    }
    const snake = {
      inventory_hits: 3,
      rule_redactions: 1,
      rule_alerts: 2,
      signed_findings: 1,
      placeholder_count: 2,
      window_seconds: 40,
    }
    expect(described({}, snake)).toEqual(described({}, camel))
    expect(described(BYPASS, snake).headline).toBe(
      "Not reading chatgpt.com for 40 seconds: the tool refused Phase's certificate"
    )
    expect(row('Found', {}, { inventory_hits: '3' })).toEqual(['3 known secret values'])
  })

  test('puts token-format labels in words', () => {
    const formats = (labels: string) => row('Token formats', {}, { labels })?.[0]
    expect(formats('aws_access_key_id, aws_secret_access_key')).toBe(
      'AWS access key ID, AWS secret access key'
    )
    expect(formats('phase_pat,phase_service_token,phase_agent_token')).toBe(
      'Phase personal access token, Phase service token, Phase Agent token'
    )
    expect(formats('jwt,private_key,private_key_header,slack_token,stripe_key')).toBe(
      'JWT, Private key, Private key header, Slack token, Stripe key'
    )
    expect(formats('keyword_secret')).toBe('Value after a secret-sounding name')
    expect(formats('openai_api_key,npm_token,pypi_token,huggingface_token')).toBe(
      'OpenAI API key, npm token, PyPI token, Hugging Face token'
    )
    // A format added to the CLI later.
    expect(formats('acme_deploy_key')).toBe('Acme deploy key')
    expect(formats('')).toBeUndefined()
  })

  test('says where the findings sat', () => {
    expect(row('Found in', {}, { where: 'url' })).toEqual(['URL'])
    expect(row('Found in', {}, { where: 'body, header ,url' })).toEqual(['Body, header and URL'])
    expect(row('Found in', {}, { where: 'query_string' })).toEqual(['Query string'])
    expect(row('Mode', {}, { mode: 'observe' })).toEqual(['Observe'])
  })

  test('keeps detail it does not know, and nothing it has put in words', () => {
    expect(
      described(
        {},
        {
          mode: 'censor',
          inventory_hits: 2,
          windowSeconds: 20,
          secrets: [],
          ruleVersion: 7,
          note: 'kept',
        }
      ).other
    ).toEqual({ ruleVersion: 7, note: 'kept' })
  })
})

describe('leak protection placeholders', () => {
  test('lists the placeholders once each, at most twenty', () => {
    expect(
      described({}, { placeholders: 'ph:secret:a1, ph:github_token:1 ,,ph:secret:a1' }).placeholders
    ).toEqual([
      { text: 'ph:secret:a1', secret: null },
      { text: 'ph:github_token:1', secret: null },
    ])
    const many = Array.from({ length: 25 }, (_, index) => `ph:secret:s${index}`).join(',')
    expect(described({}, { placeholders: many }).placeholders).toHaveLength(20)
    expect(described({}, { placeholders: 7 }).placeholders).toEqual([])
  })

  test('counts the distinct secrets the event does not name', () => {
    const listed = 'ph:secret:a1,ph:secret:b2'
    expect(described({}, { placeholders: listed, placeholderCount: 5 }).unlistedPlaceholders).toBe(
      3
    )
    expect(described({}, { placeholders: listed, placeholderCount: 2 }).unlistedPlaceholders).toBe(
      0
    )
    expect(described({}, { placeholders: listed }).unlistedPlaceholders).toBe(0)
  })

  const SECRETS = [
    {
      placeholder: 'ph:secret:s1',
      app_id: 'app-1',
      app_name: 'orders-service',
      environment_id: 'env-1',
      environment_name: 'Production',
      secret_id: 's1',
      path: '/billing/api keys',
    },
    {
      placeholder: 'ph:secret:s2',
      app_id: 'app-1',
      app_name: 'orders-service',
      environment_restricted: true,
    },
    { placeholder: 'ph:secret:s3', app_restricted: true },
  ]

  test('names the app and environment of a secret the viewer can access', () => {
    const [first, second, third, fourth] = described(
      {},
      {
        placeholders: 'ph:secret:s1,ph:secret:s2,ph:secret:s3,ph:github_token:1',
        secrets: SECRETS,
      }
    ).placeholders

    expect(first.secret).toEqual({
      label: 'A secret in orders-service (Production)',
      withheld: false,
      location: {
        appId: 'app-1',
        environmentId: 'env-1',
        path: '/billing/api keys',
        secretId: 's1',
      },
    })
    expect(second.secret).toEqual({
      label: "A secret in orders-service (an environment you can't access)",
      withheld: true,
      location: null,
    })
    expect(third.secret).toEqual({
      label: "A secret in an app you can't access",
      withheld: true,
      location: null,
    })
    expect(fourth.secret).toBeNull()
  })

  test('links to the secret on its environment page, in its folder', () => {
    const location = { appId: 'app-1', environmentId: 'env-1', secretId: 's1' }
    expect(leakSecretPath('acme', { ...location, path: '/' })).toBe(
      '/acme/apps/app-1/environments/env-1?secret=s1'
    )
    expect(leakSecretPath('acme', { ...location, path: '/billing/api keys' })).toBe(
      '/acme/apps/app-1/environments/env-1/billing/api%20keys?secret=s1'
    )
  })

  test('treats a name the backend left out as withheld, and ignores what is not a secret', () => {
    const { placeholders } = described(
      {},
      {
        placeholders: 'ph:secret:s1,ph:secret:s2,ph:secret:s3',
        secrets: [
          { placeholder: 'ph:secret:s1', app_id: 'app-1', app_name: null },
          { placeholder: 'ph:secret:s2', app_name: 'orders-service', environment_name: null },
          'ph:secret:s3',
          { app_name: 'orders-service' },
          null,
        ],
      }
    )
    expect(placeholders.map(({ secret }) => secret?.label ?? null)).toEqual([
      "A secret in an app you can't access",
      "A secret in orders-service (an environment you can't access)",
      null,
    ])
    expect(
      described({}, { placeholders: 'ph:secret:s1', secrets: 'spoofed' }).placeholders
    ).toEqual([{ text: 'ph:secret:s1', secret: null }])
  })
})

describe('other events', () => {
  test('an event of another type is not described here', () => {
    for (const eventType of ['request', 'app_secrets', 'leak', ''])
      expect(
        describeLeakProtection(event({ eventType }, { placeholders: 'ph:secret:a1' }))
      ).toBeNull()
  })
})
