'use client'

import ReactMarkdown from 'react-markdown'

/**
 * Agent supplied Markdown is untrusted. ReactMarkdown does not execute raw HTML
 * by default; links and images are also replaced so the request cannot trigger
 * navigation, tracking pixels, or external fetches.
 */
export function HardenedRequestMarkdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words prose-pre:overflow-x-auto prose-a:text-inherit">
      <ReactMarkdown
        skipHtml
        components={{
          a: ({ children, href }) => (
            <span className="font-medium underline decoration-dotted break-all">
              {children}
              {href && href !== String(children) ? ` (${href})` : ''}
            </span>
          ),
          img: ({ alt }) => (
            <span className="rounded bg-neutral-500/10 px-1.5 py-0.5 text-xs text-neutral-500">
              Image omitted{alt ? `: ${alt}` : ''}
            </span>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
