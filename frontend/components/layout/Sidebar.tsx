'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import {
  FaChevronDown,
  FaCog,
  FaCubes,
  FaExchangeAlt,
  FaHome,
  FaKey,
  FaPlus,
  FaUsersCog,
  FaProjectDiagram,
  FaCube
} from 'react-icons/fa'
import { organisationContext } from '@/contexts/organisationContext'
import { Fragment, useContext } from 'react'
import { OrganisationType } from '@/apollo/graphql'
import { Menu, Transition } from '@headlessui/react'
import { Button } from '../common/Button'
import { useState } from 'react'
//importing
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { useQuery } from '@apollo/client'


export type SidebarLinkT = {
  name: string
  href: string
  icon: React.ReactNode
  active: boolean
  //added for dropdown logic
  handleAppsDropDown?: () => void
  arrow: boolean
}

const SidebarLink = (props: SidebarLinkT) => {
  const { name, href, icon, active, handleAppsDropDown, arrow } = props;

  return (
        <div
          className={clsx(
            'flex items-center gap-2 text-sm p-2 w-full',
            active
              ? href.includes('apps/') && href.includes('environments/')
                ? 'font-extrabold text-black dark:text-white'
                : href.includes('apps/')
                  ? 'bg-zinc-200 dark:bg-zinc-400/10 text-black dark:text-white dark:ring-1 font-bold dark:ring-inset dark:ring-zinc-400/20 rounded-full mb-4'
                  : 'bg-zinc-200 dark:bg-emerald-400/10 text-black dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 font-medium rounded-lg'
              : href.includes('apps/') && href.includes('environments/')
                ? 'text-zinc-700 dark:text-zinc-200 hover:text-zinc-400 dark:hover:text-white font-medium'
                : href.includes('apps/')
                  ? 'bg-zinc-200 dark:bg-zinc-400/10 text-black dark:text-zinc-500 dark:ring-1 font-medium dark:ring-inset mb-4 dark:ring-zinc-400/20 rounded-full'
                  : 'text-zinc-700 dark:text-zinc-200 hover:text-emerald-500 rounded-lg dark:hover:text-emerald-500 font-medium '
          )}
    >
      <Link href={href} title={name} className="flex items-center gap-2 w-full">
        <div className="flex items-center gap-2 w-full">
          <div>{icon}</div>
          {name}
        </div>
      </Link>
      {arrow === true && (
        <div onClick={handleAppsDropDown}>
          <svg
            stroke="currentColor"
            fill="currentColor"
            strokeWidth="0"
            viewBox="0 0 448 512"
            className="ml-auto transition ease rotate-0"
            height="1em"
            width="1em"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M207.029 381.476L12.686 187.132c-9.373-9.373-9.373-24.569 0-33.941l22.667-22.667c9.357-9.357 24.522-9.375 33.901-.04L224 284.505l154.745-154.021c9.379-9.335 24.544-9.317 33.901.04l22.667 22.667c9.373 9.373 9.373 24.569 0 33.941L240.971 381.476c-9.373 9.372-24.569 9.372-33.942 0z"></path>
          </svg>
        </div>
      )}
    </div>
  );
};

//Fetching App data
const Sidebar = (props:any) => {
  const team = usePathname()?.split('/')[1]


  const { organisations, activeOrganisation } = useContext(organisationContext)
  const showOrgsMenu = organisations === null ? false : organisations?.length > 1

  const getEnvironmentData = (index:number) => {
    if(props.apps){
      const { data: appEnvsData } = useQuery(GetAppEnvironments, {
        variables: {
          appId: props?.apps[index].id,
        },
        skip: !props.apps
      })
      return appEnvsData?.appEnvironments
    } 
  }
//  console.log(getEnvironmentData(0))
  const OrgsMenu = () => {
    return (
      <Menu as="div" className="relative inline-block text-left ">
        {({ open }) => (
          <>
            <Menu.Button
              as="div"
              className="p-2 text-neutral-500 font-semibold uppercase tracking-wider cursor-pointer flex items-center justify-between w-full"
            >
              <span className="truncate">{activeOrganisation?.name}</span>
              <FaChevronDown
                className={clsx('transition ease', open ? 'rotate-180' : 'rotate-0')}
              />
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Menu.Items className="absolute z-10 -right-2 top-12 mt-2 w-56 origin-bottom-left divide-y divide-neutral-500/40 rounded-md bg-neutral-200 dark:bg-neutral-800 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
                {showOrgsMenu ? (
                  <div className="px-1 py-1">
                    {organisations?.map((org: OrganisationType) => (
                      <Menu.Item key={org.id}>
                        {({ active }) => (
                          <Link href={`/${org.name}`}>
                            <div
                              title={`Switch to ${org.name}`}
                              className={`${
                                active
                                  ? 'hover:text-emerald-500 dark:text-white dark:hover:text-emerald-500'
                                  : 'text-gray-900 dark:text-white dark:hover:text-emerald-500'
                              } group flex w-full  gap-2 items-center justify-between rounded-md px-2 py-2 text-base font-medium`}
                            >
                              <span className="truncate w-[80%] text-left">{org.name}</span>
                              <FaExchangeAlt />
                            </div>
                          </Link>
                        )}
                      </Menu.Item>
                    ))}
                  </div>
                ) : null}
                <div className="py-3 px-1 flex justify-center">
                  <Link href="/signup">
                    <Button variant="secondary">
                      <FaPlus /> Create New Organisation
                    </Button>
                  </Link>
                </div>
              </Menu.Items>
            </Transition>
          </>
        )}
      </Menu>
    )
  }
// Formatting into json
// Formatting for app dropdown 
  if (props.apps) {
    const newAppNames = props.apps.map((item:any) => ({
      name: `${item.name}`,
      href: `/${team}/apps/${item.id}`, 
      icon: <FaCube size="15" />, // Replace with appropriate icon if needed
      active: usePathname()?.split('/')[3] === `${item.id}`,
      arrow: true
    }));
// FOrmatting for each app environments dropdown
    const newEnvNames = props.apps.map((app:any, index:any) => {
      const environments = getEnvironmentData(index);
      return environments?.map((item:any) => ({
        name: item.name,
        href: `/${team}/apps/${app.id}/environments/${item.id}`,
        icon: "",
        active: usePathname() === `/${team}/apps/${app.id}/environments/${item.id}`,
        arrow: false
      }));
    }).flat();

  const links: SidebarLinkT[] = [
    {
      name: 'Home',
      href: `/${team}`,
      icon: <FaHome size="20" />,
      active: usePathname() === `/${team}`,
      arrow: false
    },
    {
      name: 'Apps',
      href: `/${team}/apps`,
      icon: <FaCubes size="20" />,
      active: usePathname()?.split('/')[2] === 'apps',
      arrow: true
    },
    ...newAppNames,
    ...newEnvNames,
    //Added app objects into the array
    {
      name: 'Members',
      href: `/${team}/members`,
      icon: <FaUsersCog size="20" />,
      active: usePathname() === `/${team}/members`,
      arrow: false
    },
    {
      name: 'Integrations',
      href: `/${team}/integrations`,
      icon: <FaProjectDiagram size="20" />,
      active: usePathname() === `/${team}/integrations`,
      arrow: false
    },
    {
      name: 'Personal access tokens',
      href: `/${team}/tokens`,
      icon: <FaKey size="20" />,
      active: usePathname() === `/${team}/tokens`,
      arrow: false
    },
    {
      name: 'Settings',
      href: `/${team}/settings`,
      icon: <FaCog size="20" />,
      active: usePathname() === `/${team}/settings`,
      arrow: false
    },
  ]
  //Logic for both dropdowns
  const [showDropDown, setShowDropDown] = useState(false);
  const [appDropdownStates, setAppDropdownStates] = useState(
    Array(newAppNames.length).fill(false)
  );

  const handleAppsDropDown = () => {
    setShowDropDown(prev => !prev)
  }

  const toggleDropdown = (index: number) => {
    setAppDropdownStates(prev => {
      const newStates = [...prev];
      newStates[index] = !newStates[index];
      return newStates;
    });
  }

  return (
    <div className="h-screen flex flex-col pt-[64px] w-72">
      <nav className="flex flex-col divide-y divide-neutral-300 dark:divide-neutral-800 items-start justify-between h-full bg-neutral-100/70 dark:bg-neutral-800/20 text-black dark:text-white overflow-y-auto">
        <div className="gap-4 p-4 grid grid-cols-1 w-full">
          <OrgsMenu />
          {links.slice(0, 2).map((link) => (
            <SidebarLink
              key={link.name}
              name={link.name}
              href={link.href}
              icon={link.icon}
              active={link.active}
              handleAppsDropDown = {handleAppsDropDown}
              arrow={link.arrow}
            />
          ))}
        {/*Displaying all the app names*/}
        {(showDropDown) && (
          <div>
            <div className="ml-6">
              {newAppNames.slice(0, 10).map((app, index:number) => (
                <div className='flex flex-col'>
                  <div className='flex flex-row items-center'>
                <SidebarLink
                  handleAppsDropDown={() => toggleDropdown(index)}
                  key={app.name}
                  name={app.name}
                  href={app.href}
                  icon={app.icon}
                  active={app.active}
                  arrow={app.arrow}
                />
                </div>
                {/* Displaying each apps environments */}
                <div>
                {(appDropdownStates[index]) && newEnvNames.slice(index+(2*(index)), (index+(2*(index))) + 3).map((app:any) => (
                 
                  <div className='flex flex-row items-center ml-8'>
                <SidebarLink
                  key={app.name}
                  name={app.name}
                  href={app.href}
                  icon={app.icon}
                  active={app.active}
                  arrow={app.arrow}
                />
                </div>
              ))}
              </div>
                </div>
              ))}
              {/* Show more logic for more than 10 apps */}
              {newAppNames.length > 10 && (
                <Link href={`/${team}/apps`}>
                  <div className='flex items-center gap-2 text-sm font-medium rounded-lg p-2 w-full hover:text-white text-emerald-500 dark:text-emerald-500'>
                    Show more
                  </div>
                </Link>
              )}
            </div>
          </div>
        )}
        {/* Logic for displaying sidebar data between apps and settings */}
         {links.slice(2 + newAppNames.length+ newEnvNames.length ,links.length - 1).map((link) => (
        <SidebarLink
          key={link.name}
          name={link.name}
          href={link.href}
          icon={link.icon}
          active={link.active}
          arrow={link.arrow}
        />
      ))}
        </div>
        {/*Displaying settings*/}
        <div className="p-4 w-full">
        <SidebarLink
          key={links[links.length - 1].name}
          name={links[links.length - 1].name}
          href={links[links.length - 1].href}
          icon={links[links.length - 1].icon}
          active={links[links.length - 1].active}
          arrow={links[links.length - 1].arrow}
        />
        </div>
      </nav>
    </div>
  )
}}

export default Sidebar