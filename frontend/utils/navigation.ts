import { startCase } from 'lodash'
import { AppType, EnvironmentType } from '@/apollo/graphql'
import { isUUID } from '@/utils/copy'

export type NavigationItem = {
  label: string
  href?: string
  isLink?: boolean
}

export type NavigationContext = {
  team?: string | null
  context?: string | null
  appId?: string | null
  envId?: string | null
  page?: string | null
  subPage?: string | null
  activeApp?: AppType
  activeEnv?: EnvironmentType
  // Add support for non-team routes
  route?: string | null // e.g., 'signup', 'webauth', 'lockbox'
  routeParam?: string | null // e.g., boxId, requestCode
}

export const generateBreadcrumbs = (ctx: NavigationContext): NavigationItem[] => {
  const { team, context, page, subPage, activeApp, activeEnv, route, routeParam } = ctx

  // Handle non-team routes first
  if (route) {
    const breadcrumbs: NavigationItem[] = []

    switch (route) {
      case 'signup':
        breadcrumbs.push({ label: 'Sign Up', isLink: false })
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

  if (activeApp) {
    // App name should only be clickable if we're not at the app home
    const isAtAppHome = !page && !activeEnv
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
    if (page === 'environments' && activeEnv) {
      // For environment routes: /apps/[app]/environments/[environment]/[...path]
      breadcrumbs.push({
        label: 'environments',
        href: activeApp ? `/${team}/apps/${activeApp.id}` : undefined,
        isLink: Boolean(activeApp),
      })
      breadcrumbs.push({
        label: activeEnv.name,
        isLink: false,
      })
      // Add folder path if present
      if (subPage && !isUUID(subPage)) {
        breadcrumbs.push({
          label: subPage,
          isLink: false,
        })
      }
    } else {
      // For other app routes: /apps/[app]/[page]
      breadcrumbs.push({
        label: page,
        isLink: Boolean(activeApp),
      })
      // Add subPage if present and not in environments
      if (subPage && !isUUID(subPage)) {
        breadcrumbs.push({
          label: subPage,
          isLink: false,
        })
      }
    }
  } else if (activeEnv && !page) {
    breadcrumbs.push({
      label: activeEnv.name,
      isLink: false,
    })
  }

  return breadcrumbs
}

export const generatePageTitle = (ctx: NavigationContext): string => {
  const breadcrumbs = generateBreadcrumbs(ctx)

  // Filter out empty labels and reverse for title (most specific first)
  const titleParts = breadcrumbs
    .filter((crumb) => crumb.label && crumb.label.trim())
    .map((crumb, index) => {
      // Don't apply startCase to org names (first breadcrumb)
      if (index === 0) {
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
