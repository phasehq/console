import CopyButton from 'components/common/CopyButton'

export const CliCommand = (props: { command: string; comment?: string; prefix?: string }) => {
  const prefix = props.prefix || 'phase'

  const prefixedCommand = `${prefix} ${props.command}`

  return (
    <div className="group relative rounded-lg border border-neutral-500/40 bg-zinc-300/50 dark:bg-zinc-800/50 p-4 text-left text-sm text-zinc-900 dark:text-zinc-100">
      <pre className="whitespace-pre-wrap">
        <span className="text-emerald-800 dark:text-emerald-300">{prefix}</span> {props.command}{' '}
        {props.comment && (
          <span className="text-neutral-500">
            {'#'}
            {props.comment}
          </span>
        )}
      </pre>
      <div className="absolute right-4 top-3.5 ">
        <CopyButton value={prefixedCommand} />
      </div>
    </div>
  )
}
