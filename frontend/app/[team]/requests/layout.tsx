'use client'

/** Requests sit in the main navigation; today they hold what Agents ask for. */
export default function RequestsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full text-zinc-900 dark:text-zinc-100">
      <div className="px-3 pt-3 sm:px-4 sm:pt-4 lg:px-6 lg:pt-6">
        <h1 className="text-lg font-semibold sm:text-xl">Requests</h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          Review and approve what is waiting on a member of your organisation.
        </p>
      </div>
      <div className="px-3 py-4 sm:px-4 lg:px-6">{children}</div>
    </div>
  )
}
