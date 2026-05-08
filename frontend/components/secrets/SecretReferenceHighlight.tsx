import { useMemo } from 'react'
import { segmentSecretValue, SEGMENT_COLORS } from '@/utils/secretReferences'

export const SecretReferenceHighlight: React.FC<{ value: string }> = ({ value }) => {
  const segments = useMemo(() => segmentSecretValue(value), [value])

  return (
    <>
      {segments.map((seg, i) => {
        const color = SEGMENT_COLORS[seg.type]
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
