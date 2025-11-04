import { AppType } from '@/apollo/graphql'
import clsx from 'clsx'
import { AppCard } from './AppCard'
import AppSortMenu from '@/app/[team]/apps/_components/AppSortMenu'
import { AppSortOption, AppTabs, sortApps } from '@/utils/app'
import { useState, useEffect, useContext, useMemo } from 'react'
import { BsFillGrid3X3GapFill } from 'react-icons/bs'
import { FaSearch, FaTimesCircle, FaList, FaBoxOpen } from 'react-icons/fa'
import { Button } from '../common/Button'
import { MdSearchOff } from 'react-icons/md'
import { EmptyState } from '../common/EmptyState'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import AppCardSkeleton from './AppCardSkeleton'

type ViewMode = 'grid' | 'list'

export const AppsView = ({
  apps,
  loading,
  tabToLink,
}: {
  apps: AppType[]
  loading: boolean
  tabToLink?: AppTabs
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [sort, setSort] = useState<AppSortOption>('-updated')

  const { activeOrganisation: organisation } = useContext(organisationContext)

  // Permissions
  const userCanCreateApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'create')

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 1024) {
        setViewMode('list') // Auto-collapse
      } else {
        const savedViewMode = localStorage.getItem('apps-view-mode') as ViewMode
        if (savedViewMode) {
          setViewMode(savedViewMode === 'list' ? 'list' : 'grid')
        } else setViewMode('grid')
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Load saved view preference
  useEffect(() => {
    const savedViewMode = localStorage.getItem('apps-view-mode') as ViewMode
    if (savedViewMode) {
      setViewMode(savedViewMode === 'list' ? 'list' : 'grid')
    }
  }, [])

  // Save view preference when it changes
  const handleViewModeChange = () => {
    const newMode = viewMode === 'grid' ? 'list' : 'grid'
    setViewMode(newMode)
    localStorage.setItem('apps-view-mode', newMode)
  }

  const filteredApps = useMemo(() => {
    return searchQuery === ''
      ? apps
      : apps.filter((app) => app?.name?.toLowerCase().includes(searchQuery.toLowerCase()))
  }, [searchQuery, apps])

  const filteredAndSortedApps = useMemo(() => sortApps(filteredApps, sort), [filteredApps, sort])

  const noApps = apps.length === 0

  const Skeletons = () =>
    [...Array(10)].map((_, index) => (
      <AppCardSkeleton
        key={`skeleton${index}`}
        variant={viewMode === 'grid' ? 'normal' : 'compact'}
      />
    ))

  return (
    <div className="space-y-4">
      {!noApps && (
        <div className="flex justify-between gap-2">
          <div className="flex items-center gap-4">
            <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2 w-full max-w-sm">
              <div className="">
                <FaSearch className="text-neutral-500" />
              </div>
              <input
                placeholder="Search"
                className="custom bg-zinc-100 dark:bg-zinc-800"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <FaTimesCircle
                className={clsx(
                  'cursor-pointer text-neutral-500 transition-opacity ease absolute right-2',
                  searchQuery ? 'opacity-100' : 'opacity-0'
                )}
                role="button"
                onClick={() => setSearchQuery('')}
              />
            </div>

            <AppSortMenu sort={sort} setSort={setSort} />
          </div>

          <div className="lg:flex items-center justify-end gap-2 hidden">
            <Button
              variant={'secondary'}
              onClick={handleViewModeChange}
              title={`View as ${viewMode === 'grid' ? 'list' : 'grid'}`}
            >
              {viewMode === 'grid' ? 'List view' : 'Grid view'}
              {viewMode === 'grid' ? <FaList /> : <BsFillGrid3X3GapFill />}
            </Button>
          </div>
        </div>
      )}
      {viewMode === 'list' && !noApps && (
        <div className="grid grid-cols-1 lg:grid-cols-7 gap-4 border-b border-neutral-500/40 pb-2">
          {['App', 'Members', 'Service Accounts', 'Environments', 'Integrations', 'Updated'].map(
            (heading, index) => (
              <div
                key={heading}
                className={clsx(
                  index === 0 ? 'col-span-2 pl-3' : 'hidden lg:block',
                  'text-neutral-500 text-2xs uppercase tracking-widest font-semibold text-left'
                )}
              >
                {heading}
              </div>
            )
          )}
        </div>
      )}

      <div
        className={clsx(
          'grid grid-cols-1',
          viewMode === 'grid'
            ? 'xl:grid-cols-2 1080p:grid-cols-3 gap-6'
            : 'divide-y divide-neutral-500/20'
        )}
      >
        {loading && noApps ? (
          <Skeletons />
        ) : (
          filteredAndSortedApps?.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              variant={viewMode === 'grid' ? 'normal' : 'compact'}
              tabToLink={tabToLink}
            />
          ))
        )}
      </div>

      {filteredAndSortedApps?.length === 0 && searchQuery && (
        <div className="xl:col-span-2 1080p:col-span-3 justify-center p-20">
          <EmptyState
            title={`No results for "${searchQuery}"`}
            subtitle="Try adjusting your search term"
            graphic={
              <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                <MdSearchOff />
              </div>
            }
          >
            <></>
          </EmptyState>
        </div>
      )}

      {!loading && noApps && !userCanCreateApps && (
        <div className="xl:col-span-2 1080p:col-span-3 justify-center p-20">
          <EmptyState
            title="No apps"
            subtitle="You don't have access to any Apps yet. Contact an Admin to get access."
            graphic={
              <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                <FaBoxOpen />
              </div>
            }
          >
            <></>
          </EmptyState>
        </div>
      )}
    </div>
  )
}
