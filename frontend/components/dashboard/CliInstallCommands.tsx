import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment, useEffect, useState } from 'react'
import { FaCopy } from 'react-icons/fa'

function CopyButton(props: { code: string }) {
  const { code } = props

  const [copyCount, setCopyCount] = useState(0)
  const copied = copyCount > 0

  useEffect(() => {
    if (copyCount > 0) {
      const timeout = setTimeout(() => setCopyCount(0), 1000)
      return () => {
        clearTimeout(timeout)
      }
    }
    return undefined
  }, [copyCount])

  return (
    <button
      type="button"
      className={clsx(
        'absolute right-4 top-3.5 overflow-hidden rounded-full py-1 pl-2 pr-3 text-2xs font-medium opacity-0 backdrop-blur transition focus:opacity-100 group-hover:opacity-100',
        copied
          ? 'bg-emerald-400/10 ring-1 ring-inset ring-emerald-400/20'
          : 'bg-zinc-800 dark:hover:bg-zinc-700'
      )}
      onClick={() => {
        window.navigator.clipboard.writeText(code).then(() => {
          setCopyCount((count) => count + 1)
        })
      }}
    >
      <span
        aria-hidden={copied}
        className={clsx(
          'pointer-events-none flex items-center gap-0.5 text-zinc-400 transition duration-300',
          copied && '-translate-y-1.5 opacity-0'
        )}
      >
        <FaCopy className="h-5 w-5 transition-colors" />
        Copy
      </span>
      <span
        aria-hidden={!copied}
        className={clsx(
          'pointer-events-none absolute inset-0 flex items-center justify-center text-emerald-400 transition duration-300',
          !copied && 'translate-y-1.5 opacity-0'
        )}
      >
        Copied!
      </span>
    </button>
  )
}

export const CliInstallCommands = () => {
  const platformScripts = [
    {
      name: 'Pip',
      rawScript: 'pip install phase',
      styledScript: (
        <pre>
          <span className="text-violet-300">pip</span> install phase-cli
        </pre>
      ),
    },
    {
      name: 'MacOS',
      rawScript: 'brew install phase/cli/phase',
      styledScript: (
        <pre>
          <span className="text-violet-300">brew</span> install phasehq/cli/phase
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
            <span className="text-violet-300">scoop</span> scoop bucket add phasehq
            https://github.com/phasehq/scoop-cli.git
          </pre>
          <pre>
            <span className="text-violet-300">scoop</span> install phase
          </pre>
        </div>
      ),
    },
    {
      name: 'Alpine Linux',
      rawScript: 'apk add --no-cache curl && curl -fsSL https://pkg.phase.dev/install.sh | sh',
      styledScript: (
        <pre>
          <span className="text-violet-300">apk</span> add --no-cache curl &&
          <span className="text-violet-300"> curl</span> -fsSL https://pkg.phase.dev/install.sh |
          <span className="text-violet-300">sh</span>
        </pre>
      ),
    },
    {
      name: 'RedHat/CentOS/Amazon Linux',
      rawScript: 'curl -fsSL https://pkg.phase.dev/install.sh | bash',
      styledScript: (
        <pre>
          <span className="text-violet-300">curl</span> -fsSL https://pkg.phase.dev/install.sh |
          bash
        </pre>
      ),
    },
    {
      name: 'Ubuntu/Debian',
      rawScript: 'curl -fsSL https://pkg.phase.dev/install.sh | bash',
      styledScript: (
        <pre>
          <span className="text-violet-300">curl</span> -fsSL https://pkg.phase.dev/install.sh |
          bash
        </pre>
      ),
    },
    {
      name: 'Arch Linux',
      rawScript: 'curl -fsSL https://pkg.phase.dev/install.sh | bash',
      styledScript: (
        <pre>
          <span className="text-violet-300">curl</span> -fsSL https://pkg.phase.dev/install.sh |
          bash
        </pre>
      ),
    },
    {
      name: 'Docker',
      rawScript: 'docker run phasehq/cli',
      styledScript: (
        <pre>
          <span className="text-violet-300">docker</span> run phase/cli
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
            <div className="group relative overflow-x-auto rounded-b-lg border-x border-b border-neutral-500/40 bg-zinc-900/50 p-4 text-left text-sm text-zinc-100">
              <code>{platform.styledScript}</code>
              <CopyButton code={platform.rawScript} />
            </div>
          </Tab.Panel>
        ))}
      </Tab.Panels>
    </Tab.Group>
  )
}
