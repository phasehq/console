import { syncDestination } from '@/utils/syncing/destination'

const dest = (serviceId: string, options: Record<string, unknown>) =>
  syncDestination(serviceId, JSON.stringify(options))

describe('syncDestination', () => {
  it('names repos, orgs and projects', () => {
    expect(
      dest('github_actions', { owner: 'acme', repo_name: 'web', environment_name: 'production' })
    ).toBe('acme/web (production)')
    expect(dest('github_dependabot', { owner: 'acme', repo_name: 'web' })).toBe('acme/web')
    expect(dest('github_actions', { org: 'acme', org_sync: true, visibility: 'private' })).toBe(
      'acme (private repos)'
    )
    expect(dest('gitlab_ci', { resource_path: 'acme/web', masked: true })).toBe('acme/web')
    expect(
      dest('vercel', {
        team: { name: 'acme' },
        project: { name: 'web' },
        environment: 'preview',
      })
    ).toBe('acme/web (preview)')
    expect(
      dest('railway', {
        project: { name: 'shop' },
        service: { name: 'api' },
        environment: { name: 'prod' },
      })
    ).toBe('shop / api (prod)')
    expect(dest('cloudflare_pages', { project_name: 'docs', environment: 'production' })).toBe(
      'docs (production)'
    )
    expect(dest('cloudflare_workers', { worker_name: 'edge' })).toBe('edge')
    expect(dest('render', { resource_name: 'api-prod' })).toBe('api-prod')
    expect(dest('supabase_edge_functions', { project_name: 'shop' })).toBe('shop')
  })

  it('names secret stores and paths', () => {
    expect(dest('aws_secrets_manager', { secret_name: 'prod/web' })).toBe('prod/web')
    expect(
      dest('gcp_secret_manager', { project_id: 'p', sync_mode: 'blob', secret_name: 'web-env' })
    ).toBe('p/web-env')
    expect(
      dest('gcp_secret_manager', { project_id: 'p', sync_mode: 'individual', prefix: 'WEB_' })
    ).toBe('p/WEB_*')
    expect(dest('gcp_secret_manager', { project_id: 'p', sync_mode: 'individual' })).toBe('p')
    expect(
      dest('azure_key_vault', {
        vault_uri: 'https://prod-kv.vault.azure.net/',
        sync_mode: 'individual',
      })
    ).toBe('prod-kv')
    expect(
      dest('azure_key_vault', {
        vault_uri: 'https://prod-kv.vault.azure.net/',
        sync_mode: 'blob',
        secret_name: 'web',
      })
    ).toBe('prod-kv/web')
    expect(dest('hashicorp_vault', { engine: 'secret/', path: 'web/prod' })).toBe(
      'secret/data/web/prod'
    )
    expect(dest('hashicorp_nomad', { path: 'jobs/web' })).toBe('jobs/web@default')
  })

  it('returns null for unknown services and unreadable options', () => {
    expect(dest('datadog', { site: 'us5' })).toBeNull()
    expect(syncDestination('aws_secrets_manager', 'not json')).toBeNull()
    expect(syncDestination('aws_secrets_manager', null)).toBeNull()
    expect(dest('github_actions', { owner: 'acme' })).toBeNull()
  })

  it('accepts options that are already parsed', () => {
    expect(syncDestination('aws_secrets_manager', { secret_name: 'prod/web' })).toBe('prod/web')
  })
})
