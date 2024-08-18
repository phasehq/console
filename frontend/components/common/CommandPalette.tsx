import React, { useState, useRef, useEffect, Fragment, useContext } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { FaSearch } from "react-icons/fa";
import { useRouter } from 'next/navigation';
import { useQuery } from '@apollo/client';
import { GetApps } from '@/graphql/queries/getApps.gql';
import { organisationContext } from '@/contexts/organisationContext';
import { ThemeContext } from '@/contexts/themeContext';
import {
  PlusIcon,
  CommandLineIcon,
  ArrowRightCircleIcon,
  UsersIcon,
  CogIcon,
  WindowIcon,
  LightBulbIcon,
  ServerIcon,
} from '@heroicons/react/24/outline';

type CommandItem = {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
};

const CommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [modifierKey, setModifierKey] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
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

  const baseCommands: CommandItem[] = [
    {
      id: 'create-app',
      name: 'Create an App',
      description: 'Create a new application',
      icon: <PlusIcon className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/apps`),
    },
    {
      id: 'invite-user',
      name: 'Invite a User',
      description: 'Invite a new user to the organization',
      icon: <UsersIcon className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/members`),
    },
    {
      id: 'manage-org-users',
      name: 'Manage Organisation Users',
      description: 'Manage users in your organization',
      icon: <UsersIcon className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/members`),
    },
    {
      id: 'navigate-settings',
      name: 'Navigate to Settings',
      description: 'Go to settings page',
      icon: <CogIcon className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/settings`),
    },
    {
      id: 'toggle-theme',
      name: 'Toggle dark / light theme',
      description: 'Switch between dark and light mode',
      icon: <WindowIcon className="h-5 w-5" />,
      action: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    },
    {
      id: 'list-all-apps',
      name: 'List All Apps',
      description: 'Show all applications in the organization',
      icon: <CommandLineIcon className="h-5 w-5" />,
      action: () => {
        const appsList = appsData?.apps.map((app: any) => `${app.name} (ID: ${app.id})`).join('\n');
        alert(`All Apps:\n${appsList}`);
      },
    },
  ];

  const appCommands: CommandItem[] = appsData?.apps?.flatMap((app: any) => [
    {
      id: `${app.id}-details`,
      name: `${app.name} Details`,
      description: `View details for ${app.name}`,
      icon: <ServerIcon className="h-5 w-5" />,
      action: () => {
        const details = `
          App Name: ${app.name}
          ID: ${app.id}
          Identity Key: ${app.identityKey}
          Created At: ${new Date(app.createdAt).toLocaleString()}
          SSE Enabled: ${app.sseEnabled ? 'Yes' : 'No'}
          Members: ${app.members.map((m: any) => m.email).join(', ')}
        `;
        alert(details);
      },
    },
    {
      id: `${app.id}-logs`,
      name: `${app.name} Logs`,
      description: `View logs for ${app.name}`,
      icon: <LightBulbIcon className="h-5 w-5" />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}/logs`),
    },
    ...(app.environments?.map((env: any) => ({
      id: `${app.id}-${env.id}`,
      name: `${app.name} > ${env.name} Environment`,
      description: `Go to ${env.name} environment of ${app.name}`,
      icon: <ArrowRightCircleIcon className="h-5 w-5" />,
      action: () => {
        const envDetails = `
          Environment Name: ${env.name}
          ID: ${env.id}
          Type: ${env.envType}
          Syncs: ${env.syncs.map((s: any) => s.serviceInfo.name).join(', ')}
        `;
        alert(envDetails);
        handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}/environments/${env.id}`);
      },
    })) || []),
  ]) || [];

  const allCommands = [...baseCommands, ...appCommands];

  const filteredCommands = allCommands.filter(command =>
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
          <kbd className="font-sans">+ K</kbd>
        </kbd>
      </button>

      <Transition.Root show={isOpen} as={Fragment} afterLeave={() => setQuery('')}>
        <Dialog
          onClose={setIsOpen}
          className="fixed inset-0 z-50 overflow-y-auto p-4 sm:p-6 md:p-20"
        >
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
            <Dialog.Panel className="mx-auto max-w-xl transform divide-y divide-zinc-100 overflow-hidden rounded-xl bg-zinc-50 shadow-2xl ring-1 ring-black ring-opacity-5 backdrop-blur backdrop-filter transition-all dark:divide-zinc-800 dark:bg-zinc-900">
              <div className="relative">
                <FaSearch
                  className="pointer-events-none absolute left-6 top-3.5 h-5 w-5 text-zinc-500 dark:text-zinc-400"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  className="h-14 w-full border-0 bg-transparent pl-14 pr-4 text-zinc-900 focus:ring-0 sm:text-sm dark:text-white"
                  placeholder="Type a command or search..."
                  onChange={(e) => setQuery(e.target.value)}
                  ref={inputRef}
                />
              </div>

              {filteredCommands.length > 0 && (
                <ul className="max-h-80 scroll-py-2 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
                  {filteredCommands.map((item) => (
                    <li
                      key={item.id}
                      className="flex cursor-default select-none items-center px-4 py-2 hover:bg-zinc-200 dark:hover:bg-zinc-700/50"
                      onClick={() => {
                        item.action();
                        setIsOpen(false);
                      }}
                    >
                      <div className="flex h-6 w-6 items-center justify-center">
                        {item.icon}
                      </div>
                      <div className="ml-3">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">{item.name}</div>
                        <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{item.description}</div>
                      </div>
                    </li>
                  ))}
                </ul>
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
            </Dialog.Panel>
          </Transition.Child>
        </Dialog>
      </Transition.Root>
    </>
  );
};

export default CommandPalette;