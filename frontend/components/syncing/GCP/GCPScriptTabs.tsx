import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment, ReactNode, useContext } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { coldarkCold, vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import CopyButton from '@/components/common/CopyButton'
import { ThemeContext } from '@/contexts/themeContext'

export type GCPScriptTab = {
  name: string
  // null while the script can't be built yet; the placeholder shows instead.
  script: string | null
}

/** A highlighted shell script with a copy button. */
export const GCPScriptBlock = (props: { script: string }) => {
  const { theme } = useContext(ThemeContext)

  return (
    <div className="relative">
      <div className="absolute right-3 top-2 z-10">
        <CopyButton value={props.script} buttonVariant="secondary" />
      </div>
      <SyntaxHighlighter
        language="bash"
        style={theme === 'dark' ? vscDarkPlus : coldarkCold}
        customStyle={{
          margin: 0,
          maxHeight: '17rem',
          overflow: 'auto',
          fontSize: '1rem',
          lineHeight: '1.5',
          fontFamily: 'var(--font-jetbrains-mono)',
          background: theme === 'dark' ? '#171717' : '#e4e4e7',
          paddingRight: '6rem',
        }}
        codeTagProps={{
          style: { fontSize: '1rem', fontFamily: 'var(--font-jetbrains-mono)' },
        }}
      >
        {props.script}
      </SyntaxHighlighter>
    </div>
  )
}

/** Shell scripts in tabs, one per Phase integration that uses the Google
 * Cloud credential (see GCP_INTEGRATIONS). */
export const GCPScriptTabs = (props: { tabs: GCPScriptTab[]; placeholder?: ReactNode }) => (
  <Tab.Group>
    <Tab.List className="flex gap-1 overflow-x-auto rounded-t-lg border border-neutral-500/40 bg-zinc-800 text-2xs font-medium md:gap-2 md:px-4">
      {props.tabs.map((tab) => (
        <Tab as={Fragment} key={tab.name}>
          {({ selected }) => (
            <button
              type="button"
              className={clsx(
                'ease shrink-0 border-b p-2 outline-none transition focus:outline-none',
                selected
                  ? 'border-emerald-500 text-emerald-500'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              )}
            >
              {tab.name}
            </button>
          )}
        </Tab>
      ))}
    </Tab.List>
    <Tab.Panels>
      {props.tabs.map((tab) => (
        <Tab.Panel
          key={tab.name}
          className="overflow-hidden rounded-b-lg border-x border-b border-neutral-500/40"
        >
          {tab.script === null ? (
            <div className="p-4 text-xs text-neutral-500">{props.placeholder}</div>
          ) : (
            <GCPScriptBlock script={tab.script} />
          )}
        </Tab.Panel>
      ))}
    </Tab.Panels>
  </Tab.Group>
)
