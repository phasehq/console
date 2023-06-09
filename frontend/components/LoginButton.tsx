'use client'

import { useSession, signIn, signOut } from 'next-auth/react'
import { Button } from './common/Button'

export default function Component() {
  const { data: session } = useSession()
  if (session) {
    return (
      <>
        Signed in as {session.user!.email} <br />
        <Button variant="primary" onClick={() => signOut()}>
          Sign out
        </Button>
      </>
    )
  }
  return (
    <>
      Not signed in <br />
      <Button variant="primary" onClick={() => signIn()}>
        Sign in
      </Button>
    </>
  )
}
