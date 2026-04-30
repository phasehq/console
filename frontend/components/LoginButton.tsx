'use client'

import { useSession } from '@/contexts/userContext'
import { handleSignout } from '@/apollo/client'
import { Button } from './common/Button'

export default function Component() {
  const { data: session } = useSession()
  if (session) {
    return (
      <>
        Signed in as {session.user!.email} <br />
        <Button variant="primary" onClick={() => handleSignout()}>
          Sign out
        </Button>
      </>
    )
  }
  return (
    <>
      Not signed in <br />
      <Button variant="primary" onClick={() => (window.location.href = '/login')}>
        Sign in
      </Button>
    </>
  )
}
