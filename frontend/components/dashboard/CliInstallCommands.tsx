import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import CopyButton from 'components/common/CopyButton'
import { Fragment } from 'react'

export const CliInstallCommands = () => {
  const platformScripts = [
    {
      name: 'MacOS',
      rawScript: 'brew install phase/cli/phase',
      styledScript: (
        <pre>
          <span className="text-violet-800 dark:text-violet-300">brew</span> install
          phasehq/cli/phase
        </pre>
      ),
    },
    {
      name: 'Windows',
      rawScript:
        'scoop bucket add phasehq https://github.com/phasehq/scoop-cli.git; scoop install phase',
      styledScript: (
        <div className="space-y-1">
          <pre>
            <span className="text-violet-800 dark:text-violet-300">scoop</span> scoop bucket add
            phasehq https://github.com/phasehq/scoop-cli.git
          </pre>
          <pre>
            <span className="text-violet-800 dark:text-violet-300">scoop</span> install phase
          </pre>
        </div>
      ),
    },
    {
      name: 'Ubuntu/Debian',
      rawScript: 'curl -fsSL https://pkg.phase.dev/install.sh | bash',
      styledScript: (
        <pre>
          <span className="text-violet-800 dark:text-violet-300">curl</span> -fsSL
          https://pkg.phase.dev/install.sh | bash
        </pre>
      ),
    },
    {
      name: 'RedHat/CentOS/Amazon Linux',
      rawScript: 'curl -fsSL https://pkg.phase.dev/install.sh | bash',
      styledScript: (
        <pre>
          <span className="text-violet-800 dark:text-violet-300">curl</span> -fsSL
          https://pkg.phase.dev/install.sh | bash
        </pre>
      ),
    },
    {
      name: 'Arch Linux',
      rawScript: 'curl -fsSL https://pkg.phase.dev/install.sh | bash',
      styledScript: (
        <pre>
          <span className="text-violet-800 dark:text-violet-300">curl</span> -fsSL
          https://pkg.phase.dev/install.sh | bash
        </pre>
      ),
    },
    {
      name: 'Python Pip',
      rawScript: 'pip install phase',
      styledScript: (
        <pre>
          <span className="text-violet-800 dark:text-violet-300">pip3</span> install phase-cli
        </pre>
      ),
    },
    {
      name: 'Alpine Linux',
      rawScript: 'apk add --no-cache curl && curl -fsSL https://pkg.phase.dev/install.sh | sh',
      styledScript: (
        <pre>
          <span className="text-violet-800 dark:text-violet-300">apk</span> add --no-cache curl &&
          <span className="text-violet-800 dark:text-violet-300"> curl</span> -fsSL
          https://pkg.phase.dev/install.sh |
          <span className="text-violet-800 dark:text-violet-300">sh</span>
        </pre>
      ),
    },
    {
      name: 'Docker',
      rawScript: 'docker run phasehq/cli',
      styledScript: (
        <pre>
          <span className="text-violet-800 dark:text-violet-300">docker</span> run phase/cli
        </pre>
      ),
    },
  ]
  return (
    <Tab.Group>
      <Tab.List className="flex gap-1 overflow-x-auto rounded-t-lg border border-neutral-500/40 bg-zinc-800 text-2xs font-medium md:gap-2 md:px-4">
        {platformScripts.map((platform) => (
          <Tab as={Fragment} key={platform.name}>
            {({ selected }) => (
              <button
                className={clsx(
                  'ease shrink-0 border-b p-2 outline-none transition focus:outline-none',
                  selected
                    ? 'border-emerald-500 text-emerald-500'
                    : 'border-transparent text-neutral-400 hover:text-neutral-200'
                )}
              >
                {platform.name}
              </button>
            )}
          </Tab>
        ))}
      </Tab.List>
      <Tab.Panels>
        {platformScripts.map((platform) => (
          <Tab.Panel as={Fragment} key={platform.name}>
            <div className="group relative overflow-x-auto rounded-b-lg border-x border-b border-neutral-500/40 bg-zinc-300/50 dark:bg-zinc-800/50 p-4 text-left text-sm text-zinc-900 dark:text-zinc-100">
              <code>{platform.styledScript}</code>
              <CopyButton code={platform.rawScript} />
            </div>
          </Tab.Panel>
        ))}
      </Tab.Panels>
    </Tab.Group>
  )
}
