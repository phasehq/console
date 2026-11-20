'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import {
  FaCubes,
  FaHome,
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
  FaSearch,
} from 'react-icons/fa'
import {
  TbLayoutSidebarLeftCollapseFilled,
  TbLayoutSidebarLeftExpandFilled,
  TbSelector,
} from 'react-icons/tb'
import { MdLogout } from 'react-icons/md'
import { IconType } from 'react-icons'
import { useQuery } from '@apollo/client'
import { organisationContext } from '@/contexts/organisationContext'
import { SidebarContext } from '@/contexts/sidebarContext'
import { useSession } from '@/contexts/userContext'
import { handleSignout } from '@/apollo/client'
import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppType } from '@/apollo/graphql'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { Menu, Popover, Transition } from '@headlessui/react'
import { LogoWordMark } from '../common/LogoWordMark'
import { Avatar } from '../common/Avatar'
import { openCommandPalette, useModifierKey } from '../common/CommandPalette'
import { STATUS_PAGE_BASE_URL, statusColor, useSystemStatus } from '../common/StatusIndicator'
import { RoleLabel } from '../users/RoleLabel'
import { OrgMenuItems } from './OrgSwitcher'
import { SIDEBAR_WIDTH, SidebarResizeHandle } from './SidebarResizeHandle'
import { ModeToggle } from '../common/ModeToggle'
import { PlanLabel } from '../settings/organisation/PlanLabel'
import { FaCodeMerge, FaListUl } from 'react-icons/fa6'
import { userHasGlobalAccess, userHasPermission } from '@/utils/access/permissions'
import { sortApps } from '@/utils/app'
import { ACCESS_PAGES, getIntegrationPages } from '@/utils/navigation'
import { useShellExperiment } from '@/utils/shellExperiment'

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
  <SidebarFooterMenu name="Help" icon={<FaQuestionCircle />} align="right" {...props}>
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

// Who is signed in, at the top of the account menu
const AccountHeader = () => {
  const { data: session } = useSession()
  const { activeOrganisation } = useContext(organisationContext)

  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <Avatar user={session?.user} size="md" />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The role wraps onto its own line rather than squeezing a long name */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="min-w-0 truncate text-xs font-medium leading-5 text-zinc-900 dark:text-zinc-100">
            {session?.user?.name}
          </span>
          {activeOrganisation?.role && <RoleLabel role={activeOrganisation.role} size="xs" />}
        </div>
        <span className="truncate text-2xs leading-4 text-neutral-500">{session?.user?.email}</span>
      </div>
    </div>
  )
}

const ThemeRow = ({ className }: { className: string }) => (
  <div className={clsx(className, 'text-zinc-600 dark:text-zinc-400')}>
    <FaPalette className={MENU_ROW_ICON} />
    <span className="flex-1">Theme</span>
    <div className="flex items-center gap-2 text-neutral-500">
      <FaSun />
      <ModeToggle />
      <FaMoon />
    </div>
  </div>
)

// The signed-in user, at the foot of the sidebar. Its menu holds everything about the account:
// the organisation switch, the theme, the settings pages and sign out
const AccountMenu = ({
  team,
  active,
  showOrganisations,
  collapsed,
  animating,
}: FooterMenuProps & { team: string; active: boolean; showOrganisations: boolean }) => {
  const { data: session } = useSession()
  const { activeOrganisation } = useContext(organisationContext)

  if (!session) return null

  return (
    <Popover className="group/item relative mt-1">
      {({ open }) => (
        <>
          <Popover.Button
            className={clsx(
              'flex h-10 w-full items-center rounded-md px-2 text-left outline-none transition ease data-[focus]:ring-2 data-[focus]:ring-neutral-500',
              active || open ? ACTIVE_BG : HOVER_BG
            )}
          >
            {/* The name follows, so the initials are decoration */}
            <span className="shrink-0" aria-hidden="true">
              <Avatar user={session.user} size="xs" showTitle={false} />
            </span>
            {/* Clipped by the narrowing sidebar, so only the avatar is left on the rail */}
            <span
              className={clsx(
                'min-w-0 flex-1 overflow-hidden',
                animating && SLIDE,
                collapsed && 'opacity-0'
              )}
            >
              <span className="flex items-center gap-2 pl-2">
                {/* Clipped, not ellipsised, while the sidebar moves over it */}
                <span
                  className={clsx(
                    'flex min-w-0 flex-1 flex-col',
                    animating && '[&>span]:text-clip'
                  )}
                >
                  <span className="truncate text-xs font-medium leading-4 text-zinc-900 dark:text-zinc-100">
                    {session.user?.name}
                  </span>
                  <span className="truncate text-2xs leading-4 text-neutral-500">
                    {activeOrganisation?.name}
                  </span>
                </span>
                <TbSelector className="size-3.5 shrink-0 text-neutral-500" />
              </span>
            </span>
          </Popover.Button>
          {collapsed && !open && <div className={TOOLTIP_STYLE}>{session.user?.name}</div>}
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            {/* Collapsed: opens beside the avatar. Expanded: spans the pane, above the row */}
            <Popover.Panel
              className={clsx(
                'absolute z-20 min-w-56 divide-y divide-neutral-500/20 rounded-md bg-neutral-200 shadow-2xl ring-1 ring-inset ring-neutral-500/40 focus:outline-none dark:bg-neutral-800',
                collapsed
                  ? 'bottom-0 left-full ml-4 w-56 origin-bottom-left'
                  : 'inset-x-0 bottom-full mb-1 origin-bottom'
              )}
            >
              {({ close }) => (
                <>
                  <AccountHeader />
                  {showOrganisations && <OrgMenuItems heading="Organisation" onNavigate={close} />}
                  <div className="space-y-0.5 p-1">
                    <ThemeRow className={MENU_ROW_STYLE} />
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
                  <div className="p-1">
                    <button
                      type="button"
                      onClick={() => handleSignout()}
                      className={clsx(
                        MENU_ROW_STYLE,
                        'text-red-700 hover:bg-red-500/10 dark:text-red-400'
                      )}
                    >
                      <MdLogout className="size-3.5 shrink-0" />
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  )
}

// The hosted service's status, linking to the status page. Self-hosted instances have none
const SystemStatus = ({ collapsed, animating }: FooterMenuProps) => {
  const experiment = useShellExperiment()
  const live = useSystemStatus()
  // TEMPORARY: a healthy status to look at while developing locally
  const { status, isLoading, enabled } = experiment.mockStatus
    ? {
        status: { indicator: 'none' as const, description: 'All Systems Operational' },
        isLoading: false,
        enabled: true,
      }
    : live

  if (!enabled) return null

  const description = status?.description || 'Loading'

  return (
    <div className="group/item relative mt-1">
      <Link
        href={STATUS_PAGE_BASE_URL}
        target="_blank"
        aria-label={`System status: ${description}`}
        className={clsx(
          'flex h-6 w-full items-center rounded-md px-4 text-2xs outline-none transition ease focus-visible:ring-2 focus-visible:ring-neutral-500',
          'text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100'
        )}
      >
        <span
          className={clsx(
            'size-2 shrink-0 rounded-full',
            statusColor(status),
            isLoading && 'animate-pulse'
          )}
        />
        <span
          className={clsx(
            'min-w-0 flex-1 overflow-hidden',
            animating && SLIDE,
            collapsed && 'opacity-0'
          )}
        >
          <span className={clsx('block truncate pl-2', animating && 'text-clip')}>
            {description}
          </span>
        </span>
      </Link>
      {collapsed && <div className={TOOLTIP_STYLE}>{description}</div>}
    </div>
  )
}

// Opens the command palette. It sits beside the logo, and under it on the rail
const SidebarSearchButton = ({ collapsed }: { collapsed: boolean }) => {
  const modifierKey = useModifierKey()

  return (
    <div className="group/item absolute bottom-2 right-3">
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label="Search"
        title={collapsed ? undefined : `Search (${modifierKey} + K)`}
        className={clsx(
          'flex h-8 w-10 items-center justify-center rounded-md text-sm outline-none transition ease focus-visible:ring-2 focus-visible:ring-neutral-500',
          HOVER_BG,
          INACTIVE_STYLE
        )}
      >
        <FaSearch />
      </button>
      {collapsed && <div className={TOOLTIP_STYLE}>Search</div>}
    </div>
  )
}

const SidebarCollapseToggle = ({
  collapsed,
  animating,
  onToggle,
}: FooterMenuProps & { onToggle: () => void }) => {
  const Icon = collapsed ? TbLayoutSidebarLeftExpandFilled : TbLayoutSidebarLeftCollapseFilled

  return (
    <div className="group/item absolute left-0 top-0 flex">
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

const MOBILE_TAB_STYLE =
  'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 transition ease'
const MOBILE_MENU_ROW =
  'flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-sm transition ease'

// The highlight sits behind the icon, as it does on the icon rail
const MobileTab = ({
  name,
  icon,
  active,
}: {
  name: string
  icon: React.ReactNode
  active: boolean
}) => (
  <>
    <span
      className={clsx(
        'flex h-7 w-12 items-center justify-center rounded-lg text-base transition ease',
        active && ACTIVE_BG
      )}
    >
      {icon}
    </span>
    <span className="max-w-full truncate text-3xs font-medium">{name}</span>
  </>
)

// On phones the tab bar is the whole shell, so More also carries the account menu and search
const MobileMoreMenu = ({
  overflowLinks,
  team,
  settingsActive,
}: {
  overflowLinks: SidebarLinkT[]
  team: string
  settingsActive: boolean
}) => (
  <Menu as="div" className="relative min-w-0 flex-1">
    {({ open }) => {
      const highlighted = open || settingsActive || overflowLinks.some((link) => link.active)
      const rowStyle = (active: boolean, current = false) =>
        clsx(
          MOBILE_MENU_ROW,
          current
            ? [ACTIVE_BG, ACTIVE_TEXT]
            : [
                'text-zinc-600 dark:text-zinc-400',
                active && 'bg-zinc-900/5 text-zinc-900 dark:bg-white/5 dark:text-zinc-100',
              ]
        )

      return (
        <>
          <Menu.Button
            className={clsx(MOBILE_TAB_STYLE, 'w-full', highlighted ? ACTIVE_TEXT : INACTIVE_STYLE)}
            aria-label="More navigation"
            title="More"
          >
            <MobileTab name="More" icon={<FaEllipsisH />} active={highlighted} />
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
            <Menu.Items className="absolute bottom-full right-1 mb-2 max-h-[calc(100dvh_-_4.5rem)] w-64 origin-bottom-right divide-y divide-neutral-500/20 overflow-y-auto rounded-md bg-neutral-200 shadow-2xl ring-1 ring-inset ring-neutral-500/40 focus:outline-none dark:bg-neutral-800">
              <AccountHeader />
              <div className="space-y-0.5 p-1">
                <Menu.Item>
                  {({ active }) => (
                    <button type="button" onClick={openCommandPalette} className={rowStyle(active)}>
                      <FaSearch className={MENU_ROW_ICON} />
                      Search
                    </button>
                  )}
                </Menu.Item>
                {overflowLinks.map((link) => (
                  <Menu.Item key={link.name}>
                    {({ active }) => (
                      <Link
                        href={link.href}
                        aria-current={link.active ? 'page' : undefined}
                        className={rowStyle(active, link.active)}
                      >
                        <span className="text-neutral-500">{link.icon}</span>
                        {link.name}
                      </Link>
                    )}
                  </Menu.Item>
                ))}
              </div>
              <OrgMenuItems heading="Organisation" touch />
              <div className="space-y-0.5 p-1">
                <ThemeRow className={MOBILE_MENU_ROW} />
                <Menu.Item>
                  {({ active }) => (
                    <Link href="/account" className={rowStyle(active)}>
                      <FaUserCircle className={MENU_ROW_ICON} />
                      Account settings
                    </Link>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <Link
                      href={`/${team}/settings`}
                      aria-current={settingsActive ? 'page' : undefined}
                      className={rowStyle(active, settingsActive)}
                    >
                      <FaBuilding className={MENU_ROW_ICON} />
                      Organisation settings
                    </Link>
                  )}
                </Menu.Item>
              </div>
              <div className="p-1">
                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      onClick={() => handleSignout()}
                      className={clsx(
                        MOBILE_MENU_ROW,
                        'text-red-700 dark:text-red-400',
                        active && 'bg-red-500/10'
                      )}
                    >
                      <MdLogout className="size-3.5 shrink-0" />
                      Sign out
                    </button>
                  )}
                </Menu.Item>
              </div>
            </Menu.Items>
          </Transition>
        </>
      )
    }}
  </Menu>
)

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
  const { activeOrganisation } = useContext(organisationContext)
  // TEMPORARY: variant switches, see utils/shellExperiment.ts
  const experiment = useShellExperiment()

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
  const overflowLinks = links.slice(4)

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
        {/* The search button is pinned bottom right, so it slides under the logo as this box narrows and grows */}
        <div
          className={clsx('relative shrink-0', animating && SLIDE, collapsed ? 'h-[84px]' : 'h-12')}
        >
          {/* pl-[23px] centres the logo mark on the nav icons in both states */}
          <div className="flex h-12 items-center gap-1.5 overflow-hidden pl-[23px] pr-14">
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
          <SidebarSearchButton collapsed={collapsed} />
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
          {/* The toggle is pinned top left and Help bottom right, so the row turns into a column as this box narrows and grows */}
          <div
            className={clsx(
              'relative',
              animating && SLIDE,
              collapsed && !isAutoCollapsed ? 'h-[68px]' : 'h-8'
            )}
          >
            {/* A window too narrow for the full sidebar has nothing to expand into */}
            {!isAutoCollapsed && (
              <SidebarCollapseToggle
                collapsed={collapsed}
                animating={animating}
                onToggle={toggleCollapsed}
              />
            )}
            <HelpMenu collapsed={collapsed} animating={animating} />
          </div>
          <AccountMenu
            team={team}
            active={settingsActive}
            showOrganisations={!experiment.breadcrumbs}
            collapsed={collapsed}
            animating={animating}
          />
          <SystemStatus collapsed={collapsed} animating={animating} />
        </div>

        {!collapsed && <SidebarResizeHandle />}
      </aside>

      {/* Below md the links become a tab bar, drawn on the shell colour like the sidebar. */}
      {/* z-10 keeps Headless UI dialogs (also z-10, portaled later in <body>) painting above it */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex h-[var(--mobile-tabbar-height)] items-start px-1 pb-[env(safe-area-inset-bottom)] md:hidden">
        {mobileLinks.map((link) => (
          <Link
            key={link.name}
            href={link.href}
            className={clsx(MOBILE_TAB_STYLE, link.active ? ACTIVE_TEXT : INACTIVE_STYLE)}
            aria-label={link.name}
            aria-current={link.active ? 'page' : undefined}
            title={link.name}
          >
            <MobileTab
              name={link.name === 'Access Control' ? 'Access' : link.name}
              icon={link.icon}
              active={link.active}
            />
          </Link>
        ))}
        <MobileMoreMenu overflowLinks={overflowLinks} team={team} settingsActive={settingsActive} />
      </nav>
    </>
  )
}

export default Sidebar
