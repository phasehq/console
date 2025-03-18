'use client'

import { useQuery } from '@apollo/client'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { AppType } from '@/apollo/graphql'
import NewAppDialog from '@/components/apps/NewAppDialog'
import { useContext, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Spinner from '@/components/common/Spinner'
import { AppCard } from '@/components/apps/AppCard'
import { organisationContext } from '@/contexts/organisationContext'
import { useSearchParams } from 'next/navigation'
import { userHasPermission } from '@/utils/access/permissions'
import { EmptyState } from '@/components/common/EmptyState'
import { FaBan, FaBoxes, FaList, FaPlus, FaSearch, FaTimesCircle } from 'react-icons/fa'
import { FaBoxOpen, FaTableCells } from 'react-icons/fa6'
import { Input } from '@/components/common/Input'
import { Button } from '@/components/common/Button'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import { BsFillGrid3X3GapFill } from 'react-icons/bs'
import { MdSearchOff } from 'react-icons/md'
import { AppSortOption, sortApps } from '@/utils/app'
import AppSortMenu from './_components/AppSortMenu'

export default function AppsHome({ params }: { params: { team: string } }) {
  type ViewMode = 'grid' | 'list'

  const { activeOrganisation: organisation } = useContext(organisationContext)

  // Permissions
  const userCanViewApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'read')
  const userCanCreateApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'create')

  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [sort, setSort] = useState<AppSortOption>('-updated')

  const dialogRef = useRef<{ openModal: () => void }>(null)

  const searchParams = useSearchParams()

  const openNewAppDialog = () => dialogRef.current?.openModal()

  useEffect(() => {
    if (searchParams?.get('new')) {
      openNewAppDialog()
    }
  }, [searchParams])

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

  const { data, loading } = useQuery(GetApps, {
    variables: {
      organisationId: organisation?.id,
    },
    skip: !organisation || !userCanViewApps,
    fetchPolicy: 'cache-and-network',
  })

  const apps = (data?.apps as AppType[]) ?? []

  const filteredApps =
    searchQuery === '' ? apps : apps.filter((app) => app?.name?.toLowerCase().includes(searchQuery))

  const filteredAndSortedApps = sortApps(filteredApps, sort)

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

  return (
    <div
      className="w-full p-8 text-black dark:text-white flex flex-col gap-6 overflow-y-auto"
      style={{ height: 'calc(100vh - 64px)' }}
    >
      <div className="space-y-1">
        <h1 className="text-3xl font-bold capitalize col-span-4">Apps</h1>
        <p className="text-neutral-500">
          All Apps that you have access to in the {organisation?.name} organisation
        </p>
      </div>

      {userCanCreateApps && organisation && (
        <NewAppDialog
          organisation={organisation}
          appCount={apps?.length}
          ref={dialogRef}
          showButton={false}
        />
      )}
      {userCanViewApps ? (
        <>
          {apps?.length > 0 && (
            <div className="space-y-4">
              <div className="flex justify-end">
                {organisation && apps && userCanCreateApps && (
                  <Button variant="primary" onClick={openNewAppDialog}>
                    <FaPlus />
                    Create an App{' '}
                  </Button>
                )}
              </div>
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
            {viewMode === 'list' && (
              <div className="grid grid-cols-1 lg:grid-cols-7 gap-4 pl-3 border-b border-neutral-500/40 pb-2">
                {[
                  'App',
                  'Members',
                  'Service Accounts',
                  'Environments',
                  'Integrations',
                  'Updated',
                ].map((heading, index) => (
                  <div
                    key={heading}
                    className={clsx(
                      index === 0 ? 'col-span-2' : 'hidden lg:block',
                      'text-neutral-500 text-2xs uppercase tracking-widest font-semibold'
                    )}
                  >
                    {heading}
                  </div>
                ))}
              </div>
            )}
            {filteredAndSortedApps?.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                variant={viewMode === 'grid' ? 'normal' : 'compact'}
              />
            ))}

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

            {apps?.length === 0 && !userCanCreateApps && (
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

            {apps?.length === 0 && userCanCreateApps && (
              <div className="xl:col-span-2 1080p:col-span-3 justify-center p-20">
                <EmptyState
                  title="No apps"
                  subtitle="You don't have access to any apps yet. Create an App to get started."
                  graphic={
                    <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                      <FaBoxOpen />
                    </div>
                  }
                >
                  <>
                    <Button variant="primary" onClick={openNewAppDialog}>
                      <FaPlus />
                      Create an App{' '}
                    </Button>
                  </>
                </EmptyState>
              </div>
            )}
          </div>
        </>
      ) : (
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view Apps in this organisation."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      )}
      {loading && (
        <div className="mx-auto my-auto">
          <Spinner size="xl" />
        </div>
      )}
    </div>
  )
}
