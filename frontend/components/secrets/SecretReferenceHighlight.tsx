import { useMemo } from 'react'
import { segmentSecretValue, HighlightSegment } from '@/utils/secretReferences'

const segmentColor: Record<HighlightSegment['type'], string> = {
  plain: '',
  delimiter: 'text-[#6b6f8a] dark:text-[#a0a5d6]',
  app: 'text-[#c4608e] dark:text-[#ed9cc2]',
  env: 'text-[#3a8a93] dark:text-[#5fb5be]',
  folder: 'text-[#b07a2a] dark:text-[#f6c177]',
  key: 'text-[#3a9474] dark:text-[#74ccaa]',
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
