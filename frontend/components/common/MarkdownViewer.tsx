import { useContext } from 'react'
import ReactMarkdown, { ExtraProps } from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { ThemeContext } from '@/contexts/themeContext'
import CopyButton from '@/components/common/CopyButton'
import clsx from 'clsx'

interface MarkdownViewerProps {
  text: string
  className?: string
}

export const MarkdownViewer = ({ text, className }: MarkdownViewerProps) => {
  const { theme } = useContext(ThemeContext)

  const components = {
    code(props: React.HTMLAttributes<HTMLElement> & ExtraProps) {
      const { children, className, node, ...rest } = props
      const match = /language-(\w+)/.exec(className || '')
      const codeString = String(children).replace(/\n$/, '')

      return match ? (
        <div className="relative group/code">
          <div className="absolute right-2 top-2 opacity-0 group-hover/code:opacity-100 transition-opacity z-10 flex items-center gap-2">
            <span className="text-xs font-mono text-neutral-500 uppercase">{match[1]}</span>
            <CopyButton value={codeString} buttonVariant="secondary" />
          </div>
          <SyntaxHighlighter
            {...rest}
            PreTag="div"
            CodeTag="div"
            language={match[1]}
            style={theme === 'dark' ? vscDarkPlus : vs}
            customStyle={{
              fontSize: '0.875rem',
              fontFamily: 'var(--font-jetbrains-mono)',
              lineHeight: '1.5',
            }}
          >
            {codeString}
          </SyntaxHighlighter>
        </div>
      ) : (
        <code {...rest} className={className}>
          {children}
        </code>
      )
    },
  }

  return (
    <div className={clsx('[&>*:first-child]:mt-0', className)}>
      <ReactMarkdown components={components}>{text}</ReactMarkdown>
    </div>
  )
}
