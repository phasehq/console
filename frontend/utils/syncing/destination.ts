/** Sync options arrive as a JSON string; parse them leniently. */
const parseOptions = (options: unknown): Record<string, any> | null => {
  if (!options) return null
  if (typeof options === 'object') return options as Record<string, any>
  try {
    const parsed = JSON.parse(String(options))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

const withQualifier = (name?: string | null, qualifier?: string | null) =>
  name ? (qualifier ? `${name} (${qualifier})` : name) : null

/**
 * Where a sync writes to, as one line: a repo, project, path or secret name.
 * Reads the same options as ServiceInfo; null when the service or options are unknown.
 */
export const syncDestination = (
  serviceId: string | null | undefined,
  options: unknown
): string | null => {
  const o = parseOptions(options)
  if (!serviceId || !o) return null

  switch (serviceId) {
    case 'github_actions':
    case 'github_dependabot':
      if (o.org_sync)
        return withQualifier(o.org, o.visibility === 'private' ? 'private repos' : 'all repos')
      if (!o.owner || !o.repo_name) return null
      return withQualifier(`${o.owner}/${o.repo_name}`, o.environment_name)
    case 'aws_secrets_manager':
      return o.secret_name ?? null
    case 'gcp_secret_manager': {
      if (!o.project_id) return null
      if (o.sync_mode === 'blob' && o.secret_name) return `${o.project_id}/${o.secret_name}`
      return o.prefix ? `${o.project_id}/${o.prefix}*` : o.project_id
    }
    case 'azure_key_vault': {
      const vault = String(o.vault_uri ?? '')
        .replace(/^https?:\/\//, '')
        .replace(/\.vault\..+$/, '')
      if (!vault) return null
      return o.sync_mode === 'blob' && o.secret_name ? `${vault}/${o.secret_name}` : vault
    }
    case 'hashicorp_vault':
      if (!o.path) return null
      return o.engine ? `${o.engine}data/${o.path}` : o.path
    case 'hashicorp_nomad':
      return o.path ? `${o.path}@${o.namespace || 'default'}` : null
    case 'gitlab_ci':
      return o.resource_path ?? null
    case 'railway': {
      const project = o.project?.name
      if (!project) return null
      const name = o.service?.name ? `${project} / ${o.service.name}` : project
      return withQualifier(name, o.environment?.name)
    }
    case 'vercel': {
      const project = o.project?.name
      if (!project) return null
      return withQualifier(o.team?.name ? `${o.team.name}/${project}` : project, o.environment)
    }
    case 'render':
      return o.resource_name ?? null
    case 'supabase_edge_functions':
      return o.project_name ?? null
    case 'cloudflare_pages':
      return withQualifier(o.project_name, o.environment)
    case 'cloudflare_workers':
      return o.worker_name ?? null
    default:
      return null
  }
}
