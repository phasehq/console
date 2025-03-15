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

export default function AppsHome({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  // Permissions
  const userCanViewApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'read')
  const userCanCreateApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'create')

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [searchQuery, setSearchQuery] = useState('')

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
      if (window.innerWidth <= 950) {
        setViewMode('list') // Auto-collapse
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

  const apps = data?.apps as AppType[]

  const filteredApps =
    searchQuery === '' ? apps : apps.filter((app) => app?.name?.toLowerCase().includes(searchQuery))

  return (
    <div
      className="w-full p-8 text-black dark:text-white flex flex-col gap-10 overflow-y-auto"
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
              <div className="flex justify-between">
                <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2">
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
                      'cursor-pointer text-neutral-500 transition-opacity ease',
                      searchQuery ? 'opacity-100' : 'opacity-0'
                    )}
                    role="button"
                    onClick={() => setSearchQuery('')}
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                    onClick={() => setViewMode('grid')}
                    title="Grid layout"
                  >
                    <BsFillGrid3X3GapFill />
                  </Button>
                  <Button
                    variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                    onClick={() => setViewMode('list')}
                    title="List layout"
                  >
                    <FaList />
                  </Button>
                </div>
              </div>
            </div>
          )}
          <div
            className={clsx(
              'grid grid-cols-1',
              viewMode === 'grid' ? 'xl:grid-cols-2 1080p:grid-cols-3 gap-6' : 'gap-4'
            )}
          >
            {filteredApps?.map((app) => (
              <Link key={app.id} href={`/${params.team}/apps/${app.id}`}>
                <AppCard app={app} variant={viewMode === 'grid' ? 'normal' : 'compact'} />
              </Link>
            ))}

            {filteredApps?.length === 0 && searchQuery && (
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
