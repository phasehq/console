'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import {
  FaCog,
  FaCubes,
  FaHome,
  FaPlus,
  FaUsersCog,
  FaProjectDiagram,
  FaBook,
  FaChevronRight,
  FaEllipsisH,
  FaExternalLinkAlt,
  FaSun,
  FaMoon,
  FaPalette,
  FaUserCircle,
  FaBuilding,
  FaChevronUp,
  FaQuestionCircle,
  FaSlack,
  FaGithub,
} from 'react-icons/fa'
import { TbLayoutSidebarLeftCollapseFilled, TbLayoutSidebarLeftExpandFilled } from 'react-icons/tb'
import { IconType } from 'react-icons'
import { useQuery } from '@apollo/client'
import { organisationContext } from '@/contexts/organisationContext'
import { SidebarContext } from '@/contexts/sidebarContext'
import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppType, OrganisationType } from '@/apollo/graphql'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { Menu, Popover, Transition } from '@headlessui/react'
import { LogoWordMark } from '../common/LogoWordMark'
import { SIDEBAR_WIDTH, SidebarResizeHandle } from './SidebarResizeHandle'
import { ModeToggle } from '../common/ModeToggle'
import { PlanLabel } from '../settings/organisation/PlanLabel'
import { FaCodeMerge, FaListUl } from 'react-icons/fa6'
import { userHasGlobalAccess, userHasPermission } from '@/utils/access/permissions'
import { sortApps } from '@/utils/app'
import { ACCESS_PAGES, getIntegrationPages } from '@/utils/navigation'

type SidebarSubLinkT = {
  name: string
  href: string
  active: boolean
  muted?: boolean
}

export type SidebarLinkT = {
  name: string
  href: string
  icon: React.ReactNode
  active: boolean
  sublinks?: SidebarSubLinkT[]
  defaultOpen?: boolean
}

const MAX_SIDEBAR_APPS = 5
const OPEN_GROUPS_KEY = 'sidebar-groups'

const ACTIVE_BG = 'bg-zinc-900/10 dark:bg-white/10'
const ACTIVE_TEXT = 'text-zinc-900 dark:text-zinc-100'
const HOVER_BG = 'hover:bg-zinc-900/5 dark:hover:bg-white/5'
const INACTIVE_STYLE =
  'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
const TOOLTIP_STYLE =
  'invisible group-hover/item:visible absolute left-full ml-4 top-1/2 -translate-y-1/2 bg-zinc-800 text-white px-2 py-1 rounded text-xs whitespace-nowrap z-50'

// How long the sidebar takes to collapse or expand. Must match the duration in SLIDE
const SLIDE_MS = 300
// Applied only while that runs, so the sidebar never animates on load or while it is resized
const SLIDE =
  'transition-[width,height,grid-template-columns,opacity] duration-300 ease-in-out motion-reduce:transition-none'

// Fades its child in and out as the sidebar expands and collapses
const Fade = ({ show, children }: { show: boolean; children: React.ReactElement }) => (
  <Transition
    as={Fragment}
    enter="transition ease-out duration-100"
    enterFrom="opacity-0"
    enterTo="opacity-100"
    leave="transition ease-in duration-75"
    leaveFrom="opacity-100"
    leaveTo="opacity-0"
    show={show}
  >
    {children}
  </Transition>
)

const SidebarSubLink = ({ sublink }: { sublink: SidebarSubLinkT }) => (
  <Link
    href={sublink.href}
    title={sublink.name}
    aria-current={sublink.active ? 'page' : undefined}
    className={clsx(
      'block truncate rounded-md px-2 py-0.5 text-xs font-medium transition ease',
      sublink.active
        ? [ACTIVE_BG, ACTIVE_TEXT]
        : [
            HOVER_BG,
            sublink.muted
              ? 'text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100'
              : INACTIVE_STYLE,
          ]
    )}
  >
    {sublink.name}
  </Link>
)

const SidebarItem = ({
  link,
  collapsed,
  animating,
  open = false,
  setOpen,
}: {
  link: SidebarLinkT
  collapsed: boolean
  animating: boolean
  open?: boolean
  setOpen?: (open: boolean) => void
}) => {
  const sublinks = link.sublinks ?? []
  const hasSublinks = sublinks.length > 0
  const showSublinks = hasSublinks && open && !collapsed
  // The highlight moves to the active sublink while it is visible
  const highlighted = link.active && !(showSublinks && sublinks.some((sublink) => sublink.active))

  return (
    <div className="group/item relative">
      <div
        className={clsx(
          'flex h-9 items-center rounded-lg transition ease',
          highlighted ? ACTIVE_BG : HOVER_BG
        )}
      >
        <Link
          href={link.href}
          onClick={() => setOpen?.(true)}
          aria-current={highlighted ? 'page' : undefined}
          aria-label={collapsed ? link.name : undefined}
          className={clsx(
            'flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-xs font-semibold whitespace-nowrap transition ease',
            link.active ? ACTIVE_TEXT : INACTIVE_STYLE
          )}
        >
          <div className="text-base">{link.icon}</div>
          <Fade show={!collapsed}>
            {/* Clipped, not ellipsised, while the sidebar opens over it */}
            <span className={clsx('truncate', animating && 'text-clip')}>{link.name}</span>
          </Fade>
        </Link>
        <Fade show={hasSublinks && !collapsed}>
          <button
            type="button"
            onClick={() => setOpen?.(!open)}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${link.name}`}
            className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-zinc-100"
          >
            <FaChevronRight
              className={clsx('size-2.5 transition-transform ease', open && 'rotate-90')}
            />
          </button>
        </Fade>
      </div>

      {hasSublinks && (
        <div
          inert={!showSublinks}
          className={clsx(
            'grid',
            // Not for a sidebar that loads as the rail: its groups would be seen closing
            (animating || !collapsed) && 'transition-[grid-template-rows] duration-200 ease-out',
            showSublinks ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
            <ul
              className={clsx(
                'ml-5 mt-1 space-y-0.5 border-l border-neutral-500/20 pl-[7px]',
                animating && '[&_a]:text-clip'
              )}
            >
              {sublinks.map((sublink) => (
                <li key={sublink.href}>
                  <SidebarSubLink sublink={sublink} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {collapsed &&
        (hasSublinks ? (
          // pl-4 bridges the hover gap; the hide delay lets Tab move focus into the flyout
          <div className="invisible absolute left-full top-0 z-50 pl-4 transition-[visibility] delay-100 duration-0 group-hover/item:visible group-hover/item:delay-0 group-has-[:focus-visible]/item:visible group-has-[:focus-visible]/item:delay-0">
            <div className="w-52 rounded-md bg-neutral-200 p-1 shadow-2xl ring-1 ring-inset ring-neutral-500/40 dark:bg-neutral-800">
              <div className="px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-neutral-500">
                {link.name}
              </div>
              <ul className="space-y-0.5">
                {sublinks.map((sublink) => (
                  <li key={sublink.href}>
                    <SidebarSubLink sublink={sublink} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className={TOOLTIP_STYLE}>{link.name}</div>
        ))}
    </div>
  )
}

// px-[13px] makes a button with a closed label 40px wide, with its icon under the nav icons
const FOOTER_ITEM_STYLE =
  'flex h-8 items-center rounded-md px-[13px] text-2xs font-medium whitespace-nowrap transition ease'
const FOOTER_ICON_SLOT = 'flex size-3.5 shrink-0 items-center justify-center text-sm'
const MENU_ROW_STYLE = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs transition ease'
const MENU_ROW_ICON = 'size-3.5 shrink-0 text-neutral-500'

const HELP_LINKS: { name: string; href: string; icon: IconType }[] = [
  { name: 'Docs', href: 'https://docs.phase.dev', icon: FaBook },
  { name: 'Join Slack', href: 'https://slack.phase.dev', icon: FaSlack },
  { name: 'GitHub', href: 'https://github.com/phasehq/console', icon: FaGithub },
  { name: 'Changelog', href: 'https://phase.dev/changelog', icon: FaCodeMerge },
]

const FooterMenuLink = ({
  href,
  icon: Icon,
  external = false,
  current = false,
  onClick,
  children,
}: {
  href: string
  icon: IconType
  external?: boolean
  current?: boolean
  onClick: () => void
  children: React.ReactNode
}) => (
  <Link
    href={href}
    target={external ? '_blank' : undefined}
    onClick={onClick}
    aria-current={current ? 'page' : undefined}
    className={clsx(
      MENU_ROW_STYLE,
      current ? [ACTIVE_BG, ACTIVE_TEXT] : [HOVER_BG, INACTIVE_STYLE]
    )}
  >
    <Icon className={MENU_ROW_ICON} />
    <span className="flex-1">{children}</span>
    {external && <FaExternalLinkAlt className="size-2 shrink-0 text-neutral-500" />}
  </Link>
)

// Closes to zero width instead of unmounting, so the button around it shrinks smoothly to its icon
const FooterLabel = ({
  show,
  animating,
  children,
}: {
  show: boolean
  animating: boolean
  children: React.ReactNode
}) => (
  <span
    className={clsx(
      'grid',
      animating && SLIDE,
      show ? 'grid-cols-[1fr]' : 'grid-cols-[0fr] opacity-0'
    )}
  >
    {/* The padding sits a level down: on the grid item it would keep the column from closing */}
    <span className="min-w-0 overflow-hidden">
      <span className="flex items-center gap-1.5 pl-1.5">{children}</span>
    </span>
  </span>
)

// Popover opened from the pinned bottom pane. A Popover, not a Menu, so Tab reaches the theme control
const SidebarFooterMenu = ({
  name,
  icon,
  active = false,
  align,
  collapsed,
  animating,
  children,
}: {
  name: string
  icon: React.ReactNode
  active?: boolean
  align: 'left' | 'right'
  collapsed: boolean
  animating: boolean
  children: (close: () => void) => React.ReactNode
}) => (
  <Popover
    className={clsx('group/item absolute', align === 'left' ? 'left-0 top-0' : 'bottom-0 right-0')}
  >
    {({ open }) => (
      <>
        {/* Headless focuses the button on click, which browsers draw as a keyboard focus ring */}
        <Popover.Button
          className={clsx(
            FOOTER_ITEM_STYLE,
            'outline-none data-[focus]:ring-2 data-[focus]:ring-neutral-500',
            active || open ? [ACTIVE_BG, ACTIVE_TEXT] : [HOVER_BG, INACTIVE_STYLE]
          )}
        >
          <span className={FOOTER_ICON_SLOT}>{icon}</span>
          <FooterLabel show={!collapsed} animating={animating}>
            {name}
            <FaChevronUp
              className={clsx('size-2 shrink-0 transition transform ease', open && 'rotate-180')}
            />
          </FooterLabel>
        </Popover.Button>
        {collapsed && !open && <div className={TOOLTIP_STYLE}>{name}</div>}
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          {/* Collapsed: opens beside its button. Expanded: spans the pane, above its button */}
          <Popover.Panel
            style={collapsed ? undefined : { width: `calc(${SIDEBAR_WIDTH} - 1.5rem)` }}
            className={clsx(
              'absolute z-20 divide-y divide-neutral-500/20 rounded-md bg-neutral-200 shadow-2xl ring-1 ring-inset ring-neutral-500/40 focus:outline-none dark:bg-neutral-800',
              collapsed
                ? 'bottom-0 left-full ml-4 w-56 origin-bottom-left'
                : [
                    'bottom-full mb-1',
                    align === 'left' ? 'left-0 origin-bottom-left' : 'right-0 origin-bottom-right',
                  ]
            )}
          >
            {({ close }) => <>{children(close)}</>}
          </Popover.Panel>
        </Transition>
      </>
    )}
  </Popover>
)

type FooterMenuProps = { collapsed: boolean; animating: boolean }

const HelpMenu = (props: FooterMenuProps) => (
  <SidebarFooterMenu name="Help" icon={<FaQuestionCircle />} align="left" {...props}>
    {(close) => (
      <div className="space-y-0.5 p-1">
        {HELP_LINKS.map(({ name, href, icon }) => (
          <FooterMenuLink key={name} href={href} icon={icon} external onClick={close}>
            {name}
          </FooterMenuLink>
        ))}
      </div>
    )}
  </SidebarFooterMenu>
)

const SettingsMenu = ({
  team,
  active,
  ...props
}: FooterMenuProps & { team: string; active: boolean }) => (
  <SidebarFooterMenu name="Settings" icon={<FaCog />} active={active} align="right" {...props}>
    {(close) => (
      <>
        <div className="p-1">
          <div className={clsx(MENU_ROW_STYLE, 'text-zinc-600 dark:text-zinc-400')}>
            <FaPalette className={MENU_ROW_ICON} />
            <span className="flex-1">Theme</span>
            <div className="flex items-center gap-2 text-neutral-500">
              <FaSun />
              <ModeToggle />
              <FaMoon />
            </div>
          </div>
        </div>
        <div className="space-y-0.5 p-1">
          <FooterMenuLink href="/account" icon={FaUserCircle} onClick={close}>
            Account settings
          </FooterMenuLink>
          <FooterMenuLink
            href={`/${team}/settings`}
            icon={FaBuilding}
            current={active}
            onClick={close}
          >
            Organisation settings
          </FooterMenuLink>
        </div>
      </>
    )}
  </SidebarFooterMenu>
)

const SidebarCollapseToggle = ({
  collapsed,
  animating,
  onToggle,
}: FooterMenuProps & { onToggle: () => void }) => {
  const Icon = collapsed ? TbLayoutSidebarLeftExpandFilled : TbLayoutSidebarLeftCollapseFilled

  return (
    <div className="group/item relative mb-1 flex">
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={clsx(
          FOOTER_ITEM_STYLE,
          'outline-none focus-visible:ring-2 focus-visible:ring-neutral-500',
          HOVER_BG,
          INACTIVE_STYLE
        )}
      >
        <span className={FOOTER_ICON_SLOT}>
          <Icon className="size-[18px] shrink-0" />
        </span>
        <FooterLabel show={!collapsed} animating={animating}>
          Collapse
        </FooterLabel>
      </button>
      {collapsed && <div className={TOOLTIP_STYLE}>Expand sidebar</div>}
    </div>
  )
}

const MobileMoreMenu = ({
  overflowLinks,
  organisations,
  activeOrganisation,
  isOwner,
}: {
  overflowLinks: SidebarLinkT[]
  organisations: OrganisationType[] | null
  activeOrganisation: OrganisationType | null
  isOwner: boolean
}) => {
  return (
    <Menu as="div" className="relative flex-1 min-w-0">
      {({ open }) => (
        <>
          <Menu.Button
            className={clsx(
              'flex w-full h-14 flex-col items-center justify-center gap-0.5 px-1 transition-colors',
              open || overflowLinks.some((link) => link.active)
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-zinc-600 dark:text-zinc-400'
            )}
            aria-label="More navigation"
            title="More"
          >
            <FaEllipsisH className="text-lg" />
            <span className="text-[10px] font-medium">More</span>
          </Menu.Button>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 translate-y-1"
            enterTo="transform opacity-100 translate-y-0"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 translate-y-0"
            leaveTo="transform opacity-0 translate-y-1"
          >
            <Menu.Items className="absolute bottom-full right-2 mb-2 w-64 origin-bottom-right divide-y divide-neutral-500/40 rounded-md bg-neutral-200 p-1 shadow-2xl ring-1 ring-inset ring-neutral-500/40 focus:outline-none dark:bg-neutral-800">
              <div className="px-2 py-2 text-xs font-medium text-neutral-500">Organisation</div>
              <div className="py-1">
                {organisations?.map((org: OrganisationType) => (
                  <Menu.Item key={org.id}>
                    {({ active }) => (
                      <Link
                        href={`/${org.name}`}
                        className={clsx(
                          'flex items-center justify-between gap-2 rounded px-2 py-2 text-sm',
                          active && 'bg-neutral-100 dark:bg-neutral-700'
                        )}
                      >
                        <span className="truncate">{org.name}</span>
                        {org.id === activeOrganisation?.id && (
                          <span className="text-emerald-500">Current</span>
                        )}
                      </Link>
                    )}
                  </Menu.Item>
                ))}
                {!isOwner && (
                  <Menu.Item>
                    {({ active }) => (
                      <Link
                        href="/onboard"
                        className={clsx(
                          'flex items-center gap-3 rounded px-2 py-2 text-sm',
                          active && 'bg-neutral-100 dark:bg-neutral-700'
                        )}
                      >
                        <FaPlus />
                        Create New Organisation
                      </Link>
                    )}
                  </Menu.Item>
                )}
              </div>
              <div className="py-1">
                {overflowLinks.map((link) => (
                  <Menu.Item key={link.name}>
                    {({ active }) => (
                      <Link
                        href={link.href}
                        className={clsx(
                          'flex items-center gap-3 rounded px-2 py-2 text-sm',
                          active && 'bg-neutral-100 dark:bg-neutral-700',
                          link.active && 'text-emerald-600 dark:text-emerald-400'
                        )}
                      >
                        {link.icon}
                        {link.name}
                      </Link>
                    )}
                  </Menu.Item>
                ))}
              </div>
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  )
}

const Sidebar = () => {
  const { sidebarState, setUserPreference } = useContext(SidebarContext)
  // Windows too narrow for the full sidebar get the icon rail, whatever the user chose
  const [isAutoCollapsed, setIsAutoCollapsed] = useState(false)
  const collapsed = isAutoCollapsed || sidebarState === 'collapsed'
  // True while the sidebar moves between the two: see SLIDE
  const [animating, setAnimating] = useState(false)
  const animationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pathname = usePathname()
  const [, team, section, page] = pathname?.split('/') ?? []
  const { organisations, activeOrganisation } = useContext(organisationContext)
  // Orgs pending deletion are locked, so they can't be switched to.
  const switchableOrganisations = organisations?.filter((org) => !org.deletedAt) ?? null
  const isOwner = organisations?.some((org) => org.role!.name!.toLowerCase() === 'owner')

  const navRef = useRef<HTMLElement>(null)

  const stopAnimating = useCallback(() => {
    clearTimeout(animationTimer.current)
    setAnimating(false)
  }, [])

  const animate = useCallback(() => {
    setAnimating(true)
    clearTimeout(animationTimer.current)
    // A fallback: the width transition normally ends it, but reduced motion has no transition
    animationTimer.current = setTimeout(stopAnimating, SLIDE_MS + 50)
  }, [stopAnimating])

  useEffect(() => () => clearTimeout(animationTimer.current), [])

  useEffect(() => {
    let wasNarrow: boolean | null = null

    const handleResize = () => {
      const narrow = window.innerWidth <= 1024
      // Not on load, when there is nothing to move from
      if (wasNarrow !== null && wasNarrow !== narrow) animate()
      wasNarrow = narrow
      setIsAutoCollapsed(narrow)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [animate])

  const toggleCollapsed = () => {
    animate()
    setUserPreference(collapsed ? 'expanded' : 'collapsed')
  }

  // null until the stored state has loaded, so it isn't overwritten on mount
  const [openGroups, setOpenGroups] = useState<Record<string, boolean> | null>(null)

  const setGroupOpen = useCallback(
    (name: string, open: boolean) =>
      setOpenGroups((current) =>
        current?.[name] === open ? current : { ...current, [name]: open }
      ),
    []
  )

  useEffect(() => {
    let stored: Record<string, boolean> = {}
    try {
      stored = JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? '{}') ?? {}
    } catch {
      // Storage can be blocked, or hold something that isn't JSON
    }
    setOpenGroups((current) => ({ ...stored, ...current }))
  }, [])

  useEffect(() => {
    if (openGroups === null) return
    try {
      localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(openGroups))
    } catch {
      // Storage can be blocked; the groups then reset when the page reloads
    }
  }, [openGroups])

  const permissions = activeOrganisation?.role?.permissions
  const userCanReadApps = userHasPermission(permissions, 'Apps', 'read')
  const userCanReadLogStreams =
    userHasPermission(permissions, 'LogStreams', 'read') && userHasGlobalAccess(permissions)

  const { data: appsData } = useQuery(GetApps, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !activeOrganisation || !userCanReadApps,
  })

  const appLinks = useMemo(() => {
    const apps = sortApps((appsData?.apps as AppType[]) ?? [], '-updated')
    const shown = apps.slice(0, MAX_SIDEBAR_APPS)
    // Keep the open app listed even when it falls outside the shortlist
    const openApp = section === 'apps' ? apps.find((app) => app.id === page) : undefined
    if (openApp && !shown.includes(openApp)) shown.push(openApp)

    const sublinks: SidebarSubLinkT[] = shown.map((app) => ({
      name: app.name,
      href: `/${team}/apps/${app.id}`,
      active: app === openApp,
    }))
    if (apps.length > shown.length)
      sublinks.push({
        name: `All apps (${apps.length})`,
        href: `/${team}/apps`,
        active: false,
        muted: true,
      })
    return sublinks
  }, [appsData, team, section, page])

  const links: SidebarLinkT[] = [
    {
      name: 'Home',
      href: `/${team}`,
      icon: <FaHome />,
      active: pathname === `/${team}`,
    },
    {
      name: 'Apps',
      href: `/${team}/apps`,
      icon: <FaCubes />,
      active: section === 'apps',
      sublinks: appLinks,
      defaultOpen: true,
    },
    {
      name: 'Integrations',
      href: `/${team}/integrations/syncs`,
      icon: <FaProjectDiagram />,
      active: section === `integrations`,
      sublinks: getIntegrationPages(userCanReadLogStreams).map(({ name, link }) => ({
        name,
        href: `/${team}/integrations/${link}`,
        active: section === 'integrations' && page === link,
      })),
    },
    {
      name: 'Access Control',
      href: `/${team}/access/members`,
      icon: <FaUsersCog />,
      active: section === `access`,
      sublinks: ACCESS_PAGES.map(({ name, link }) => ({
        name,
        href: `/${team}/access/${link}`,
        active: section === 'access' && page === link,
      })),
    },
    {
      name: 'Audit Logs',
      href: `/${team}/logs`,
      icon: <FaListUl />,
      active: section === `logs`,
    },
  ]

  const settingsActive = pathname === `/${team}/settings`

  const activeGroup = links.find((link) => link.active && link.sublinks)?.name

  // Entering a section opens its group
  useEffect(() => {
    if (activeGroup) setGroupOpen(activeGroup, true)
  }, [activeGroup, setGroupOpen])

  // Keep the current link in view once its group has finished opening
  useEffect(() => {
    const timeout = setTimeout(
      () =>
        navRef.current
          ?.querySelector('[aria-current="page"]:not([inert] *)')
          ?.scrollIntoView({ block: 'nearest' }),
      250
    )
    return () => clearTimeout(timeout)
  }, [pathname, appLinks.length])

  const mobileLinks = links.slice(0, 4)
  const overflowLinks: SidebarLinkT[] = [
    ...links.slice(4),
    { name: 'Settings', href: `/${team}/settings`, icon: <FaCog />, active: settingsActive },
  ]

  return (
    <>
      <aside
        style={collapsed ? undefined : { width: SIDEBAR_WIDTH }}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && event.propertyName === 'width')
            stopAnimating()
        }}
        className={clsx(
          'relative hidden h-dvh shrink-0 flex-col text-black dark:text-white md:flex',
          animating && SLIDE,
          collapsed && 'w-16'
        )}
      >
        {/* pl-[23px] centres the logo mark on the nav icons in both states */}
        <div className="flex h-12 shrink-0 items-center gap-1.5 overflow-hidden pl-[23px] pr-3">
          <Link href="/" aria-label="Phase" className="shrink-0">
            {/* The rail clips the wordmark down to its mark */}
            <div
              className={clsx(
                'overflow-hidden',
                animating && SLIDE,
                collapsed ? 'w-[18px]' : 'w-16'
              )}
            >
              <LogoWordMark className="w-16 max-w-none fill-black dark:fill-white" />
            </div>
          </Link>
          {activeOrganisation && (
            <Fade show={!collapsed}>
              <span className="flex">
                <PlanLabel plan={activeOrganisation.plan} size="sm" />
              </span>
            </Fade>
          )}
        </div>

        {/* The settled rail lets tooltips and flyouts overflow it. Otherwise the list scrolls and fades at its edges */}
        <nav
          ref={navRef}
          className={clsx(
            'flex min-h-0 flex-1 flex-col gap-1 p-3',
            collapsed && !animating
              ? 'overflow-visible'
              : 'overflow-y-auto scrollbar-hide scroll-py-6 pb-6 [mask-image:linear-gradient(to_bottom,transparent,black_0.75rem,black_calc(100%_-_1.5rem),transparent)]'
          )}
        >
          {links.map((link) => (
            <SidebarItem
              key={link.name}
              link={link}
              collapsed={collapsed}
              animating={animating}
              open={openGroups?.[link.name] ?? (link.active || !!link.defaultOpen)}
              setOpen={(open) => setGroupOpen(link.name, open)}
            />
          ))}
        </nav>

        <div className="shrink-0 border-t border-neutral-500/20 px-3 py-2">
          {/* A window too narrow for the full sidebar has nothing to expand into */}
          {!isAutoCollapsed && (
            <SidebarCollapseToggle
              collapsed={collapsed}
              animating={animating}
              onToggle={toggleCollapsed}
            />
          )}
          {/* Help is pinned top left and Settings bottom right, so the row turns into a column as this box narrows and grows */}
          <div className={clsx('relative', animating && SLIDE, collapsed ? 'h-[68px]' : 'h-8')}>
            <HelpMenu collapsed={collapsed} animating={animating} />
            <SettingsMenu
              team={team}
              active={settingsActive}
              collapsed={collapsed}
              animating={animating}
            />
          </div>
        </div>

        {!collapsed && <SidebarResizeHandle />}
      </aside>

      {/* z-10 keeps Headless UI dialogs (also z-10, portaled later in <body>) painting above the nav */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex h-[var(--mobile-tabbar-height)] items-start border-t border-neutral-300 bg-neutral-100/95 pb-[env(safe-area-inset-bottom)] text-zinc-600 backdrop-blur-md dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-zinc-400 md:hidden">
        {mobileLinks.map((link) => (
          <Link
            key={link.name}
            href={link.href}
            className={clsx(
              'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 transition-colors',
              link.active
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'hover:text-zinc-900 dark:hover:text-zinc-100'
            )}
            aria-label={link.name}
            aria-current={link.active ? 'page' : undefined}
            title={link.name}
          >
            <span className="text-lg">{link.icon}</span>
            <span className="max-w-full truncate text-[10px] font-medium">
              {link.name === 'Access Control' ? 'Access' : link.name}
            </span>
          </Link>
        ))}
        <MobileMoreMenu
          overflowLinks={overflowLinks}
          organisations={switchableOrganisations}
          activeOrganisation={activeOrganisation}
          isOwner={!!isOwner}
        />
      </nav>
    </>
  )
}

export default Sidebar
