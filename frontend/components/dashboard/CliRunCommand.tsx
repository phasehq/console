import CopyButton from 'components/common/CopyButton'

export const CliRunCommand = () => {
  const command = 'phase run'

  return (
    <div className="group relative overflow-x-auto rounded-lg border border-neutral-500/40 bg-zinc-900/50 p-4 text-left text-sm text-zinc-100">
      <pre>
        <span className="text-violet-300">phase</span> run <span className="text-gray-600">{"YOUR_APPLICATION_START_COMMAND"}</span>
      </pre>
      <CopyButton code={command} />
    </div>
  )
}