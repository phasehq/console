'use client'

import { useContext } from 'react'
import { TbLayoutSidebarLeftCollapse, TbLayoutSidebarLeftExpand } from 'react-icons/tb'
import { SidebarContext } from '@/contexts/sidebarContext'

export const SidebarToggle = () => {
  const { sidebarState, setUserPreference } = useContext(SidebarContext)
  const collapsed = sidebarState === 'collapsed'
  const Icon = collapsed ? TbLayoutSidebarLeftExpand : TbLayoutSidebarLeftCollapse

  return (
    <button
      type="button"
      onClick={() => setUserPreference(collapsed ? 'expanded' : 'collapsed')}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition ease hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100"
    >
      <Icon className="size-[18px]" />
    </button>
  )
}
