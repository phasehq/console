import '@/app/globals.css'
import { InstanceInfo } from '@/components/InstanceInfo'
import { ModeToggle } from '@/components/common/ModeToggle'
import { StatusIndicator } from '@/components/common/StatusIndicator'
import { isCloudHosted } from '@/utils/appConfig'
import { FaSun, FaMoon } from 'react-icons/fa6'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full min-h-screen">
      <div className="absolute top-4 px-4 md:px-8 md:top-8 w-full flex justify-between gap-6 z-10">
        <div className="flex items-center gap-2">
          <InstanceInfo />
        </div>
        <div className="flex items-center gap-6">
          {isCloudHosted() && <StatusIndicator />}
          <div className="flex items-center justify-between px-2 text-neutral-500">
            <div className="flex items-center gap-2">
              <FaSun />
              <ModeToggle />
              <FaMoon />
            </div>
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}
