import { LockboxType } from '@/apollo/graphql'
import { LockboxViewer } from '@/components/lockbox/LockboxViewer'
import { getBox } from '@/utils/lockbox'

export default async function Lockbox({ params }: { params: { boxId: string } }) {
  const box: LockboxType = await getBox(params.boxId)

  return (
    <div className="min-h-screen w-full text-black dark:text-white flex flex-col">
      <div className="flex-1 flex flex-col w-full max-w-6xl mx-auto p-4 md:p-8">
        <LockboxViewer box={box} />
      </div>
    </div>
  )
}
