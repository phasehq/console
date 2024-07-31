import React, { useContext, useEffect, useState } from 'react'
import { Dialog, Combobox } from '@headlessui/react'
import { FaSearch } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { GetApps } from '@/graphql/queries/getApps.gql'
import {
  PlusIcon,
  CommandLineIcon,
  ArrowRightCircleIcon,
  UsersIcon,
  CogIcon,
  WindowIcon,
  LightBulbIcon,
} from '@heroicons/react/24/outline'
import { ThemeContext } from '@/contexts/themeContext'
import { useQuery } from '@apollo/client'
import { organisationContext } from '@/contexts/organisationContext'

const CommandPalette = () => {
  const { activeOrganisation: organisation, loading: orgLoading } = useContext(organisationContext)
  const router = useRouter()
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [search, setSearch] = useState('')
  const { theme, setTheme } = useContext(ThemeContext)

  const { data: appsData, loading: appsLoading } = useQuery(GetApps, {
    variables: { organisationId: organisation?.id },
    skip: !organisation?.id,
  })

  const [filteredItems, setFilteredItems] = useState<any[]>([
    {
      heading: 'Actions',
      id: 'actions',
      items: [
        {
          id: 'create-app',
          children: 'Create an App',
          icon: <PlusIcon className="h-5 w-5" />,
          onClick: () => handleNavigation('/open-integrations/apps'),
        },
        {
          id: 'navigate-app',
          children: 'Navigate to an App',
          icon: <CommandLineIcon className="h-5 w-5" />,
          onClick: () => handleNavigation('/navigate-app'),
        },
        {
          id: 'invite-user',
          children: 'Invite a User',
          icon: <PlusIcon className="h-5 w-5" />,
          onClick: () => handleNavigation('/open-integrations/members'),
        },
        {
          id: 'manage-org-users',
          children: 'Manage Organisation Users',
          icon: <UsersIcon className="h-5 w-5" />,
          onClick: () => handleNavigation('/manage-org-users'),
        },
        {
          id: 'navigate-settings',
          children: 'Navigate to Settings',
          icon: <CogIcon className="h-5 w-5" />,
          onClick: () => handleNavigation('/open-integrations/settings'),
        },
      ],
    },
    {
      heading: 'Theme',
      id: 'theme',
      items: [
        {
          id: 'toggle-theme',
          children: 'Toggle dark / light theme',
          icon: <WindowIcon className="h-5 w-5" />,
          onClick: () => {
            setTheme(theme === 'dark' ? 'light' : 'dark')
          },
        },
      ],
    },
  ])

  useEffect(() => {
    const constructItems = async () => {
      if (appsData && appsData.apps) {
        const appItems = await Promise.all(
          appsData.apps.map(async (app:any) => {
            return {
              heading: app.name,
              id: app.id,
              items: [
                {
                  id: `${app.id}-logs`,
                  children: `${app.name} >  Logs`,
                  icon: <LightBulbIcon className="h-5 w-5" />,
                  onClick: () => handleNavigation(`/open-integrations/apps/${app.id}/logs`),
                },
                ...(app.environments?.map((env:any) => ({
                  id: `${app.id}-${env.id}`,
                  children: `${app.name} > ${env.name} Environment`,
                  icon: <ArrowRightCircleIcon className="h-5 w-5" />,
                  onClick: () =>
                    handleNavigation(`/open-integrations/apps/${app.id}/environments/${env.id}`),
                })) || []),
              ],
            }
          })
        )

        const uniqueAppItems = new Set()
        const filteredAppItems = appItems.filter((item) => {
          if (uniqueAppItems.has(item.id)) {
            return false
          } else {
            uniqueAppItems.add(item.id)
            return true
          }
        })

        setFilteredItems((prevItems) => [...prevItems, ...filteredAppItems])
      }
    }

    if (!appsLoading && appsData) {
      constructItems()
    }
  }, [appsData, appsLoading])

  const handleNavigation = (url: string) => {
    router.push(url)
    setSearch('')
    setIsOpen(false)
  }

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        setIsOpen((prevIsOpen) => !prevIsOpen)
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('keydown', onKeydown)
    }
  }, [])

  const filtered = filteredItems.flatMap((group) =>
    group.items.filter((item:any) => item.children.toLowerCase().includes(search.toLowerCase()))
  )

  if (orgLoading) {
    return <div>Loading...</div>
  }

  return (
    <Dialog
      open={isOpen}
      onClose={() => {
        setIsOpen(false)
        setSearch('')
      }}
      className="fixed z-50 text-black inset-0 p-4 pt-[25vh] overflow-y-auto"
    >
      <Dialog.Overlay className="fixed inset-0 bg-black/25 backdrop-blur-md" />
      <Combobox
        onChange={(item:any) => {
          item.onClick()
        }}
        as="div"
        className="relative mx-auto max-w-xl rounded-xl dark:bg-[#171717] bg-white shadow-2xl ring-1 ring-black/5"
      >
        <div className="flex items-center">
          <FaSearch className="dark:text-gray-300 text-gray-600 mx-2 absolute left-0 h-5 w-5 " />
          <Combobox.Input
            onChange={(e) => setSearch(e.target.value)}
            className="w-full dark:bg-black bg-transparent pl-10 focus:ring-0 text-sm text-gray-800 placeholder:text-gray-400 h-12"
            placeholder="Search..."
          />
        </div>
        {filtered.length > 0 && (
          <Combobox.Options static className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredItems.map((group) => (
              <div key={group.id} className="p-2">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-400">
                  {group.heading}
                </div>
                {group.items
                  .filter((item:any) => item.children.toLowerCase().includes(search.toLowerCase()))
                  .map((item:any) => (
                    <Combobox.Option
                      key={item.id}
                      value={item}
                      className={({ active }) =>
                        `flex items-center p-2 cursor-pointer space-x-3 ${
                          active ? 'dark:bg-[#1F2C27] bg-gray-100 dark:text-emerald-400 text-black' : 'text-gray-900 dark:text-gray-100'
                        }`
                      }
                    >
                      {item.icon}
                      <span>{item.children}</span>
                    </Combobox.Option>
                  ))}
              </div>
            ))}
          </Combobox.Options>
        )}
        {filtered.length === 0 && (
          <div className="px-4 py-4 text-gray-500 dark:text-gray-400">No results found.</div>
        )}
      </Combobox>
    </Dialog>
  )
}

export default CommandPalette