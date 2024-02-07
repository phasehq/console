import CopyButton from 'components/common/CopyButton'

export const CliCommand = (props: { command: string; comment?: string }) => {
  const prefixedCommand = `phase ${props.command}`

  return (
    <div className="group relative overflow-x-auto rounded-lg border border-neutral-500/40 bg-zinc-300/50 dark:bg-zinc-800/50 p-4 text-left text-sm text-zinc-900 dark:text-zinc-100">
      <pre>
        <span className="text-emerald-800 dark:text-emerald-300">phase</span> {props.command}{' '}
        {props.comment && (
          <span className="text-neutral-500">
            {'#'}
            {props.comment}
          </span>
        )}
      </pre>
      <CopyButton code={prefixedCommand} />
    </div>
  )
}
