import CopyButton from 'components/common/CopyButton'

export const CliCommand = (props: { 
  command: string; 
  comment?: string; 
  prefix?: string;
  wrap?: boolean;
}) => {
  const prefix = props.prefix ?? 'phase'
  const wrap = props.wrap ?? false

  const prefixedCommand = prefix ? `${prefix} ${props.command}` : props.command

  return (
    <div className="group relative rounded-lg border border-neutral-500/40 bg-zinc-300/50 dark:bg-zinc-800/50 p-4 text-left text-sm text-zinc-900 dark:text-zinc-100">
      <div className={`${!wrap ? 'overflow-x-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-neutral-600' : ''}`}>
        <pre className={`${wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
          {prefix && (
            <span className="text-emerald-800 dark:text-emerald-300">{prefix}</span>
          )}
          {prefix && ' '}
          {props.command}{' '}
          {props.comment && (
            <span className="text-neutral-500">
              {'#'}
              {props.comment}
            </span>
          )}
        </pre>
      </div>
      <div className="absolute right-4 top-3.5">
        <CopyButton value={prefixedCommand} />
      </div>
    </div>
  )
}
