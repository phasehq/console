import { VersionLabel } from '@/components/VersionLabel'
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

        <div className="absolute bottom-4 right-4 md:bottom-8 md:right-8">
          <VersionLabel />
        </div>
      </div>
    </>
  )
}
