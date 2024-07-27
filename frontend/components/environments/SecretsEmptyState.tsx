import { ReactNode } from 'react'

export const SecretsEmptyState = (props: { children: ReactNode }) => {
  return (
    <div className="p-10 flex flex-col gap-6 items-center justify-center">
      <div className="text-center">
        <div className="font-semibold text-zinc-900 dark:text-zinc-100 text-lg">
          No secrets here
        </div>
        <div className="text-neutral-500">Add secrets or folders here to get started</div>
      </div>
      {props.children}
    </div>
  )
}
