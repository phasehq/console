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
import { TbSelector } from 'react-icons/tb'
import { MdLogout } from 'react-icons/md'
import { IconType } from 'react-icons'
import { useQuery } from '@apollo/client'
import { organisationContext } from '@/contexts/organisationContext'
import { SidebarContext } from '@/contexts/sidebarContext'
import { useSession } from '@/contexts/userContext'
import { handleSignout } from '@/apollo/client'
import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ApiOrganisationPlanChoices, AppType } from '@/apollo/graphql'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { Menu, Popover, Transition } from '@headlessui/react'
import { LogoWordMark } from '../common/LogoWordMark'
import { Avatar } from '../common/Avatar'
import { openCommandPalette, useModifierKey } from '../common/CommandPalette'
import { STATUS_PAGE_BASE_URL, statusColor, useSystemStatus } from '../common/StatusIndicator'
import { OrgMenuItems } from './OrgSwitcher'
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
// The docs' navigation palette: a faint highlight and, in a sublist, an emerald marker on the guide
// line. The light theme uses 5%: the docs' 2.5% was too faint on the light shell colour
const NAV_ACTIVE_BG = 'bg-zinc-800/5 dark:bg-white/[0.025]'
const NAV_ACTIVE_TEXT = 'text-zinc-900 dark:text-white'
const NAV_INACTIVE_TEXT =
  'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
const TOOLTIP_STYLE =
  'invisible group-hover/item:visible absolute left-full ml-4 top-1/2 -translate-y-1/2 bg-zinc-800 text-white px-2 py-1 rounded text-xs whitespace-nowrap z-50'

// How long the sidebar takes to collapse or expand. Must match the duration in SLIDE
const SLIDE_MS = 300
// Applied only while that runs, so the sidebar never animates on load or while it is resized
const SLIDE =
  'transition-[width,height,grid-template-columns,opacity,transform] duration-300 ease-in-out motion-reduce:transition-none'

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

// A group's sub-pages, hung off a guide line. The current page's highlight reaches left past the line by
// `bleed`, to the edge of whatever holds the list
const SidebarSubLinks = ({
  sublinks,
  bleed,
  className,
}: {
  sublinks: SidebarSubLinkT[]
  bleed: string
  className?: string
}) => (
  <ul
    className={clsx(
      'space-y-0.5 border-l border-zinc-900/10 pl-[7px] dark:border-white/5',
      className
    )}
  >
    {sublinks.map((sublink) => (
      <li key={sublink.href} className="relative">
        {sublink.active && (
          <>
            <span className={clsx('absolute inset-y-0 right-0 rounded-lg', bleed, NAV_ACTIVE_BG)} />
            {/* Drawn over the guide line: the 7px of padding and the 1px line itself */}
            <span className="absolute inset-y-1 -left-2 w-px bg-emerald-500" />
          </>
        )}
        <Link
          href={sublink.href}
          title={sublink.name}
          aria-current={sublink.active ? 'page' : undefined}
          className={clsx(
            'relative block truncate rounded-md px-2 py-0.5 text-xs font-medium transition ease',
            sublink.active
              ? NAV_ACTIVE_TEXT
              : sublink.muted
                ? 'text-neutral-500 hover:text-zinc-900 dark:hover:text-white'
                : NAV_INACTIVE_TEXT
          )}
        >
          {sublink.name}
        </Link>
      </li>
    ))}
  </ul>
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
          highlighted && NAV_ACTIVE_BG
        )}
      >
        <Link
          href={link.href}
          onClick={() => setOpen?.(true)}
          aria-current={highlighted ? 'page' : undefined}
          aria-label={collapsed ? link.name : undefined}
          className={clsx(
            'flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-xs font-semibold whitespace-nowrap transition ease',
            link.active ? NAV_ACTIVE_TEXT : NAV_INACTIVE_TEXT
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
            {/* 28px: the list's margin, its line and its padding, back to the edge of the nav */}
            <SidebarSubLinks
              sublinks={sublinks}
              bleed="-left-7"
              className={clsx('ml-5 mt-1', animating && '[&_a]:text-clip')}
            />
          </div>
        </div>
      )}

      {/* Not while the sidebar is still closing: the pointer that clicked Collapse is over the rail */}
      {collapsed &&
        !animating &&
        (hasSublinks ? (
          // Hidden with opacity, not visibility: it switches at once, and its links stay focusable so
          // Tab can move from the icon into it. pl-4 bridges the hover gap
          <div className="pointer-events-none absolute left-full top-0 z-50 pl-4 opacity-0 group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-has-[:focus-visible]/item:pointer-events-auto group-has-[:focus-visible]/item:opacity-100">
            <div className="w-52 rounded-md bg-neutral-200 p-1 shadow-2xl ring-1 ring-inset ring-neutral-500/40 dark:bg-neutral-800">
              <div className="px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-neutral-500">
                {link.name}
              </div>
              <SidebarSubLinks sublinks={sublinks} bleed="-left-4" className="ml-2" />
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
  collapsed,
  animating,
  children,
}: {
  name: string
  icon: React.ReactNode
  active?: boolean
  collapsed: boolean
  animating: boolean
  children: (close: () => void) => React.ReactNode
}) => (
  <Popover className="group/item absolute right-0 top-0">
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
        {collapsed && !animating && !open && <div className={TOOLTIP_STYLE}>{name}</div>}
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
                : 'bottom-full right-0 mb-1 origin-bottom-right'
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

const HelpMenu = (props: FooterMenuProps) => {
  // The hosted service's status. Self-hosted instances have none
  const { status, isLoading, enabled } = useSystemStatus()
  // An incident marks the button, so it is seen without opening the menu
  const incident = enabled && !!status && ['minor', 'major', 'critical'].includes(status.indicator)

  return (
    <SidebarFooterMenu
      name="Help"
      icon={
        <span className="relative flex">
          <FaQuestionCircle />
          {incident && (
            <span
              className={clsx('absolute -right-1 -top-1 size-2 rounded-full', statusColor(status))}
            >
              <span className="sr-only">Service incident:</span>
            </span>
          )}
        </span>
      }
      {...props}
    >
      {(close) => (
        <>
          <div className="space-y-0.5 p-1">
            {HELP_LINKS.map(({ name, href, icon }) => (
              <FooterMenuLink key={name} href={href} icon={icon} external onClick={close}>
                {name}
              </FooterMenuLink>
            ))}
          </div>
          {enabled && (
            <div className="p-1">
              <Link
                href={STATUS_PAGE_BASE_URL}
                target="_blank"
                onClick={close}
                aria-label={`System status: ${status?.description || 'Loading'}`}
                className={clsx(MENU_ROW_STYLE, HOVER_BG, INACTIVE_STYLE)}
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center">
                  <span
                    className={clsx(
                      'size-2 rounded-full',
                      statusColor(status),
                      isLoading && 'animate-pulse'
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate">{status?.description || 'Loading'}</span>
                <FaExternalLinkAlt className="size-2 shrink-0 text-neutral-500" />
              </Link>
            </div>
          )}
        </>
      )}
    </SidebarFooterMenu>
  )
}

// Who is signed in, at the top of the account menu. The role is not here: it differs by
// organisation, so each row of the organisation list names it
const AccountHeader = () => {
  const { data: session } = useSession()

  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <Avatar user={session?.user} size="md" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium leading-5 text-zinc-900 dark:text-zinc-100">
          {session?.user?.name}
        </span>
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
  collapsed,
  animating,
}: FooterMenuProps & { team: string; active: boolean }) => {
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
              // Open is a pressed button. On the settings page it is the current page, as in the nav
              open ? ACTIVE_BG : active ? NAV_ACTIVE_BG : HOVER_BG
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
          {collapsed && !animating && !open && (
            <div className={TOOLTIP_STYLE}>{session.user?.name}</div>
          )}
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
                  <OrgMenuItems heading="Organisations" onNavigate={close} />
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

// Opens the command palette. It sits at the right of the header row, which on the rail is all of it
const SidebarSearchButton = ({ collapsed, animating }: FooterMenuProps) => {
  const modifierKey = useModifierKey()

  return (
    <div className="group/item absolute right-3 top-2">
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
      {collapsed && !animating && <div className={TOOLTIP_STYLE}>Search</div>}
    </div>
  )
}

// Tabler's layout-sidebar-left-collapse (filled), with its chevron as a path of its own so it can turn
const SidebarToggleIcon = ({ collapsed, animating }: FooterMenuProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-[18px] shrink-0">
    <path d="M18 3a3 3 0 0 1 2.995 2.824l.005 .176v12a3 3 0 0 1 -2.824 2.995l-.176 .005h-12a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-12a3 3 0 0 1 2.824 -2.995l.176 -.005h12zm0 2h-9v14h9a1 1 0 0 0 .993 -.883l.007 -.117v-12a1 1 0 0 0 -.883 -.993l-.117 -.007z" />
    <path
      className={clsx(
        'origin-center [transform-box:fill-box]',
        animating && SLIDE,
        collapsed && 'rotate-180'
      )}
      d="M15.707 9.293a1 1 0 0 1 .083 1.32l-.083 .094l-1.292 1.293l1.292 1.293a1 1 0 0 1 .083 1.32l-.083 .094a1 1 0 0 1 -1.32 .083l-.094 -.083l-2 -2a1 1 0 0 1 -.083 -1.32l.083 -.094l2 -2a1 1 0 0 1 1.414 0z"
    />
  </svg>
)

const SidebarCollapseToggle = ({
  collapsed,
  animating,
  onToggle,
}: FooterMenuProps & { onToggle: () => void }) => {
  return (
    <div className="group/item absolute bottom-0 left-0 flex">
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
          <SidebarToggleIcon collapsed={collapsed} animating={animating} />
        </span>
        <FooterLabel show={!collapsed} animating={animating}>
          Collapse
        </FooterLabel>
      </button>
      {/* Held back until the sidebar has closed: the click that collapses it is made on this button */}
      {collapsed && !animating && <div className={TOOLTIP_STYLE}>Expand sidebar</div>}
    </div>
  )
}

// No side padding: the links are flex items and More is wrapped in one, so padding made them unequal
const MOBILE_TAB_STYLE =
  'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 transition ease'
const MOBILE_MENU_ROW =
  'flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-sm transition ease'
// Tab labels are short enough to fit under an icon
const MOBILE_TAB_NAMES: Record<string, string> = {
  'Access Control': 'Access',
  'Audit Logs': 'Logs',
}

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
        active && NAV_ACTIVE_BG
      )}
    >
      {icon}
    </span>
    <span className="max-w-full truncate text-3xs font-medium">{name}</span>
  </>
)

// On phones the tab bar is the whole shell, so More is the account menu with Search added
const MobileMoreMenu = ({ team, settingsActive }: { team: string; settingsActive: boolean }) => (
  <Menu as="div" className="relative min-w-0 flex-1">
    {({ open }) => {
      const highlighted = open || settingsActive
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
            className={clsx(
              MOBILE_TAB_STYLE,
              'w-full',
              highlighted ? NAV_ACTIVE_TEXT : NAV_INACTIVE_TEXT
            )}
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
              <div className="p-1">
                <Menu.Item>
                  {({ active }) => (
                    <button type="button" onClick={openCommandPalette} className={rowStyle(active)}>
                      <FaSearch className={MENU_ROW_ICON} />
                      Search
                    </button>
                  )}
                </Menu.Item>
              </div>
              <OrgMenuItems heading="Organisations" touch />
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

  // Home only links on to the other pages, so on phones its place in the tab bar goes to Audit Logs
  const mobileLinks = links.filter((link) => link.name !== 'Home')

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
        {/* The search button is pinned to the right edge, so it slides left along this row as the */}
        {/* sidebar narrows. The row keeps its height, so nothing under it moves */}
        <div className="relative h-12 shrink-0">
          {/* The rail has no logo: this row ends where the button starts, so it is clipped away as it */}
          {/* fades. pl-[23px] puts the logo mark over the nav icons */}
          <div
            inert={collapsed}
            className={clsx(
              'mr-14 flex h-12 items-center gap-1.5 overflow-hidden pl-[23px]',
              animating && SLIDE,
              collapsed && 'opacity-0'
            )}
          >
            <Link href="/" aria-label="Phase" className="shrink-0">
              <LogoWordMark className="w-16 fill-black dark:fill-white" />
            </Link>
            {/* A paid plan reads as "Phase Pro". The free plan is just the logo */}
            {activeOrganisation && activeOrganisation.plan !== ApiOrganisationPlanChoices.Fr && (
              <PlanLabel plan={activeOrganisation.plan} size="sm" />
            )}
          </div>
          <SidebarSearchButton collapsed={collapsed} animating={animating} />
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
          {/* The toggle is pinned bottom left, so it stays under the pointer. Help rises above it on the rail */}
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
            collapsed={collapsed}
            animating={animating}
          />
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
            className={clsx(MOBILE_TAB_STYLE, link.active ? NAV_ACTIVE_TEXT : NAV_INACTIVE_TEXT)}
            aria-label={link.name}
            aria-current={link.active ? 'page' : undefined}
            title={link.name}
          >
            <MobileTab
              name={MOBILE_TAB_NAMES[link.name] ?? link.name}
              icon={link.icon}
              active={link.active}
            />
          </Link>
        ))}
        <MobileMoreMenu team={team} settingsActive={settingsActive} />
      </nav>
    </>
  )
}

export default Sidebar
