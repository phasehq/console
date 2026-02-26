import { useMemo } from 'react'
import { segmentSecretValue, HighlightSegment } from '@/utils/secretReferences'

const segmentColor: Record<HighlightSegment['type'], string> = {
  plain: '',
  delimiter: 'text-zinc-500 dark:text-zinc-400',
  app: 'text-purple-600 dark:text-purple-400',
  env: 'text-blue-600 dark:text-blue-400',
  folder: 'text-amber-600 dark:text-amber-400',
  key: 'text-emerald-600 dark:text-emerald-400',
}

export const SecretReferenceHighlight: React.FC<{ value: string }> = ({ value }) => {
  const segments = useMemo(() => segmentSecretValue(value), [value])

  return (
    <>
      {segments.map((seg, i) => {
        const color = segmentColor[seg.type]
        return color ? (
          <span key={i} className={color}>
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      })}
    </>
  )
}
