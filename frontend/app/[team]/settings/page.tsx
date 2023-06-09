import { ModeToggle } from '@/components/common/ModeToggle'

export default function Settings({ params }: { params: { team: string } }) {
  return (
    <div className="w-full space-y-10 p-8 text-black dark:text-white">
      <h1 className="text-2xl font-semibold">{params.team} Settings</h1>
      <div className="flex items-center gap-4">
        Theme: <ModeToggle />
      </div>
    </div>
  )
}
