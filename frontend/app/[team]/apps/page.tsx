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
import { useSearchParams, useRouter } from 'next/navigation'
import { userHasPermission } from '@/utils/access/permissions'
import { EmptyState } from '@/components/common/EmptyState'
import { FaBan, FaCopy, FaCog, FaChevronRight, FaSearch, FaTh, FaListUl } from 'react-icons/fa'
import { FaBoxOpen, FaPlus } from 'react-icons/fa6'
import { EncryptionModeIndicator } from '@/components/apps/EncryptionModeIndicator'
import { Avatar } from '@/components/common/Avatar'
import { BsListColumnsReverse } from 'react-icons/bs'
import { FaProjectDiagram, FaRobot, FaUsers } from 'react-icons/fa'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'

type ViewMode = 'grid' | 'list'

export default function AppsHome({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const router = useRouter()
  const [isMobile, setIsMobile] = useState(false)

  const userCanViewApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'read')
  const userCanCreateApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'create')

  const dialogRef = useRef<{ openModal: () => void }>(null)

  const searchParams = useSearchParams()

  // Handle responsive design
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    
    // Check initially
    checkMobile()
    
    // Add event listener for resize
    window.addEventListener('resize', checkMobile)
    
    // Cleanup
    return () => window.removeEventListener('resize', checkMobile)
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

  useEffect(() => {
    if (searchParams?.get('new')) {
      if (dialogRef.current) {
        dialogRef.current.openModal()
      }
    }
  }, [searchParams])

  const { data, loading } = useQuery(GetApps, {
    variables: {
      organisationId: organisation?.id,
    },
    skip: !organisation || !userCanViewApps,
    fetchPolicy: 'cache-and-network',
  })

  const apps = data?.apps as AppType[]
  
  // Filter apps based on search term
  const filteredApps = apps?.filter(app => 
    app.name.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  const handleRowClick = (appId: string, e?: React.MouseEvent) => {
    // If ctrl/cmd key was pressed, open in new tab
    if (e && (e.ctrlKey || e.metaKey)) {
      window.open(`/${params.team}/apps/${appId}`, '_blank')
    } else {
      router.push(`/${params.team}/apps/${appId}`)
    }
  }

  const renderListView = () => {
    if (!filteredApps.length) {
      return (
        <div className="w-full">
          <EmptyState
            title="No apps found"
            subtitle="No apps match your search criteria. Try adjusting your search."
            graphic={
              <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                <FaSearch />
              </div>
            }
          >
            <></>
          </EmptyState>
        </div>
      )
    }

    return (
      <div className="w-full bg-white dark:bg-neutral-900 rounded-md overflow-hidden shadow">
        <table className="w-full border-collapse">
          <thead className="bg-zinc-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left font-medium">App Name</th>
              {!isMobile && (
                <>
                  <th className="px-4 py-3 text-left font-medium">Encryption</th>
                  <th className="px-4 py-3 text-left font-medium">ID</th>
                  <th className="px-4 py-3 text-left font-medium">Members</th>
                  <th className="px-4 py-3 text-left font-medium">Service Accounts</th>
                  <th className="px-4 py-3 text-left font-medium">Environments</th>
                  <th className="px-4 py-3 text-left font-medium">Integrations</th>
                  <th className="px-4 py-3 text-left font-medium"></th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-neutral-800">
            {filteredApps.map((app, index) => {
              const totalSyncCount = app.environments
                ? app.environments.reduce((acc, env) => acc + (env!.syncs?.length || 0), 0)
                : 0

              const providers: string[] = app.environments
                ? app.environments
                    .flatMap((env) => {
                      return env!.syncs.map((sync) => {
                        const serviceInfo = sync!.serviceInfo
                        const providerId = serviceInfo!.provider!.id
                        return providerId
                      })
                    })
                    .filter((id, index, array) => array.indexOf(id) === index)
                : []

              return (
                <tr 
                  key={app.id} 
                  className="hover:bg-zinc-50 dark:hover:bg-neutral-800 cursor-pointer group"
                  onClick={(e) => handleRowClick(app.id, e)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium group-hover:underline">{app.name}</span>
                    </div>
                  </td>
                  {!isMobile && (
                    <>
                      <td className="px-4 py-3">
                        <EncryptionModeIndicator app={app} />
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <CopyButton 
                          value={app.id} 
                          buttonVariant="ghost" 
                          title="Copy App ID"
                        >
                          <span className="text-2xs font-mono text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">{app.id}</span>
                        </CopyButton>
                      </td>
                      <td className="px-4 py-3">
                        <Link 
                          href={`/${params.team}/apps/${app.id}/access/members`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 hover:underline"
                        >
                          <span className="mr-1 text-xs">{app.members.length}</span>
                          {app.members.slice(0, 3).map((member) => (
                            <Avatar key={member!.id} imagePath={member!.avatarUrl} size="sm" />
                          ))}
                          {app.members.length > 3 && (
                            <span className="text-neutral-500 text-xs">+{app.members.length - 3}</span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {app.serviceAccounts.length > 0 ? (
                          <Link 
                            href={`/${params.team}/apps/${app.id}/access/service-accounts`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 hover:underline"
                          >
                            <span className="mr-1 text-xs">{app.serviceAccounts.length}</span>
                            {app.serviceAccounts.slice(0, 3).map((account) => (
                              <div
                                key={account!.id}
                                className="rounded-full flex items-center bg-neutral-500/40 justify-center size-5 p-1"
                              >
                                <span className="text-2xs font-semibold text-zinc-900 dark:text-zinc-100">
                                  {account?.name.slice(0, 1)}
                                </span>
                              </div>
                            ))}
                            {app.serviceAccounts.length > 3 && (
                              <span className="text-neutral-500 text-xs">+{app.serviceAccounts.length - 3}</span>
                            )}
                          </Link>
                        ) : (
                          <span className="text-neutral-500 text-xs">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link 
                          href={`/${params.team}/apps/${app.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 hover:underline"
                        >
                          <span className="mr-1 text-xs">{app.environments.length}</span>
                          {app.environments.slice(0, 3).map((env) => (
                            <div
                              key={env!.id}
                              className="bg-neutral-400/10 ring-1 ring-neutral-400/20 rounded-full px-2 text-zinc-800 dark:text-zinc-200 text-2xs font-semibold"
                            >
                              {env!.name.slice(0, 1)}
                            </div>
                          ))}
                          {app.environments.length > 3 && (
                            <span className="text-neutral-500 text-xs">+{app.environments.length - 3}</span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {totalSyncCount > 0 ? (
                          <Link 
                            href={`/${params.team}/apps/${app.id}/syncing`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 hover:underline"
                          >
                            <span className="mr-1 text-xs">{totalSyncCount}</span>
                            {providers.slice(0, 3).map((providerId) => (
                              <ProviderIcon key={providerId} providerId={providerId} />
                            ))}
                            {providers.length > 3 && (
                              <span className="text-neutral-500 text-xs">+{providers.length - 3}</span>
                            )}
                          </Link>
                        ) : (
                          <span className="text-neutral-500 text-xs">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link
                          href={`/${params.team}/apps/${app.id}/settings`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button variant="secondary">
                            Settings <FaChevronRight />
                          </Button>
                        </Link>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const renderGridView = () => {
    if (!filteredApps.length) {
      return (
        <div className="xl:col-span-2 1080p:col-span-3 justify-center p-20">
          <EmptyState
            title="No apps found"
            subtitle="No apps match your search criteria. Try adjusting your search."
            graphic={
              <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                <FaSearch />
              </div>
            }
          >
            <></>
          </EmptyState>
        </div>
      )
    }

    return (
      <div className="grid grid-cols-1 xl:grid-cols-2 1080p:grid-cols-3 gap-8">
        {filteredApps.map((app) => (
          <Link href={`/${params.team}/apps/${app.id}`} key={app.id}>
            <AppCard app={app} />
          </Link>
        ))}
      </div>
    )
  }

  return (
    <div
      className="w-full p-8 text-black dark:text-white flex flex-col gap-8 overflow-y-auto"
      style={{ height: 'calc(100vh - 64px)' }}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-bold capitalize">Apps</h1>
          
          {/* Create App Button - Only shown if user has permissions */}
          {userCanCreateApps && (
            <Button
              onClick={() => dialogRef.current?.openModal()}
              variant="primary"
              classString="flex items-center gap-2"
            >
              <FaPlus className="text-sm" /> Create App
            </Button>
          )}
        </div>
        
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <FaSearch className="text-neutral-400" />
            </div>
            <input
              type="text"
              placeholder="Search apps..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border border-zinc-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-black dark:text-white w-full"
            />
          </div>
          
          {/* View Toggle Button */}
          <Button
            onClick={handleViewModeChange}
            variant="secondary"
            classString="flex items-center gap-2"
          >
            {viewMode === 'grid' ? (
              <>
                <FaListUl className="text-sm" /> List View
              </>
            ) : (
              <>
                <FaTh className="text-sm" /> Grid View
              </>
            )}
          </Button>
        </div>
      </div>

      {userCanViewApps ? (
        <>
          {/* Render view based on selected mode */}
          {viewMode === 'grid' ? renderGridView() : renderListView()}

          {/* Empty state when no apps exist at all */}
          {apps?.length === 0 && !userCanCreateApps && (
            <div className="justify-center p-20">
              <EmptyState
                title="No apps"
                subtitle="You don't have access to any apps yet. Contact an Admin to get access."
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

      {/* NewAppDialog - hidden but accessible via ref */}
      {organisation && apps && (
        <div className="hidden">
          <NewAppDialog organisation={organisation} appCount={apps.length} ref={dialogRef} />
        </div>
      )}
    </div>
  )
}
