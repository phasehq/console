'use client'

/** Change requests sit in the main navigation. The page owns its heading and controls. */
export default function RequestsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full text-zinc-900 dark:text-zinc-100">
      <div className="px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-6">{children}</div>
    </div>
  )
}
