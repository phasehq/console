import { AnimatedLogo } from '@/components/common/AnimatedLogo'
import Spinner from '@/components/common/Spinner'

export default function Loading() {
  return (
    <div className="h-screen w-full flex items-center justify-center">
      {/* <AnimatedLogo boxSize={80} /> */}
      <Spinner size={'xl'} />
    </div>
  )
}
