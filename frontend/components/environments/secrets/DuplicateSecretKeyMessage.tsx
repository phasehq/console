import { ReactNode, useId } from 'react'

export const DUPLICATE_SECRET_KEYS_MESSAGE =
  'Duplicate secret keys found. Rename the highlighted keys.'

export const DuplicateSecretKeyMessage = ({
  isDuplicate,
  duplicateKeyNumber,
  children,
}: {
  isDuplicate: boolean
  duplicateKeyNumber?: number
  children: (descriptionId: string | undefined) => ReactNode
}) => {
  const descriptionId = useId()

  return (
    <>
      {children(isDuplicate ? descriptionId : undefined)}
      {isDuplicate && (
        <p
          id={descriptionId}
          className="mt-1 text-2xs text-amber-600 dark:text-amber-400 ph-no-capture"
        >
          {duplicateKeyNumber
            ? `Check key #${duplicateKeyNumber} — it uses the same name. Rename one of these keys.`
            : 'Another key uses this name. Clear filters to find it, then rename one of the keys.'}
        </p>
      )}
    </>
  )
}
