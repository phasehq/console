'use client'

import { useContext } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus, coldarkCold } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { ThemeContext } from '@/contexts/themeContext'
import CopyButton from '@/components/common/CopyButton'

export function JsonBlock({ data }: { data: unknown }) {
  const { theme } = useContext(ThemeContext)

  if (!data) return null
  const parsed = typeof data === 'string' ? JSON.parse(data) : data
  const formatted = JSON.stringify(parsed, null, 2)

  return (
    <div className="relative group/json mt-1">
      <div className="absolute right-5 top-2 opacity-0 group-hover/json:opacity-100 transition-opacity z-10">
        <CopyButton value={formatted} buttonVariant="secondary" />
      </div>
      <SyntaxHighlighter
        language="json"
        style={theme === 'dark' ? vscDarkPlus : coldarkCold}
        customStyle={{
          fontSize: '0.75rem',
          fontFamily: 'var(--font-jetbrains-mono)',
          lineHeight: '1.5',
          margin: 0,
          borderRadius: '0.375rem',
          maxHeight: '16rem',
          overflow: 'auto',
          background: theme === 'dark' ? '#171717' : '#e4e4e7',
          paddingRight: '1.5rem',
        }}
        codeTagProps={{
          style: {
            fontSize: '0.75rem',
            fontFamily: 'var(--font-jetbrains-mono)',
          },
        }}
      >
        {formatted}
      </SyntaxHighlighter>
    </div>
  )
}
