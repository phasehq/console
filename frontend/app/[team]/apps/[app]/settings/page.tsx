'use client'

import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { useQuery, useMutation } from '@apollo/client'
import { AppType } from '@/apollo/graphql'
import { useContext, useState, useEffect } from 'react'
import DeleteAppDialog from '@/components/apps/DeleteAppDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { FaCube, FaEdit, FaServer } from 'react-icons/fa'
import CopyButton from '@/components/common/CopyButton'
import { EnableSSEDialog } from '@/components/apps/EnableSSEDialog'
import Link from 'next/link'
import { FaArrowDownUpLock } from 'react-icons/fa6'
import { userHasPermission } from '@/utils/access/permissions'
import { UpdateAppInfoOp } from '@/graphql/mutations/apps/updateAppInfo.gql'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'
import { AppDescriptionEditor } from './_components/AppDescriptionEditor'

export default function AppSettings({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [name, setName] = useState('')

  const { data } = useQuery(GetAppDetail, {
    variables: {
      organisationId: organisation?.id,
      appId: params.app,
    },
    skip: !organisation,
  })

  const app = data?.apps[0] as AppType

  const readableDate =
    app &&
    `${new Date(app.createdAt).toDateString()}, ${new Date(app.createdAt).toLocaleTimeString()}`

  const userCanDeleteApps = organisation
    ? userHasPermission(organisation.role?.permissions, 'Apps', 'delete')
    : false
  const userCanUpdateSSE = organisation
    ? userHasPermission(organisation.role?.permissions, 'EncryptionMode', 'update', true)
    : false
  const userCanUpdateApps = organisation
    ? userHasPermission(organisation.role?.permissions, 'Apps', 'update')
    : false

  const [updateAppName] = useMutation(UpdateAppInfoOp)

  const nameUpdated = app ? app.name !== name : false

  const updateName = async () => {
    if (!userCanUpdateApps) {
      toast.error("You don't have the permissions required to update Apps")
      return
    }

    if (!name || name.trim() === '') {
      toast.error('App name cannot be blank')
      return
    }

    await updateAppName({
      variables: {
        id: app.id,
        name,
      },
      refetchQueries: [
        {
          query: GetAppDetail,
          variables: {
            organisationId: organisation?.id,
            appId: params.app,
          },
        },
      ],
    })

    toast.success('Updated app name!')
  }

  const resetName = () => setName(app.name)

  useEffect(() => {
    if (app) setName(app.name)
  }, [app])

  return (
    <div className="max-w-screen-lg mx-auto space-y-10 divide-y divide-neutral-500/40 p-8 w-full text-black dark:text-white mt-6">
      <h1 className="text-3xl font-semibold">Settings</h1>
      {app && (
        <div className="space-y-6 py-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold">App</h2>
            <p className="text-neutral-500">App name and information</p>
          </div>
          <div className="flex items-center gap-4">
            <FaCube className="shrink-0 text-neutral-500" size={40} />
            <div className="flex items-start justify-between w-full">
              <div className="flex flex-col gap-1 w-full">
                <h3 className="relative group w-full max-w-md">
                  <input
                    className="custom bg-neutral-50 dark:bg-neutral-900 hover:bg-neutral-50/80 dark:hover:bg-neutral-900/50 rounded-lg transition ease w-full text-xl font-semibold"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    readOnly={!userCanUpdateApps}
                    maxLength={64}
                  />
                  {nameUpdated ? (
                    <div className="flex items-center inset-y-0 gap-1 absolute right-2 backdrop-blur-sm">
                      <Button variant="secondary" onClick={resetName}>
                        <span className="text-2xs">Discard</span>
                      </Button>
                      <Button variant="primary" onClick={updateName}>
                        <span className="text-2xs">Save</span>
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center inset-y-0 gap-1 absolute right-2 opacity-50 group-hover:opacity-100 transition ease ">
                      <FaEdit className="text-neutral-500 text-base" />
                    </div>
                  )}
                </h3>

                <div className="flex items-center gap-4 group relative">
                  <CopyButton value={app.id} buttonVariant="ghost">
                    <span className="text-neutral-500 text-sm font-mono">{app.id}</span>
                  </CopyButton>
                </div>
              </div>
              <div className="flex items-center gap-4 text-neutral-500 text-xs justify-end whitespace-nowrap">
                Created {readableDate}
              </div>
            </div>
          </div>
          <AppDescriptionEditor app={app} canUpdate={userCanUpdateApps} />
        </div>
      )}

      {app && (
        <div className="space-y-6 py-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-black dark:text-white">Encryption</h2>
            <p className="text-neutral-500">Manage the encryption mode used for this App</p>
          </div>

          {app.sseEnabled ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div>
                  <div className="text-lg font-semibold text-black dark:text-white">
                    Server-side encryption (SSE)
                  </div>
                  <div className="text-neutral-500">
                    Server-side encryption is enabled for this App. This allows the server to access
                    secrets for automatic syncing with third-party{' '}
                    <Link
                      className="text-emerald-500"
                      href={`/${params.team}/apps/${params.app}/syncing`}
                    >
                      integrations
                    </Link>{' '}
                    and API access.
                  </div>
                </div>
              </div>
              <div className="flex items-center p-4 gap-2 text-sky-500 font-medium bg-sky-400/10 ring-1 ring-inset ring-sky-400/20 rounded-lg">
                <FaServer className="text-xl" />
                <div>Server-side encryption enabled</div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center p-4 gap-2 text-emerald-500 font-medium bg-emerald-400/10 ring-1 ring-inset ring-emerald-400/20 rounded-lg">
                <FaArrowDownUpLock className="text-xl" />
                <div>End-to-end encryption enabled</div>
              </div>
              {userCanUpdateSSE && (
                <div className="space-y-2">
                  <div>
                    <div className="text-lg font-semibold text-black dark:text-white">
                      Server-side encryption (SSE)
                    </div>
                    <div className="text-neutral-500">
                      Server-side encryption is required to allow automatic syncing of secrets, or
                      accessing secrets over the API. Click the button below to enable SSE.
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <EnableSSEDialog appId={params.app} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {userCanDeleteApps && (
        <div className="space-y-6 py-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-black dark:text-white">Danger Zone</h2>
            <p className="text-neutral-500">These actions may result in permanent loss of data</p>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg ring-1 ring-inset ring-red-500/40 bg-red-400/10 ">
            <div>
              <h3 className="text-red-400 font-semibold">Delete App</h3>
              <p className="text-neutral-500">Permanently delete this App</p>
            </div>

            {organisation && app && (
              <DeleteAppDialog
                appId={app.id}
                appName={app.name}
                teamName={params.team}
                organisationId={organisation.id}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
