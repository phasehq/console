'use client'

import { Alert } from '../common/Alert'
import { useSessionFresh } from './useReauthState'

// One-line heads-up inside reauth-gated dialogs: renders only when the
// session is past the freshness deadline, so the sign-in prompt that
// follows never comes as a surprise. Mount inside dialog content (not at
// page level) so its refresh timer only runs while the dialog is open.
export default function StaleSessionNotice() {
  const { fresh } = useSessionFresh()
  if (fresh) return null
  return (
    <Alert variant="info" size="sm" icon>
      You&apos;ll be asked to confirm it&apos;s you before this change is applied.
    </Alert>
  )
}
