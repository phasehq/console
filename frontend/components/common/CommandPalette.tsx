import React, { useState, useEffect, Fragment, useContext } from 'react';
import { Combobox, Dialog, Transition } from '@headlessui/react';
import { FaSearch } from "react-icons/fa";
import { useRouter } from 'next/navigation';
import { useQuery } from '@apollo/client';
import { GetApps } from '@/graphql/queries/getApps.gql';
import { organisationContext } from '@/contexts/organisationContext';
import { ThemeContext } from '@/contexts/themeContext';
import {
  PlusIcon,
  ArrowRightCircleIcon,
  UsersIcon,
  CogIcon,
  WindowIcon,
  LightBulbIcon,
  HomeIcon,
  Square3Stack3DIcon,
  PuzzlePieceIcon,
} from '@heroicons/react/24/outline';

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
      icon: <HomeIcon className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}`),
    },
    {
      id: 'go-all-apps',
      name: 'Go to All Apps',
      description: 'View all applications',
      icon: <Square3Stack3DIcon className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/apps`),
    },
    {
      id: 'go-settings',
      name: 'Go to Settings',
      description: 'Navigate to settings page',
      icon: <CogIcon className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/settings`),
    },
    {
      id: 'go-members',
      name: 'Go to Members',
      description: 'Manage organization members',
      icon: <UsersIcon className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/members`),
    },
    {
      id: 'go-integrations',
      name: 'Go to Integrations',
      description: 'Manage integrations',
      icon: <PuzzlePieceIcon className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/integrations`),
    },
  ];

  const actionCommands: CommandItem[] = [
    {
      id: 'toggle-theme',
      name: 'Toggle dark / light theme',
      description: 'Switch between dark and light mode',
      icon: <WindowIcon className="h-5 w-5" />,
      action: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    },
    {
      id: 'create-app',
      name: 'Create an App',
      description: 'Create a new application',
      icon: <PlusIcon className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/apps/new`),
    },
    {
      id: 'invite-user',
      name: 'Invite a User',
      description: 'Invite a new user to the organization',
      icon: <UsersIcon className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/members/invite`),
    },
  ];

  const appCommands: CommandGroup[] = appsData?.apps?.map((app: any) => ({
    name: app.name,
    items: [
      {
        id: `${app.id}-logs`,
        name: `${app.name} Logs`,
        description: `View logs for ${app.name}`,
        icon: <LightBulbIcon className="h-5 w-5" />,
        action: () => handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}/logs`),
      },
      ...(app.environments?.map((env: any) => ({
        id: `${app.id}-${env.id}`,
        name: `${env.name} Environment`,
        description: `Go to ${env.name} environment of ${app.name}`,
        icon: <ArrowRightCircleIcon className="h-5 w-5" />,
        action: () => handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}/environments/${env.id}`),
      })) || []),
    ],
  })) || [];

  const allCommands: CommandGroup[] = [
    ...(appCommands.length > 0 ? appCommands : []),
    { name: 'Navigation', items: navigationCommands },
    { name: 'Actions', items: actionCommands },
  ];

  const flattenedCommands = allCommands.flatMap(group => group.items);

  const filteredCommands = query === ''
    ? flattenedCommands
    : flattenedCommands.filter((command) =>
        command.name.toLowerCase().includes(query.toLowerCase()) ||
        command.description.toLowerCase().includes(query.toLowerCase())
      );

  useEffect(() => {
    setModifierKey(
      /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform) ? '⌘' : 'Ctrl'
    );
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
        className="w-full max-w-xl h-9 flex items-center gap-2 rounded-full bg-white pl-4 pr-3 text-sm text-zinc-500 ring-1 ring-zinc-900/10 transition hover:ring-zinc-900/20 ui-not-focus-visible:outline-none dark:bg-white/5 dark:text-zinc-400 dark:ring-inset dark:ring-white/10 dark:hover:ring-white/20"
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
            <Dialog.Overlay className="fixed inset-0 bg-zinc-400/25 backdrop-blur-sm dark:bg-black/40" />
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
              className="mx-auto max-w-xl transform overflow-hidden rounded-xl bg-zinc-50 shadow-2xl ring-1 ring-black ring-opacity-5 backdrop-blur backdrop-filter transition-all dark:bg-zinc-900 dark:ring-zinc-800"
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
                  className="h-14 w-full border-0 bg-transparent pl-14 pr-4 text-zinc-900 focus:ring-0 sm:text-sm dark:text-white"
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
                      <div key={group.name}>
                        {groupIndex > 0 && (
                          <div className="border-t border-zinc-200 dark:border-zinc-700 my-2"></div>
                        )}
                        <div className="px-4 py-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                          {group.name}
                        </div>
                        <ul>
                          {filteredGroupCommands.map((item) => (
                            <Combobox.Option key={item.id} value={item} as={Fragment}>
                              {({ active }) => (
                                <li
                                  className={`flex cursor-default select-none items-center px-4 py-2 ${
                                    active ? 'bg-zinc-200 dark:bg-zinc-700/50' : ''
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
                    className="mx-auto h-6 w-5 text-zinc-500 dark:text-zinc-400"
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