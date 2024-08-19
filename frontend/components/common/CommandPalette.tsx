import React, { useState, useEffect, Fragment, useContext } from 'react';
import { Combobox, Dialog, Transition } from '@headlessui/react';
import { FaBolt, FaCog, FaCompass, FaCubes, FaHome, FaKey, FaMoon, FaPlus, FaProjectDiagram, FaSearch, FaSun, FaUserPlus, FaUsersCog } from "react-icons/fa";
import { useRouter } from 'next/navigation';
import { useQuery } from '@apollo/client';
import { GetApps } from '@/graphql/queries/getApps.gql';
import { organisationContext } from '@/contexts/organisationContext';
import { ThemeContext } from '@/contexts/themeContext';
import { BsListColumnsReverse } from 'react-icons/bs';
import { FaListCheck } from 'react-icons/fa6';

type CommandItem = {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
};

type CommandGroup = {
  name: string;
  items: CommandItem[];
  icon: React.ReactNode;
};

const CommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [modifierKey, setModifierKey] = useState('');
  const router = useRouter();
  const { activeOrganisation } = useContext(organisationContext);
  const { theme, setTheme } = useContext(ThemeContext);

  const { data: appsData } = useQuery(GetApps, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !activeOrganisation?.id,
  });

  const handleNavigation = (url: string) => {
    router.push(url);
    setIsOpen(false);
  };

  const navigationCommands: CommandItem[] = [
    {
      id: 'go-home',
      name: 'Go to Home',
      description: 'Navigate to the home page',
      icon: <FaHome className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}`),
    },
    {
      id: 'go-all-apps',
      name: 'Go to All Apps',
      description: 'View all applications',
      icon: <FaCubes className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/apps`),
    },
    {
      id: 'go-members',
      name: 'Go to Members',
      description: 'Manage organization members',
      icon: <FaUsersCog className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/members`),
    },
    {
      id: 'go-integrations',
      name: 'Go to Integrations',
      description: 'Manage integrations',
      icon: <FaProjectDiagram className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/integrations`),
    },
    {
      id: 'go-pat',
      name: 'Go to Access',
      description: 'Navigate to personal access tokens',
      icon: <FaKey className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/tokens`),
    },
    {
      id: 'go-settings',
      name: 'Go to Settings',
      description: 'Navigate to settings page',
      icon: <FaCog className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/settings`),
    },
  ];

  const actionCommands: CommandItem[] = [
    {
      id: 'toggle-theme',
      name: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      description: 'Switch between dark and light mode',
      icon: theme === 'dark' ? <FaSun className="h-5 w-5" /> : <FaMoon className="h-5 w-5" />,
      action: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    },
    {
      id: 'create-app',
      name: 'Create an App',
      description: 'Create a new application',
      icon: <FaPlus className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/apps/new`),
    },
    {
      id: 'invite-user',
      name: 'Invite a User',
      description: 'Invite a new user to the organization',
      icon: <FaUserPlus className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/members/invite`),
    },
  ];

  const appCommands: CommandGroup[] = appsData?.apps?.map((app: any) => ({
    name: `Application - ${app.name}`,
    icon: <FaCubes className="h-5 w-5" />,
    items: [
      ...(app.environments?.map((env: any) => ({
        id: `${app.id}-${env.id}`,
        name: `Go to ${env.name}`,
        description: `Explore ${env.name} environment of ${app.name}`,
        icon: <BsListColumnsReverse className="h-5 w-5" />,
        action: () => handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}/environments/${env.id}`),
      })) || []),
      {
        id: `${app.id}-logs`,
        name: `Go to Logs`,
        description: `View logs for ${app.name}`,
        icon: <FaListCheck className="h-5 w-5" />,
        action: () => handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}/logs`),
      },
    ],
  })) || [];

  const allCommands: CommandGroup[] = [
    ...(appCommands.length > 0 ? appCommands : []),
    { 
      name: 'Actions', 
      icon: <FaBolt className="h-5 w-5" />,
      items: actionCommands 
    },
    { 
      name: 'Navigation', 
      icon: <FaCompass className="h-5 w-5" />,
      items: navigationCommands 
    },
  ];

  const flattenedCommands = allCommands.flatMap(group => group.items);

  const filteredCommands = React.useMemo(() => {
    if (query === '') return flattenedCommands;
  
    const keywords = query.toLowerCase().split(/\s+/);
    
    return flattenedCommands.filter((command) => {
      const searchableText = `${command.name} ${command.description}`.toLowerCase();
      return keywords.every(keyword => searchableText.includes(keyword));
    });
  }, [query, flattenedCommands]);

  useEffect(() => {
    const detectPlatform = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      if (userAgent.includes('mac')) return 'macOS';
      if (userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('ipod')) return 'iOS';
      if (userAgent.includes('win')) return 'Windows';
      if (userAgent.includes('linux')) return 'Linux';
      return 'Unknown';
    };
  
    const platform = detectPlatform();
    setModifierKey(/^(mac|ios)/i.test(platform) ? '⌘' : 'Ctrl');
    }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="w-full max-w-xl h-9 flex items-center gap-2 rounded-full bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm pl-4 pr-3 text-sm text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-900/10 dark:ring-white/10 transition hover:ring-zinc-900/20 dark:hover:ring-white/20 ui-not-focus-visible:outline-none"
      >
        <div className="pl-2">
          <FaSearch className="h-4 w-4 flex-shrink-0" />
        </div>
        <span className="flex-grow text-left truncate">Find something...</span>
        <kbd className="flex-shrink-0 text-2xs text-zinc-400 dark:text-zinc-500">
          <kbd className="font-sans">{modifierKey}</kbd>
          <kbd className="font-sans"> + K</kbd>
        </kbd>
      </button>

      <Transition.Root show={isOpen} as={Fragment} afterLeave={() => setQuery('')}>
        <Dialog onClose={setIsOpen} className="fixed inset-0 z-50 overflow-y-auto p-4 sm:p-6 md:p-20">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Dialog.Overlay className="fixed inset-0 bg-zinc-400/25 dark:bg-black/40 backdrop-blur-sm" />
          </Transition.Child>

          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Combobox
              as="div"
              className="mx-auto max-w-xl transform divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden rounded-xl bg-white/80 dark:bg-zinc-800/80 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 backdrop-blur-sm backdrop-saturate-150 transition-all"
              onChange={(item: CommandItem) => {
                item.action();
                setIsOpen(false);
              }}
            >
              <div className="relative">
                <FaSearch
                  className="pointer-events-none absolute left-6 top-3.5 h-5 w-5 text-zinc-500 dark:text-zinc-400"
                  aria-hidden="true"
                />
                <Combobox.Input
                  className="h-14 w-full border-0 bg-transparent pl-14 pr-4 text-zinc-900 dark:text-white placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:ring-0 sm:text-sm"
                  placeholder="Type a command or search..."
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

              {filteredCommands.length > 0 && (
                <Combobox.Options static className="max-h-[42rem] overflow-y-auto">
                  {allCommands.map((group, groupIndex) => {
                    const filteredGroupCommands = group.items.filter((command) =>
                      filteredCommands.some((fc) => fc.id === command.id)
                    );

                    if (filteredGroupCommands.length === 0) return null;

                    return (
                      <div key={group.name} className="px-4 py-2">
                        {groupIndex > 0 && (
                          <div className="border-t border-gray-100 dark:border-gray-800 my-2"></div>
                        )}
                        <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 flex items-center">
                          <span className="mr-2">{group.icon}</span>
                          {group.name}
                        </div>
                        <ul>
                          {filteredGroupCommands.map((item) => (
                            <Combobox.Option key={item.id} value={item} as={Fragment}>
                              {({ active }) => (
                                <li
                                  className={`flex cursor-default select-none items-center rounded-md px-3 py-2 ${
                                    active ? 'bg-zinc-200/50 dark:bg-zinc-700/50' : ''
                                  }`}
                                >
                                  <div className="flex h-6 w-6 items-center justify-center text-zinc-900 dark:text-zinc-100">
                                    {item.icon}
                                  </div>
                                  <div className="ml-3">
                                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">{item.name}</div>
                                    <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{item.description}</div>
                                  </div>
                                </li>
                              )}
                            </Combobox.Option>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </Combobox.Options>
              )}

              {query !== '' && filteredCommands.length === 0 && (
                <div className="py-14 px-6 text-center sm:px-14">
                  <FaSearch
                    className="mx-auto h-6 w-6 text-zinc-500 dark:text-zinc-400"
                    aria-hidden="true"
                  />
                  <p className="mt-4 text-sm text-zinc-700 dark:text-zinc-300">
                    No results found for "<strong className="font-semibold">{query}</strong>". Please try again.
                  </p>
                </div>
              )}
            </Combobox>
          </Transition.Child>
        </Dialog>
      </Transition.Root>
    </>
  );
};

export default CommandPalette;