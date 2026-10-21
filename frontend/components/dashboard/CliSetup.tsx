'use client'

import clsx from 'clsx'
import { ReactNode, useId } from 'react'
import { FaExternalLinkAlt, FaTerminal, FaTimes } from 'react-icons/fa'
import { CliCommand } from './CliCommand'
import { CliInstallCommands } from './CliInstallCommands'

const CLI_DOCS = 'https://docs.phase.dev/cli/install'

const Step = (props: { n: number; title: string; className?: string; children: ReactNode }) => (
  <li className={clsx('min-w-0 space-y-2', props.className)}>
    <div className="flex items-center gap-2 text-xs font-medium text-zinc-900 dark:text-zinc-100">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-2xs font-semibold text-emerald-700 dark:text-emerald-400">
        {props.n}
      </span>
      {props.title}
    </div>
    {props.children}
  </li>
)

/** Getting started with the CLI, in place of the old guide's setup step. */
export const CliSetup = (props: { onCreateToken: () => void; onHide: () => void }) => {
  // The access card renders its list twice (a hidden copy sizes it), so ids must be unique
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-lg bg-zinc-200/50 p-3 ring-1 ring-inset ring-neutral-500/20 dark:bg-zinc-900/40 sm:p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <FaTerminal className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="min-w-0">
            <h3 id={titleId} className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Set up the Phase CLI
            </h3>
            <p className="text-2xs text-neutral-500">
              The Phase CLI is how you integrate Phase with your local development environment,
              scripts and CI.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href={CLI_DOCS}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-2xs font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            Docs <FaExternalLinkAlt className="text-3xs" />
          </a>
          <button
            type="button"
            onClick={props.onHide}
            title="Hide"
            aria-label="Hide CLI setup"
            className="flex size-6 items-center justify-center rounded-md text-2xs text-neutral-500 transition-colors hover:bg-neutral-500/15 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <FaTimes />
          </button>
        </div>
      </div>

      {/* Install commands are long, so they get the full width; the other steps fit as many
          to a row as the box has room for, whatever the card's width */}
      <ol className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]">
        <Step n={1} title="Install the Phase CLI" className="col-span-full">
          <CliInstallCommands />
        </Step>
        <Step n={2} title="Sign in">
          <CliCommand command="auth" />
          <p className="text-2xs text-neutral-500">
            Opens the Console in your browser to sign in. For scripts, CI or agents,{' '}
            <button
              type="button"
              onClick={props.onCreateToken}
              className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
            >
              create a token
            </button>{' '}
            instead.
          </p>
        </Step>
        <Step n={3} title="Link your app">
          <CliCommand command="init" />
        </Step>
        <Step n={4} title="Run your app with its secrets">
          <CliCommand command="run <start command>" />
          <p className="text-2xs text-neutral-500">
            For example, <code className="whitespace-nowrap font-mono">phase run yarn start</code>
          </p>
        </Step>
      </ol>
    </section>
  )
}
