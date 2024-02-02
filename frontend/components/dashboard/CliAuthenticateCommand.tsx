import CopyButton from 'components/common/CopyButton'

export const CliAuthenticateCommand = () => {
  const command = 'phase auth'

  return (
    <div className="group relative overflow-x-auto rounded-lg border border-neutral-500/40 bg-zinc-900/50 p-4 text-left text-sm text-zinc-100">
      <pre>
        <span className="text-violet-300">phase</span> auth
      </pre>
      <CopyButton code={command} />
    </div>
  )
}
