import SignInButtons from '@/components/auth/SignInButtons'
import { HeroPattern } from '@/components/common/HeroPattern'

export default async function Login() {
  return (
    <>
      <div className="h-screen w-full md:p-16 text-black dark:text-white flex flex-col md:gap-16">
        <HeroPattern />
        <div className="mx-auto my-auto max-w-2xl">
          <SignInButtons />
        </div>
      </div>
    </>
  )
}
