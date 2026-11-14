import { startCase } from 'lodash'
import { AppType } from '@/apollo/graphql'
import { isUUID } from '@/utils/copy'
import { agentsPath } from '@/utils/agents/routes'

export type NavigationItem = {
  label: string
  href?: string
  isLink?: boolean
}

export type NavigationContext = {
  team?: string | null
  context?: string | null
  appId?: string | null
  page?: string | null
  subPage?: string | null
  activeApp?: AppType
  // Add support for non-team routes
  route?: string | null // e.g., 'signup', 'webauth', 'lockbox'
  routeParam?: string | null // e.g., boxId, requestCode
}

export type SectionPage = {
  name: string
  link: string
}

// Sub-pages of the org-level sections, shared by the sidebar and each section's tab bar.
export const ACCESS_PAGES: SectionPage[] = [
  { name: 'Members', link: 'members' },
  { name: 'Service Accounts', link: 'service-accounts' },
  { name: 'Agents', link: 'agents' },
  { name: 'Teams', link: 'teams' },
  { name: 'Roles', link: 'roles' },
  { name: 'Single Sign-On', link: 'sso' },
  { name: 'SCIM', link: 'scim' },
  { name: 'External Identities', link: 'identities' },
  { name: 'Authentication', link: 'authentication' },
  { name: 'Network', link: 'network' },
]

export const getIntegrationPages = (canReadLogStreams: boolean): SectionPage[] => [
  { name: 'Integrations', link: '' },
  { name: 'Syncs', link: 'syncs' },
  { name: 'Dynamic Secrets', link: 'dynamic-secrets' },
  ...(canReadLogStreams ? [{ name: 'Log Streams', link: 'log-streams' }] : []),
]

export const generateBreadcrumbs = (ctx: NavigationContext): NavigationItem[] => {
  const { team, context, page, subPage, activeApp, route, routeParam } = ctx

  // Handle non-team routes first
  if (route) {
    const breadcrumbs: NavigationItem[] = []

    switch (route) {
      case 'signup':
        breadcrumbs.push({ label: 'Sign Up', isLink: false })
        break
      case 'onboard':
        breadcrumbs.push({ label: 'Create Organisation', isLink: false })
        break
      case 'login':
        breadcrumbs.push({ label: 'Login', isLink: false })
        break
      case 'webauth':
        breadcrumbs.push({ label: 'WebAuth', isLink: false })
        break
      case 'lockbox':
        breadcrumbs.push({ label: 'Lockbox', isLink: false })
        break
      case 'invite':
        breadcrumbs.push({ label: 'Invitation', isLink: false })
        break
      case 'ip-restricted':
        breadcrumbs.push({ label: 'Access Restricted', isLink: false })
        break
      default:
        breadcrumbs.push({ label: startCase(route), isLink: false })
    }

    return breadcrumbs
  }

  // Team-based routes (existing logic)
  const breadcrumbs: NavigationItem[] = [
    { label: team ?? '', href: `/${team}`, isLink: Boolean(team) },
  ]

  if (context === 'agents') {
    breadcrumbs.push({
      label: 'Agents',
      href: page && team ? agentsPath(team) : undefined,
      isLink: Boolean(page && team),
    })
    if (page) {
      breadcrumbs.push({
        label: isUUID(page) ? 'Agent' : page,
        isLink: false,
      })
    }
    return breadcrumbs
  }

  if (context === 'requests') {
    breadcrumbs.push({ label: 'Change Requests', isLink: false })
    return breadcrumbs
  }

  if (activeApp) {
    // App name should only be clickable if we're not at the app home
    const isAtAppHome = !page
    breadcrumbs.push({
      label: activeApp.name,
      href: isAtAppHome ? undefined : `/${team}/apps/${activeApp.id}`,
      isLink: !isAtAppHome, // Only clickable when not at app home
    })
  }

  if (!activeApp && context && page === undefined) {
    breadcrumbs.push({
      label: context,
      isLink: false,
    })
  }

  // Handle different app sections
  if (page) {
    // /apps/[app]/[page]
    breadcrumbs.push({
      label: page,
      isLink: Boolean(activeApp),
    })
    if (subPage && !isUUID(subPage)) {
      breadcrumbs.push({
        label: subPage,
        isLink: false,
      })
    }
  }

  return breadcrumbs
}

export const generatePageTitle = (ctx: NavigationContext): string => {
  const breadcrumbs = generateBreadcrumbs(ctx)
  // The app home lists the app's secrets; its breadcrumb is only the app name.
  if (ctx.activeApp && !ctx.page && !ctx.activeEnv)
    breadcrumbs.push({ label: 'Secrets', isLink: false })

  const filteredCrumbs = breadcrumbs.filter((crumb) => crumb.label && crumb.label.trim())

  // Apply startCase to all except the first breadcrumb (team/org name)
  const titleParts = filteredCrumbs
    .map((crumb, index) => {
      if (index === 0 && ctx.team) {
        return crumb.label
      }
      return startCase(crumb.label)
    })
    .reverse()

  if (titleParts.length === 0) {
    return 'Phase Console'
  }

  return `${titleParts.join(' · ')} | Phase Console`
}
