import Spinner from '@/components/common/Spinner'

export default function Loading() {
  return (
    <div className="h-screen w-full flex items-center justify-center">
      <Spinner size={'xl'} />
    </div>
  )
}
