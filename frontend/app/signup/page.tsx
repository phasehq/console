import { redirect } from 'next/navigation'
import { Metadata } from 'next'
import { formatTitle } from '@/utils/meta'
import SignupForm from '@/components/auth/SignupForm'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: formatTitle('Sign up'),
    description: 'Create your Phase account',
  }
}

export default async function SignupPage() {
  const passwordAuthEnabled = ['true', '1', 'yes'].includes(
    (process.env.ENABLE_PASSWORD_AUTH || '').toLowerCase()
  )
  if (!passwordAuthEnabled) redirect('/login')

  return <SignupForm />
}
