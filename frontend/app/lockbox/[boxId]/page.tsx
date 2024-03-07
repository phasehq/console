import { LockboxType } from '@/apollo/graphql'
import { HeroPattern } from '@/components/common/HeroPattern'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'
import { LockboxViewer } from '@/components/lockbox/LockboxViewer'
import { getBox } from '@/utils/lockbox'

export default async function Lockbox({ params }: { params: { boxId: string } }) {
  const box: LockboxType = await getBox(params.boxId)

  return (
    <>
      <div className="h-screen w-full text-black dark:text-white flex flex-col md:gap-16">
        <HeroPattern />
        <OnboardingNavbar />
        <div className="mx-auto my-auto max-w-6xl p-4 grid md:grid-cols-2 gap-16 text-center md:text-left">
          <div className="space-y-2 my-auto">
            <div className="text-4xl font-semibold">Phase Lockbox</div>
            <div className="text-neutral-500 text-lg">
              You&apos;ve recieved a secret via Phase Lockbox, secured with zero-trust encryption.
              Click the View button below to decrypt and view this secret.
            </div>
          </div>

          <div className="my-auto">
            <LockboxViewer box={box} />
          </div>
        </div>
      </div>
    </>
  )
}
